import { useState, useRef, useCallback, useEffect } from 'react';

const GEMINI_API_KEY = (import.meta.env.VITE_GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = (import.meta.env.VITE_GEMINI_TRANSCRIBE_MODEL || 'gemini-2.5-flash').trim();
const GEMINI_URL = GEMINI_API_KEY
  ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`
  : null;

const RECORDING_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
];

export function useVoiceInput(onTranscription: (text: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef('audio/webm');
  const startedAtRef = useRef(0);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const supportedMimeType = RECORDING_MIME_CANDIDATES.find((mimeType) => (
        typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mimeType)
      ));

      const mediaRecorder = supportedMimeType
        ? new MediaRecorder(stream, { mimeType: supportedMimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mimeTypeRef.current = mediaRecorder.mimeType || supportedMimeType || 'audio/webm';
      startedAtRef.current = Date.now();

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        const recordedMs = Date.now() - startedAtRef.current;
        const totalBytes = chunksRef.current.reduce((total, chunk) => total + chunk.size, 0);
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        chunksRef.current = [];

        if (recordedMs < 450 || totalBytes < 1024) {
          alert('Recording is too short. Please hold the mic button and speak for at least one second.');
          return;
        }

        await processAudio(blob, mimeTypeRef.current);
      };

      mediaRecorder.start(250);
      setIsRecording(true);
    } catch (error) {
      console.error('Microphone access failed', error);
      alert('Microphone access denied');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  const processAudio = async (blob: Blob, mimeType: string) => {
    setIsProcessing(true);
    try {
      if (!GEMINI_URL) {
        throw new Error('Voice transcription is not configured. Set VITE_GEMINI_API_KEY.');
      }

      const base64 = await blobToBase64(blob);

      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: base64,
                  },
                },
                {
                  text: 'Transcribe this audio and output English text only. If speech is not English, translate it to English. Never include Arabic or bilingual output. Return only the final transcript sentence(s) with no labels or prefixes.',
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
          },
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message = data?.error?.message || `HTTP ${res.status}`;
        throw new Error(message);
      }

      const text = extractGeminiText(data);
      if (text) {
        onTranscription(cleanTranscript(text));
      } else {
        console.error('Gemini transcription response:', data);
        throw new Error('No transcription text was returned by Gemini.');
      }
    } catch (error) {
      console.error('Audio transcription failed', error);
      const reason = error instanceof Error ? error.message : 'Unknown error';
      alert(`Transcription failed: ${reason}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      if (!isProcessing) {
        startRecording();
      }
    }
  }, [isProcessing, isRecording, startRecording, stopRecording]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  return { isRecording, isProcessing, toggleRecording };
}

function extractGeminiText(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return '';
  }

  const parts = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    .candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('\n')
    .trim();
}

function cleanTranscript(text: string): string {
  const cleaned = text
    .replace(/^transcript:\s*/i, '')
    .replace(/^transcription:\s*/i, '')
    .trim();

  const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(cleaned);
  const hasLatin = /[A-Za-z]/.test(cleaned);

  if (hasArabic && hasLatin) {
    const lines = cleaned
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    const englishOnlyLines = lines.filter(
      (line) => /[A-Za-z]/.test(line) && !/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(line),
    );

    if (englishOnlyLines.length > 0) {
      return englishOnlyLines.join(' ').replace(/\s+/g, ' ').trim();
    }

    const strippedArabic = cleaned
      .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (/[A-Za-z]/.test(strippedArabic)) {
      return strippedArabic;
    }
  }

  return cleaned;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
