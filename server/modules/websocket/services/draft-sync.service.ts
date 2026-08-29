import type { RealtimeClientConnection } from '@/shared/types.js';

import { WS_OPEN_STATE } from './websocket-state.service.js';

/**
 * Live sync of the composer draft (typed but unsent text) across every browser
 * signed in as the same user.
 *
 * The draft is held in memory only: it is transient by nature, already mirrored
 * into each browser's localStorage, and cleared the moment the message is sent.
 * Losing it on a server restart is acceptable; writing every keystroke burst to
 * SQLite is not.
 */

type DraftRecord = {
  text: string;
  /** Monotonic per-key counter so clients can discard out-of-order frames. */
  version: number;
};

/** Guards against a runaway client turning drafts into unbounded memory. */
const MAX_DRAFT_CHARS = 100_000;
const MAX_TRACKED_DRAFTS = 500;

const drafts = new Map<string, DraftRecord>();
const clientUsers = new Map<RealtimeClientConnection, string>();

function draftKey(userId: string, projectId: string): string {
  return `${userId}::${projectId}`;
}

function readUserId(userId: string | number | null): string | null {
  if (userId === null || userId === undefined) return null;
  const text = String(userId).trim();
  return text ? text : null;
}

function readProjectId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sendFrame(client: RealtimeClientConnection, payload: unknown): void {
  if (client.readyState !== WS_OPEN_STATE) return;
  try {
    client.send(JSON.stringify(payload));
  } catch {
    // A socket that fails mid-write is dropped by its own close handler.
  }
}

function draftFrame(projectId: string, record: DraftRecord) {
  return {
    kind: 'draft_sync',
    projectId,
    text: record.text,
    version: record.version,
  };
}

/** Associates a socket with its user so drafts reach that user's other tabs. */
export function registerDraftClient(
  ws: RealtimeClientConnection,
  userId: string | number | null,
): void {
  const id = readUserId(userId);
  if (id) clientUsers.set(ws, id);
}

export function unregisterDraftClient(ws: RealtimeClientConnection): void {
  clientUsers.delete(ws);
}

/**
 * Stores the newest draft for a project and pushes it to the user's other
 * sockets. The originating socket is skipped: it already shows this text, and
 * echoing it back would fight the caret while the user types.
 */
export function handleDraftUpdate(
  ws: RealtimeClientConnection,
  userId: string | number | null,
  data: Record<string, unknown>,
): void {
  const id = readUserId(userId);
  const projectId = readProjectId(data.projectId);
  if (!id || !projectId) return;

  const raw = typeof data.text === 'string' ? data.text : '';
  const text = raw.length > MAX_DRAFT_CHARS ? raw.slice(0, MAX_DRAFT_CHARS) : raw;
  const key = draftKey(id, projectId);

  if (!drafts.has(key) && drafts.size >= MAX_TRACKED_DRAFTS) {
    const oldest = drafts.keys().next();
    if (!oldest.done) drafts.delete(oldest.value);
  }

  // An emptied draft keeps its slot with a bumped version rather than being
  // deleted. Dropping it would restart the counter at 0, and receivers discard
  // any version they have already seen -- so clearing the box after sending
  // would never reach the other browsers.
  const previous = drafts.get(key);
  const record: DraftRecord = { text, version: (previous?.version ?? 0) + 1 };
  drafts.set(key, record);

  const frame = draftFrame(projectId, record);
  for (const [client, clientUser] of clientUsers) {
    if (client === ws || clientUser !== id) continue;
    sendFrame(client, frame);
  }
}

/** Replies with the current draft so a newly opened tab catches up immediately. */
export function handleDraftSubscribe(
  ws: RealtimeClientConnection,
  userId: string | number | null,
  data: Record<string, unknown>,
): void {
  const id = readUserId(userId);
  const projectId = readProjectId(data.projectId);
  if (!id || !projectId) return;

  const record = drafts.get(draftKey(id, projectId));
  if (!record) return;
  sendFrame(ws, draftFrame(projectId, record));
}

/** Drops a project's draft once its message has actually been sent. */
export function clearDraft(userId: string | number | null, projectId: string): void {
  const id = readUserId(userId);
  if (!id) return;
  drafts.delete(draftKey(id, projectId));
}
