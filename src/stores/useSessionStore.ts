/**
 * Session-keyed message store.
 *
 * Holds per-session state in a Map keyed by sessionId.
 * Session switch = change activeSessionId pointer. No clearing. Old data stays.
 * WebSocket handler = store.appendRealtime(msg.sessionId, msg). One line.
 * No localStorage for messages. Backend JSONL is the source of truth.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { authenticatedFetch } from '../utils/api';
import type { LLMProvider } from '../types/app';

// ─── NormalizedMessage (mirrors server/adapters/types.js) ────────────────────

export type MessageKind =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'thinking'
  | 'stream_delta'
  | 'stream_end'
  | 'error'
  | 'complete'
  | 'status'
  | 'permission_request'
  | 'permission_cancelled'
  | 'session_created'
  | 'interactive_prompt'
  | 'task_notification';

export interface NormalizedMessage {
  id: string;
  sessionId: string;
  timestamp: string;
  provider: LLMProvider;
  kind: MessageKind;

  // kind-specific fields (flat for simplicity)
  role?: 'user' | 'assistant';
  content?: string;
  /**
   * Mirrors optional transcript metadata from the server.
   *
   * These fields are currently used by Claude history normalization so local
   * slash commands, local stdout, and compact summaries do not disappear when
   * the session store hydrates from REST history.
   */
  displayText?: string;
  commandName?: string;
  commandMessage?: string;
  commandArgs?: string;
  isLocalCommand?: boolean;
  isLocalCommandStdout?: boolean;
  isCompactSummary?: boolean;
  images?: string[];
  toolName?: string;
  toolInput?: unknown;
  toolId?: string;
  toolResult?: { content: string; isError: boolean; toolUseResult?: unknown } | null;
  isError?: boolean;
  text?: string;
  tokens?: number;
  canInterrupt?: boolean;
  tokenBudget?: unknown;
  requestId?: string;
  input?: unknown;
  context?: unknown;
  newSessionId?: string;
  status?: string;
  summary?: string;
  exitCode?: number;
  actualSessionId?: string;
  parentToolUseId?: string;
  subagentTools?: unknown[];
  isFinal?: boolean;
  // Cursor-specific ordering
  sequence?: number;
  rowid?: number;
}

// ─── Per-session slot ────────────────────────────────────────────────────────

export type SessionStatus = 'idle' | 'loading' | 'streaming' | 'error';

export interface SessionSlot {
  serverMessages: NormalizedMessage[];
  realtimeMessages: NormalizedMessage[];
  merged: NormalizedMessage[];
  /** @internal Cache-invalidation refs for computeMerged */
  _lastServerRef: NormalizedMessage[];
  _lastRealtimeRef: NormalizedMessage[];
  /** Persistent image cache: fingerprint → data URLs. Survives refreshFromServer. */
  imageCache: Map<string, string[]>;
  status: SessionStatus;
  fetchedAt: number;
  total: number;
  hasMore: boolean;
  offset: number;
  tokenUsage: unknown;
}

const EMPTY: NormalizedMessage[] = [];

function createEmptySlot(): SessionSlot {
  return {
    serverMessages: EMPTY,
    realtimeMessages: EMPTY,
    merged: EMPTY,
    _lastServerRef: EMPTY,
    _lastRealtimeRef: EMPTY,
    imageCache: new Map(),
    status: 'idle',
    fetchedAt: 0,
    total: 0,
    hasMore: false,
    offset: 0,
    tokenUsage: null,
  };
}

const IMAGE_CACHE_PREFIX = 'cloudcli_img_';
const USER_ECHO_WINDOW_MS = 120_000;
const USER_ECHO_NEGATIVE_SKEW_MS = 5_000;

function saveImageCache(sessionId: string, cache: Map<string, string[]>): void {
  if (cache.size === 0) return;
  try {
    const obj: Record<string, string[]> = {};
    cache.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem(IMAGE_CACHE_PREFIX + sessionId, JSON.stringify(obj));
  } catch { /* quota exceeded — silently ignore */ }
}

function loadImageCache(sessionId: string): Map<string, string[]> {
  try {
    const raw = localStorage.getItem(IMAGE_CACHE_PREFIX + sessionId);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, string[]>;
    return new Map(Object.entries(obj));
  } catch { return new Map(); }
}

