import { useState } from 'react';

export type VoiceConfig = {
  baseUrl: string;
  apiKey: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  ttsFormat: string;
};

const STORAGE_KEY = 'voiceConfig';
export const VOICE_CONFIG_SYNC_EVENT = 'voice-config:sync';
const DEFAULTS: VoiceConfig = { baseUrl: '', apiKey: '', sttModel: '', ttsModel: '', ttsVoice: '', ttsFormat: '' };

const MIGRATION_KEY = 'voiceConfig:geminiBackendReset';

/**
 * One-time clear of client-side voice overrides.
 *
 * Transcription runs through the server's Gemini backend. A stored `baseUrl`
 * makes the browser POST to that URL directly and skip the server entirely,
 * and a stored `sttModel` (typically a leftover `whisper-1`) is forwarded as an
 * override that Gemini has no model for. Both are stale values from the
 * pre-upgrade build, so drop them once per browser and let the server defaults
 * apply. Users who genuinely want a custom backend can set one again.
 */
function resetLegacyVoiceConfig(): void {
  if (typeof window === 'undefined') return;
  try {
    if (localStorage.getItem(MIGRATION_KEY)) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(MIGRATION_KEY, '1');
  } catch {
    // Storage unavailable (private mode). Nothing stored means nothing to clear.
  }
}

resetLegacyVoiceConfig();

export function readVoiceConfig(): VoiceConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULTS };
    const config = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as (keyof VoiceConfig)[]) {
      if (typeof parsed[key] === 'string') config[key] = parsed[key];
    }
    return config;
  } catch {
    return { ...DEFAULTS };
  }
}

// Headers the voice proxy reads to target a per-user OpenAI-compatible backend.
// Empty fields are omitted so the server's env defaults apply.
export function voiceConfigHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const c = readVoiceConfig();
  const h: Record<string, string> = {};
  if (c.apiKey) h['x-voice-api-key'] = c.apiKey;
  if (c.sttModel) h['x-voice-stt-model'] = c.sttModel;
  if (c.ttsModel) h['x-voice-tts-model'] = c.ttsModel;
  if (c.ttsVoice) h['x-voice-tts-voice'] = c.ttsVoice;
  if (c.ttsFormat.trim()) h['x-voice-tts-format'] = c.ttsFormat.trim();
  return h;
}

export function useVoiceConfig() {
  const [config, setConfig] = useState<VoiceConfig>(() =>
    typeof window === 'undefined' ? { ...DEFAULTS } : readVoiceConfig(),
  );

  const update = (patch: Partial<VoiceConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      try {
        const stored: Partial<VoiceConfig> = { ...next };
        if (next.ttsFormat.trim()) stored.ttsFormat = next.ttsFormat.trim();
        else delete stored.ttsFormat;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        window.dispatchEvent(new Event(VOICE_CONFIG_SYNC_EVENT));
      } catch {
        /* ignore persistence errors */
      }
      return next;
    });
  };

  return { config, update };
}
