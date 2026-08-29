import type {
  VoiceAudioUpload,
  VoiceRequestOverrides,
  VoiceService,
  VoiceServiceResult,
  VoiceSpeechPayload,
} from '@/shared/types.js';

type VoiceServiceDependencies = {
  defaults: {
    /**
     * Speech-to-text backend family. 'openai' posts multipart audio to
     * {baseUrl}/audio/transcriptions. 'gemini' is supported because Gemini has
     * no OpenAI-compatible transcription route -- its OpenAI shim returns 404
     * for /audio/transcriptions -- so it needs generateContent with inline audio.
     */
    sttProvider?: 'openai' | 'gemini';
    geminiBaseUrl?: string;
    baseUrl: string;
    apiKey: string;
    sttModel: string;
    ttsModel: string;
    ttsVoice: string;
  };
  timeoutMs: number;
  fetchBackend(url: string, options: RequestInit): Promise<Response>;
};

type ResolvedVoiceConfig = {
  sttProvider: 'openai' | 'gemini';
  geminiBaseUrl: string;
  baseUrl: string;
  apiKey: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  ttsFormat: string;
};

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function resolveVoiceConfig(
  defaults: VoiceServiceDependencies['defaults'],
  overrides: VoiceRequestOverrides,
): ResolvedVoiceConfig {
  return {
    sttProvider: defaults.sttProvider ?? 'openai',
    geminiBaseUrl: defaults.geminiBaseUrl || DEFAULT_GEMINI_BASE_URL,
    baseUrl: defaults.baseUrl,
    apiKey: overrides.apiKey || defaults.apiKey,
    sttModel: overrides.sttModel || defaults.sttModel,
    ttsModel: overrides.ttsModel || defaults.ttsModel,
    ttsVoice: overrides.ttsVoice || defaults.ttsVoice,
    ttsFormat: overrides.ttsFormat?.trim() ?? '',
  };
}

function validateBackendBaseUrl(baseUrl: string): boolean {
  try {
    const parsedUrl = new URL(baseUrl);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return false;
    }

    // Local and private backends are supported intentionally. Only link-local
    // metadata addresses remain blocked as a defense in depth measure.
    return parsedUrl.hostname !== '169.254.169.254'
      && !parsedUrl.hostname.startsWith('169.254.');
  } catch {
    return false;
  }
}