/**
 * Compute merged messages: server + realtime, deduped by id and adjacent
 * assistant echo (same trimmed text), so finalized stream rows do not stack
 * on top of the persisted copy before realtime is cleared.
 */
function userTextFingerprint(m: NormalizedMessage): string | null {
  if (m.kind !== 'text' || m.role !== 'user') return null;
  let t = (m.content || '').trim();
  // Strip image paths section appended by server so client/server versions match
  const pathIdx = t.indexOf('[Images provided at the following paths:]');
  if (pathIdx > 0) {
    t = t.slice(0, pathIdx).trim();
  }
  return t.length > 0 ? t : null;
}

/**
 * After `finalizeStreaming`, the client holds a synthetic assistant `text` row
 * while the sessions API soon returns the same reply with a different id.
 * Those sit back-to-back in merged order and look like duplicate bubbles until
 * `refreshFromServer` clears realtime. Collapse same-text assistant rows and
 * stream_placeholder → text when content matches.
 */
function dedupeAdjacentAssistantEchoes(merged: NormalizedMessage[]): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  for (const m of merged) {
    const prev = out[out.length - 1];
    if (prev) {
      if (prev.kind === 'stream_delta' && m.kind === 'text' && m.role === 'assistant') {
        const ps = (prev.content || '').trim();
        const ms = (m.content || '').trim();
        if (ps.length > 0 && ps === ms) {
          out[out.length - 1] = m;
          continue;
        }
      }
      if (
        prev.kind === 'text'
        && m.kind === 'text'
        && prev.role === 'assistant'
        && m.role === 'assistant'
      ) {
        const ms = (m.content || '').trim();
        if (ms.length > 0 && ms === (prev.content || '').trim()) {
          continue;
        }
      }
    }
    out.push(m);
  }
  return out;
}

/**
 * Within the realtime array, if both a local_* user message and a server-echoed
 * user message exist with the same text, keep only the server-echoed one (it has
 * the canonical id). This prevents duplicate bubbles before refreshFromServer.
 */
function dedupeRealtimeUserMessages(msgs: NormalizedMessage[]): NormalizedMessage[] {
  const serverEchoes = msgs.filter((msg) =>
    msg.kind === 'text'
    && msg.role === 'user'
    && !msg.id.startsWith('local_')
    && userTextFingerprint(msg) !== null,
  );

  if (serverEchoes.length === 0) return msgs;

  // Drop a local user message only when there is a likely canonical echo
  // nearby in time. This avoids hiding legitimate repeated prompts such as
  // "thanks", "ok", etc. that occur later in the same conversation.
  return msgs.filter((m) => {
    if (!m.id.startsWith('local_')) return true;
    if (m.kind !== 'text' || m.role !== 'user') return true;
    return !serverEchoes.some((echo) => isLikelyUserEcho(m, echo));
  });
}

function parseMessageTimeMs(message: NormalizedMessage): number | null {
  const ms = Date.parse(message.timestamp);
  return Number.isNaN(ms) ? null : ms;
}

function isLikelyUserEcho(localMessage: NormalizedMessage, serverMessage: NormalizedMessage): boolean {
  if (!localMessage.id.startsWith('local_')) return false;
  if (localMessage.kind !== 'text' || localMessage.role !== 'user') return false;
  if (serverMessage.kind !== 'text' || serverMessage.role !== 'user' || serverMessage.id.startsWith('local_')) return false;

  const localFp = userTextFingerprint(localMessage);
  const serverFp = userTextFingerprint(serverMessage);
  if (!localFp || !serverFp || localFp !== serverFp) return false;

  const localTime = parseMessageTimeMs(localMessage);
  const serverTime = parseMessageTimeMs(serverMessage);
  if (localTime === null || serverTime === null) return false;

  const delta = Math.abs(serverTime - localTime);
  if (delta > USER_ECHO_WINDOW_MS) return false;
  if (serverTime + USER_ECHO_NEGATIVE_SKEW_MS < localTime) return false;

  return true;
}