function authorizationHeader(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function backendFailure(status: number, responseText?: string): VoiceServiceResult<never> {
  if (status === 401 || status === 403) {
    return {
      ok: false,
      status: 502,
      error: 'Voice backend rejected the request (check the API key).',
    };
  }

  return {
    ok: false,
    status,
    error: responseText || 'voice backend error',
  };
}

function unreachableBackendFailure(error: unknown, timeoutMs: number): VoiceServiceResult<never> {
  if (error instanceof Error && error.name === 'AbortError') {
    return {
      ok: false,
      status: 504,
      error: `Voice backend timed out after ${Math.round(timeoutMs / 1000)}s. Check your voice backend.`,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    status: 502,
    error: `Voice backend unreachable: ${message}`,
  };
}

function validateConfiguredBackend(config: ResolvedVoiceConfig): VoiceServiceResult<never> | null {
  if (!config.baseUrl) {
    return { ok: false, status: 503, error: 'No voice backend configured' };
  }

  if (!validateBackendBaseUrl(config.baseUrl)) {
    return { ok: false, status: 400, error: 'Invalid voice backend URL.' };
  }

  return null;
}

function createTranscriptionFormData(audio: VoiceAudioUpload, sttModel: string): FormData {
  const formData = new FormData();
  formData.append('file', new Blob([audio.bytes], { type: audio.mimeType }), audio.fileName);
  formData.append('model', sttModel);
  return formData;
}


/**
 * Transcription instruction carried over from the fork's client-side recorder:
 * callers dictate in any language and expect an English prompt back.
 */
const GEMINI_TRANSCRIBE_INSTRUCTION =
  'Transcribe this audio and output English text only. If speech is not English, '
  + 'translate it to English. Never include Arabic or bilingual output. Return only '
  + 'the final transcript sentence(s) with no labels or prefixes.';

function geminiTranscriptionBody(audio: VoiceAudioUpload): string {
  return JSON.stringify({
    contents: [
      {
        parts: [
          { text: GEMINI_TRANSCRIBE_INSTRUCTION },
          {
            inline_data: {
              mime_type: audio.mimeType,
              data: Buffer.from(audio.bytes).toString('base64'),
            },
          },
        ],
      },
    ],
  });
}

/** Pulls the transcript out of a generateContent response, tolerating missing parts. */
function readGeminiText(responseText: string): string {
  try {
    const parsed = JSON.parse(responseText) as {
      candidates?: { content?: { parts?: { text?: unknown }[] } }[];
    };
    const parts = parsed.candidates?.[0]?.content?.parts ?? [];
    return parts
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  } catch {
    return '';
  }
}

/**
 * Creates the Voice application service used by the Voice composition root and
 * its unit tests. The outbound request function and server configuration are
 * required so the service never reads globals or creates production defaults.
 */
export function createVoiceService(dependencies: VoiceServiceDependencies): VoiceService {
  return {
    getHealth: () => ({
      configured: dependencies.defaults.sttProvider === 'gemini'
        ? Boolean(dependencies.defaults.apiKey)
        : Boolean(dependencies.defaults.baseUrl),
    }),

    async transcribe(input) {
      const config = resolveVoiceConfig(dependencies.defaults, input.overrides);

      if (config.sttProvider === 'gemini') {
        if (!config.apiKey) {
          return { ok: false, status: 503, error: 'No voice backend configured' };
        }
        const url = `${config.geminiBaseUrl}/models/${encodeURIComponent(config.sttModel)}:generateContent`;
        console.log(
          `[voice] transcribe provider=gemini model=${config.sttModel} `
          + `bytes=${input.audio.bytes.length} type=${input.audio.mimeType}`,
        );
        try {
          const response = await dependencies.fetchBackend(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': config.apiKey,
            },
            body: geminiTranscriptionBody(input.audio),
          });
          const responseText = await response.text();
          if (!response.ok) {
            return backendFailure(response.status, responseText);
          }
          const text = readGeminiText(responseText);
          console.log(`[voice] gemini transcript chars=${text.length}`);
          return { ok: true, value: { text } };
        } catch (error) {
          return unreachableBackendFailure(error, dependencies.timeoutMs);
        }
      }

      const configurationFailure = validateConfiguredBackend(config);
      if (configurationFailure) {
        return configurationFailure;
      }

      console.log(
        `[voice] transcribe provider=openai-compatible base=${config.baseUrl} `
        + `model=${config.sttModel}`,
      );
      try {
        const response = await dependencies.fetchBackend(
          `${config.baseUrl}/audio/transcriptions`,
          {
            method: 'POST',
            headers: authorizationHeader(config.apiKey),
            body: createTranscriptionFormData(input.audio, config.sttModel),
          },
        );
        const responseText = await response.text();
        if (!response.ok) {
          return backendFailure(response.status, responseText);
        }

        try {
          const parsed = JSON.parse(responseText) as { text?: unknown };
          return {
            ok: true,
            value: { text: typeof parsed.text === 'string' ? parsed.text : '' },
          };
        } catch {
          return { ok: true, value: { text: responseText } };
        }
      } catch (error) {
        return unreachableBackendFailure(error, dependencies.timeoutMs);
      }
    },

    async synthesizeSpeech(input) {
      const config = resolveVoiceConfig(dependencies.defaults, input.overrides);
      const configurationFailure = validateConfiguredBackend(config);
      if (configurationFailure) {
        return configurationFailure;
      }

      try {
        const response = await dependencies.fetchBackend(`${config.baseUrl}/audio/speech`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authorizationHeader(config.apiKey),
          },
          body: JSON.stringify({
            model: config.ttsModel,
            voice: config.ttsVoice,
            input: input.text,
            ...(config.ttsFormat ? { response_format: config.ttsFormat } : {}),
          }),
        });

        if (!response.ok) {
          const responseText = await response.text().catch(() => 'tts failed');
          return backendFailure(response.status, responseText);
        }

        const value: VoiceSpeechPayload = {
          contentType: response.headers.get('content-type') || 'audio/mpeg',
          body: response.body,
        };
        return { ok: true, value };
      } catch (error) {
        return unreachableBackendFailure(error, dependencies.timeoutMs);
      }
    },
  };
}