function computeMerged(server: NormalizedMessage[], realtime: NormalizedMessage[], imageCache?: Map<string, string[]>): NormalizedMessage[] {
  // Apply imageCache to server messages even when realtime is empty
  const applyImageCache = (msgs: NormalizedMessage[]): NormalizedMessage[] => {
    if (!imageCache || imageCache.size === 0) return msgs;
    return msgs.map(m => {
      if (m.images?.length) return m;
      const fp = userTextFingerprint(m);
      if (fp && imageCache.has(fp)) {
        return { ...m, images: imageCache.get(fp) };
      }
      return m;
    });
  };

  if (realtime.length === 0) {
    const result = applyImageCache(server);
    result.sort(compareMessagesByTimestamp);
    return result;
  }
  if (server.length === 0) {
    const result = applyImageCache(dedupeAdjacentAssistantEchoes(dedupeRealtimeUserMessages(realtime)));
    result.sort(compareMessagesByTimestamp);
    return result;
  }
  const serverIds = new Set(server.map(m => m.id));
  const serverUserMessages = server.filter((m) =>
    m.kind === 'text' && m.role === 'user' && userTextFingerprint(m) !== null,
  );

  // Build a map of realtime images keyed by fingerprint so we can preserve them
  const realtimeImagesByFp = new Map<string, string[]>();
  for (const m of realtime) {
    if (m.images?.length) {
      const fp = userTextFingerprint(m);
      if (fp) realtimeImagesByFp.set(fp, m.images);
    }
  }

  // Merge images from realtime or imageCache into server messages that lack them
  const mergedServer = server.map(m => {
    if (m.images?.length) return m;
    const fp = userTextFingerprint(m);
    if (fp) {
      if (realtimeImagesByFp.has(fp)) return { ...m, images: realtimeImagesByFp.get(fp) };
      if (imageCache?.has(fp)) return { ...m, images: imageCache.get(fp) };
    }
    return m;
  });

  const dedupedRealtime = dedupeRealtimeUserMessages(realtime);
  const extra = dedupedRealtime.filter((m) => {
    if (serverIds.has(m.id)) return false;
    if (m.id.startsWith('local_')) {
      const hasLikelyEcho = serverUserMessages.some((serverMessage) => isLikelyUserEcho(m, serverMessage));
      if (hasLikelyEcho) return false;
    }
    return true;
  });
  if (extra.length === 0) {
    mergedServer.sort(compareMessagesByTimestamp);
    return mergedServer;
  }
  const combined = [...mergedServer, ...extra];
  combined.sort(compareMessagesByTimestamp);
  return dedupeAdjacentAssistantEchoes(combined);
}

function compareMessagesByTimestamp(left: NormalizedMessage, right: NormalizedMessage): number {
  const leftTime = Date.parse(left.timestamp);
  const rightTime = Date.parse(right.timestamp);

  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  // Tiebreaker: use sequence/rowid for stable ordering when timestamps match
  if (left.sequence !== undefined && right.sequence !== undefined) {
    return left.sequence - right.sequence;
  }
  if (left.rowid !== undefined && right.rowid !== undefined) {
    return left.rowid - right.rowid;
  }

  // If one has a valid timestamp and the other doesn't, valid comes first
  if (!Number.isNaN(leftTime) && Number.isNaN(rightTime)) return -1;
  if (Number.isNaN(leftTime) && !Number.isNaN(rightTime)) return 1;

  return 0;
}

function rewriteMessageSessionId(
  msg: NormalizedMessage,
  fromSessionId: string,
  toSessionId: string,
): NormalizedMessage {
  const streamingSourceId = `__streaming_${fromSessionId}`;
  const nextId = msg.id === streamingSourceId ? `__streaming_${toSessionId}` : msg.id;

  if (msg.sessionId === toSessionId && nextId === msg.id) {
    return msg;
  }

  return {
    ...msg,
    id: nextId,
    sessionId: toSessionId,
  };
}

function mergeMessagesById(
  existing: NormalizedMessage[],
  incoming: NormalizedMessage[],
): NormalizedMessage[] {
  if (existing.length === 0) return incoming;
  if (incoming.length === 0) return existing;

  const merged = [...existing, ...incoming];
  const deduped: NormalizedMessage[] = [];
  const seen = new Set<string>();

  for (const msg of merged) {
    if (seen.has(msg.id)) {
      continue;
    }

    seen.add(msg.id);
    deduped.push(msg);
  }

  deduped.sort(compareMessagesByTimestamp);
  return deduped;
}

/**
 * Recompute slot.merged only when the input arrays have actually changed
 * (by reference). Returns true if merged was recomputed.
 */
function recomputeMergedIfNeeded(slot: SessionSlot): boolean {
  if (slot.serverMessages === slot._lastServerRef && slot.realtimeMessages === slot._lastRealtimeRef) {
    return false;
  }
  slot._lastServerRef = slot.serverMessages;
  slot._lastRealtimeRef = slot.realtimeMessages;
  slot.merged = computeMerged(slot.serverMessages, slot.realtimeMessages, slot.imageCache);
  return true;
}

// ─── Stale threshold ─────────────────────────────────────────────────────────

const STALE_THRESHOLD_MS = 30_000;

const MAX_REALTIME_MESSAGES = 500;

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useSessionStore() {
  const storeRef = useRef(new Map<string, SessionSlot>());
  const sessionAliasesRef = useRef(new Map<string, string>());
  const activeSessionIdRef = useRef<string | null>(null);
  // Bump to force re-render — only when the active session's data changes
  const [, setTick] = useState(0);
  const notify = useCallback((sessionId: string) => {
    const aliases = sessionAliasesRef.current;
    let resolvedSessionId = sessionId;
    const visited = new Set<string>();

    while (aliases.has(resolvedSessionId) && !visited.has(resolvedSessionId)) {
      visited.add(resolvedSessionId);
      resolvedSessionId = aliases.get(resolvedSessionId)!;
    }

    if (resolvedSessionId === activeSessionIdRef.current) {
      setTick(n => n + 1);
    }
  }, []);

  const resolveSessionId = useCallback((sessionId: string | null | undefined): string | null => {
    if (!sessionId) {
      return null;
    }

    const aliases = sessionAliasesRef.current;
    let resolvedSessionId = sessionId;
    const visited = new Set<string>();

    while (aliases.has(resolvedSessionId) && !visited.has(resolvedSessionId)) {
      visited.add(resolvedSessionId);
      resolvedSessionId = aliases.get(resolvedSessionId)!;
    }

    return resolvedSessionId;
  }, []);

  const setActiveSession = useCallback((sessionId: string | null) => {
    activeSessionIdRef.current = resolveSessionId(sessionId);
  }, [resolveSessionId]);

  const getSlot = useCallback((sessionId: string): SessionSlot => {
    const resolvedSessionId = resolveSessionId(sessionId) ?? sessionId;
    const store = storeRef.current;
    if (!store.has(resolvedSessionId)) {
      const slot = createEmptySlot();
      slot.imageCache = loadImageCache(resolvedSessionId);
      store.set(resolvedSessionId, slot);
    }
    return store.get(resolvedSessionId)!;
  }, [resolveSessionId]);

  const has = useCallback((sessionId: string) => {
    const resolvedSessionId = resolveSessionId(sessionId) ?? sessionId;
    return storeRef.current.has(resolvedSessionId);
  }, [resolveSessionId]);

  /**
   * Fetch messages from the provider sessions endpoint and populate serverMessages.
   *
   * Provider and project metadata are resolved server-side from `sessionId`.
   */
  const fetchFromServer = useCallback(async (
    sessionId: string,
    opts: {
      provider?: LLMProvider;
      projectId?: string;
      projectPath?: string;
      limit?: number | null;
      offset?: number;
    } = {},
  ) => {
    const resolvedSessionId = resolveSessionId(sessionId) ?? sessionId;
    const slot = getSlot(resolvedSessionId);
    slot.status = 'loading';
    notify(resolvedSessionId);

    try {
      const params = new URLSearchParams();
      if (opts.limit !== null && opts.limit !== undefined) {
        params.append('limit', String(opts.limit));
        params.append('offset', String(opts.offset ?? 0));
      }

      const qs = params.toString();
      const url = `/api/providers/sessions/${encodeURIComponent(resolvedSessionId)}/messages${qs ? `?${qs}` : ''}`;
      const response = await authenticatedFetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const messages: NormalizedMessage[] = data.messages || [];

      slot.serverMessages = messages;
      slot.total = data.total ?? messages.length;
      slot.hasMore = Boolean(data.hasMore);
      slot.offset = (opts.offset ?? 0) + messages.length;
      slot.fetchedAt = Date.now();
      slot.status = 'idle';
      recomputeMergedIfNeeded(slot);
      if (data.tokenUsage) {
        slot.tokenUsage = data.tokenUsage;
      }

      notify(resolvedSessionId);
      return slot;
    } catch (error) {
      console.error(`[SessionStore] fetch failed for ${resolvedSessionId}:`, error);
      slot.status = 'error';
      notify(resolvedSessionId);
      return slot;
    }
  }, [getSlot, notify, resolveSessionId]);

  /**
   * Load older (paginated) messages and prepend to serverMessages.
   */
  const fetchMore = useCallback(async (
    sessionId: string,
    opts: {
      provider?: LLMProvider;
      projectId?: string;
      projectPath?: string;
      limit?: number;
    } = {},
  ) => {
    const resolvedSessionId = resolveSessionId(sessionId) ?? sessionId;
    const slot = getSlot(resolvedSessionId);
    if (!slot.hasMore) return slot;

    const params = new URLSearchParams();
    const limit = opts.limit ?? 20;
    params.append('limit', String(limit));
    params.append('offset', String(slot.offset));

    const qs = params.toString();
    const url = `/api/providers/sessions/${encodeURIComponent(resolvedSessionId)}/messages${qs ? `?${qs}` : ''}`;

    try {
      const response = await authenticatedFetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const olderMessages: NormalizedMessage[] = data.messages || [];

      // Prepend older messages (they're earlier in the conversation)
      slot.serverMessages = [...olderMessages, ...slot.serverMessages];
      slot.hasMore = Boolean(data.hasMore);
      slot.offset = slot.offset + olderMessages.length;
      recomputeMergedIfNeeded(slot);
      notify(resolvedSessionId);
      return slot;
    } catch (error) {
      console.error(`[SessionStore] fetchMore failed for ${resolvedSessionId}:`, error);
      return slot;
    }
  }, [getSlot, notify, resolveSessionId]);

  /**
   * Append a realtime (WebSocket) message to the correct session slot.
   * This works regardless of which session is actively viewed.
   */
  const appendRealtime = useCallback((sessionId: string, msg: NormalizedMessage) => {
    const resolvedSessionId = resolveSessionId(sessionId) ?? sessionId;
    const slot = getSlot(resolvedSessionId);
    const normalizedMessage =
      msg.sessionId === resolvedSessionId
        ? msg
        : { ...msg, sessionId: resolvedSessionId };

    // Deduplicate user text messages: if the same user text already exists in
    // realtime (optimistic local or server echo), replace the local_ version
    // with the server version, or skip if already present with same id.
    const fp = userTextFingerprint(normalizedMessage);

    // Persist image data in imageCache so it survives refreshFromServer
    if (fp && normalizedMessage.images?.length) {
      slot.imageCache.set(fp, normalizedMessage.images);
      saveImageCache(resolvedSessionId, slot.imageCache);
    }

    if (fp) {
      const existingIdx = slot.realtimeMessages.findIndex((m) => {
        if (m.id === normalizedMessage.id) return true;
        const mfp = userTextFingerprint(m);
        return mfp === fp;
      });
      if (existingIdx >= 0) {
        // If incoming has a real id (not local_), replace the existing local_ one
        if (!normalizedMessage.id.startsWith('local_') && slot.realtimeMessages[existingIdx].id.startsWith('local_')) {
          const updated = [...slot.realtimeMessages];
          const existingLocal = slot.realtimeMessages[existingIdx];
          // Preserve images from local message if server echo doesn't include them
          const localImages = existingLocal.images;
          const merged = normalizedMessage.images?.length
            ? normalizedMessage
            : { ...normalizedMessage, images: localImages };
          // Keep local id/timestamp stable to avoid UI remount flicker while the
          // canonical server row is still converging in history fetches.
          updated[existingIdx] = {
            ...merged,
            id: existingLocal.id,
            timestamp: existingLocal.timestamp,
          };
          slot.realtimeMessages = updated;
          // Also cache from local message
          if (localImages?.length && !slot.imageCache.has(fp)) {
            slot.imageCache.set(fp, localImages);
            saveImageCache(resolvedSessionId, slot.imageCache);
          }
          recomputeMergedIfNeeded(slot);
          notify(resolvedSessionId);
        } else if (normalizedMessage.id.startsWith('local_') && !slot.realtimeMessages[existingIdx].id.startsWith('local_')) {
          // Local message arriving after server echo — merge images into server copy
          if (normalizedMessage.images?.length && !slot.realtimeMessages[existingIdx].images?.length) {
            const updated = [...slot.realtimeMessages];
            updated[existingIdx] = { ...slot.realtimeMessages[existingIdx], images: normalizedMessage.images };
            slot.realtimeMessages = updated;
            recomputeMergedIfNeeded(slot);
            notify(resolvedSessionId);
          }
        }
        return; // Skip duplicate
      }
    }

    let updated = [...slot.realtimeMessages, normalizedMessage];
    if (updated.length > MAX_REALTIME_MESSAGES) {
      updated = updated.slice(-MAX_REALTIME_MESSAGES);
    }
    slot.realtimeMessages = updated;
    recomputeMergedIfNeeded(slot);
    notify(resolvedSessionId);
  }, [getSlot, notify, resolveSessionId]);

  /**
   * Append multiple realtime messages at once (batch).
   */
  const appendRealtimeBatch = useCallback((sessionId: string, msgs: NormalizedMessage[]) => {
    if (msgs.length === 0) return;
    const resolvedSessionId = resolveSessionId(sessionId) ?? sessionId;
    const slot = getSlot(resolvedSessionId);
    const normalizedMessages = msgs.map((msg) =>
      msg.sessionId === resolvedSessionId
        ? msg
        : { ...msg, sessionId: resolvedSessionId },
    );
    let updated = [...slot.realtimeMessages, ...normalizedMessages];
    if (updated.length > MAX_REALTIME_MESSAGES) {
      updated = updated.slice(-MAX_REALTIME_MESSAGES);
    }
    slot.realtimeMessages = updated;
    recomputeMergedIfNeeded(slot);
    notify(resolvedSessionId);
  }, [getSlot, notify, resolveSessionId]);

  /**
   * Re-fetch serverMessages from the provider sessions endpoint.
   */
  const refreshFromServer = useCallback(async (
    sessionId: string,
    _opts: {
      provider?: LLMProvider;
      projectId?: string;
      projectPath?: string;
    } = {},
  ) => {
    const resolvedSessionId = resolveSessionId(sessionId) ?? sessionId;
    const slot = getSlot(resolvedSessionId);
    try {
      const params = new URLSearchParams();

      const qs = params.toString();
      const url = `/api/providers/sessions/${encodeURIComponent(resolvedSessionId)}/messages${qs ? `?${qs}` : ''}`;
      const response = await authenticatedFetch(url);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      slot.serverMessages = data.messages || [];
      slot.total = data.total ?? slot.serverMessages.length;
      slot.hasMore = Boolean(data.hasMore);
      slot.fetchedAt = Date.now();
      // Drop realtime messages the server now includes (by ID or by user text fingerprint)
      const serverIds = new Set((slot.serverMessages as NormalizedMessage[]).map(m => m.id));
      const serverUserMessages = (slot.serverMessages as NormalizedMessage[]).filter((m) =>
        m.kind === 'text' && m.role === 'user' && userTextFingerprint(m) !== null,
      );
      slot.realtimeMessages = slot.realtimeMessages.filter(m => {
        if (serverIds.has(m.id)) return false;
        if (m.id.startsWith('local_')) {
          const hasLikelyEcho = serverUserMessages.some((serverMessage) => isLikelyUserEcho(m, serverMessage));
          if (hasLikelyEcho) return false;
        }
        return true;
      });
      recomputeMergedIfNeeded(slot);
      notify(resolvedSessionId);
    } catch (error) {
      console.error(`[SessionStore] refresh failed for ${resolvedSessionId}:`, error);
    }
  }, [getSlot, notify, resolveSessionId]);

  /**
   * Update session status.
   */
  const setStatus = useCallback((sessionId: string, status: SessionStatus) => {
    const resolvedSessionId = resolveSessionId(sessionId) ?? sessionId;
    const slot = getSlot(resolvedSessionId);
    slot.status = status;
    notify(resolvedSessionId);
  }, [getSlot, notify, resolveSessionId]);

  /**
   * Check if a session's data is stale (>30s old).
   */
  const isStale = useCallback((sessionId: string) => {
    const resolvedSessionId = resolveSessionId(sessionId) ?? sessionId;
    const slot = storeRef.current.get(resolvedSessionId);
    if (!slot) return true;
    return Date.now() - slot.fetchedAt > STALE_THRESHOLD_MS;
  }, [resolveSessionId]);

  /**
   * Update or create a streaming message (accumulated text so far).
   * Uses a well-known ID so subsequent calls replace the same message.
   */
  const updateStreaming = useCallback((sessionId: string, accumulatedText: string, msgProvider: LLMProvider) => {
    const resolvedSessionId = resolveSessionId(sessionId) ?? sessionId;
    const slot = getSlot(resolvedSessionId);
    const streamId = `__streaming_${resolvedSessionId}`;
    const existingIdx = slot.realtimeMessages.findIndex(m => m.id === streamId);
    const existingStream = existingIdx >= 0 ? slot.realtimeMessages[existingIdx] : null;
    const msg: NormalizedMessage = {
      id: streamId,
      sessionId: resolvedSessionId,
      // Preserve the original stream timestamp to prevent reordering flicker
      // while deltas are arriving.
      timestamp: existingStream?.timestamp || new Date().toISOString(),
      provider: msgProvider,
      kind: 'stream_delta',
      content: accumulatedText,
    };
    if (existingIdx >= 0) {
      slot.realtimeMessages = [...slot.realtimeMessages];
      slot.realtimeMessages[existingIdx] = msg;
    } else {
      slot.realtimeMessages = [...slot.realtimeMessages, msg];
    }
    recomputeMergedIfNeeded(slot);
    notify(resolvedSessionId);
  }, [getSlot, notify, resolveSessionId]);

  /**
   * Finalize streaming: convert the streaming message to a regular text message.
   * The well-known streaming ID is replaced with a unique text message ID.
   */
  const finalizeStreaming = useCallback((sessionId: string) => {
    const resolvedSessionId = resolveSessionId(sessionId) ?? sessionId;
    const slot = storeRef.current.get(resolvedSessionId);
    if (!slot) return;
    const streamId = `__streaming_${resolvedSessionId}`;
    const idx = slot.realtimeMessages.findIndex(m => m.id === streamId);
    if (idx >= 0) {
      const stream = slot.realtimeMessages[idx];
      slot.realtimeMessages = [...slot.realtimeMessages];
      slot.realtimeMessages[idx] = {
        ...stream,
        id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        kind: 'text',
        role: 'assistant',
      };
      recomputeMergedIfNeeded(slot);
      notify(resolvedSessionId);
    }
  }, [notify, resolveSessionId]);

  /**
   * Clear realtime messages for a session (e.g., after stream completes and server fetch catches up).
   */
  const clearRealtime = useCallback((sessionId: string) => {
    const resolvedSessionId = resolveSessionId(sessionId) ?? sessionId;
    const slot = storeRef.current.get(resolvedSessionId);
    if (slot) {
      slot.realtimeMessages = [];
      recomputeMergedIfNeeded(slot);
      notify(resolvedSessionId);
    }
  }, [notify, resolveSessionId]);

  /**
   * Get merged messages for a session (for rendering).
   */
  const getMessages = useCallback((sessionId: string): NormalizedMessage[] => {
    const resolvedSessionId = resolveSessionId(sessionId) ?? sessionId;
    return storeRef.current.get(resolvedSessionId)?.merged ?? [];
  }, [resolveSessionId]);

  /**
   * Get session slot (for status, pagination info, etc.).
   */
  const getSessionSlot = useCallback((sessionId: string): SessionSlot | undefined => {
    const resolvedSessionId = resolveSessionId(sessionId) ?? sessionId;
    return storeRef.current.get(resolvedSessionId);
  }, [resolveSessionId]);

  const replaceSessionId = useCallback((fromSessionId: string, toSessionId: string) => {
    const resolvedFromSessionId = resolveSessionId(fromSessionId) ?? fromSessionId;
    const resolvedToSessionId = resolveSessionId(toSessionId) ?? toSessionId;

    if (resolvedFromSessionId === resolvedToSessionId) {
      sessionAliasesRef.current.set(fromSessionId, resolvedToSessionId);
      return;
    }

    const store = storeRef.current;
    const sourceSlot = store.get(resolvedFromSessionId);
    const targetSlot = store.get(resolvedToSessionId) ?? createEmptySlot();

    if (sourceSlot) {
      const migratedServerMessages = sourceSlot.serverMessages.map((msg) =>
        rewriteMessageSessionId(msg, resolvedFromSessionId, resolvedToSessionId),
      );
      const migratedRealtimeMessages = sourceSlot.realtimeMessages.map((msg) =>
        rewriteMessageSessionId(msg, resolvedFromSessionId, resolvedToSessionId),
      );

      targetSlot.serverMessages = mergeMessagesById(targetSlot.serverMessages, migratedServerMessages);
      targetSlot.realtimeMessages = mergeMessagesById(targetSlot.realtimeMessages, migratedRealtimeMessages);
      if (targetSlot.realtimeMessages.length > MAX_REALTIME_MESSAGES) {
        targetSlot.realtimeMessages = targetSlot.realtimeMessages.slice(-MAX_REALTIME_MESSAGES);
      }
      targetSlot.status =
        sourceSlot.status === 'error'
          ? 'error'
          : sourceSlot.status === 'streaming' || targetSlot.status === 'streaming'
            ? 'streaming'
            : sourceSlot.status === 'loading' || targetSlot.status === 'loading'
              ? 'loading'
              : targetSlot.status;
      targetSlot.fetchedAt = Math.max(targetSlot.fetchedAt, sourceSlot.fetchedAt, Date.now());
      targetSlot.total = Math.max(
        targetSlot.total,
        sourceSlot.total,
        targetSlot.serverMessages.length,
        targetSlot.realtimeMessages.length,
      );
      targetSlot.hasMore = targetSlot.hasMore || sourceSlot.hasMore;
      targetSlot.offset = Math.max(targetSlot.offset, sourceSlot.offset);
      targetSlot.tokenUsage = targetSlot.tokenUsage ?? sourceSlot.tokenUsage;
      recomputeMergedIfNeeded(targetSlot);

      store.set(resolvedToSessionId, targetSlot);
      store.delete(resolvedFromSessionId);
    }

    sessionAliasesRef.current.set(resolvedFromSessionId, resolvedToSessionId);
    sessionAliasesRef.current.set(fromSessionId, resolvedToSessionId);

    for (const [aliasSessionId, targetSessionId] of sessionAliasesRef.current.entries()) {
      if (targetSessionId === resolvedFromSessionId) {
        sessionAliasesRef.current.set(aliasSessionId, resolvedToSessionId);
      }
    }

    if (activeSessionIdRef.current === resolvedFromSessionId) {
      activeSessionIdRef.current = resolvedToSessionId;
    }

    notify(resolvedToSessionId);
  }, [notify, resolveSessionId]);

  return useMemo(() => ({
    getSlot,
    has,
    fetchFromServer,
    fetchMore,
    appendRealtime,
    appendRealtimeBatch,
    refreshFromServer,
    setActiveSession,
    setStatus,
    isStale,
    updateStreaming,
    finalizeStreaming,
    clearRealtime,
    getMessages,
    getSessionSlot,
    replaceSessionId,
  }), [
    getSlot, has, fetchFromServer, fetchMore,
    appendRealtime, appendRealtimeBatch, refreshFromServer,
    setActiveSession, setStatus, isStale, updateStreaming, finalizeStreaming,
    clearRealtime, getMessages, getSessionSlot, replaceSessionId,
  ]);
}

export type SessionStore = ReturnType<typeof useSessionStore>;
