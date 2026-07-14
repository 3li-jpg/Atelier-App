import { useCallback, useEffect, useRef, useState } from "react";

// Voice input via the native Web Speech API (no dependency). Safari/Chrome
// ship SpeechRecognition; Firefox doesn't — the hook no-ops gracefully there.
// Dictation appends interim results into the composer live; on stop the final
// transcript stays. The mic button is only rendered when the API exists.
//
// ponytail: one browser API, one hook. If recognition is unavailable, supported
// is false and the composer renders without the mic (graceful, no console noise).

type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function ctor(): (new () => SR) | null {
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useVoice(onTranscript: (finalText: string) => void) {
  const [supported] = useState(() => typeof window !== "undefined" && !!ctor());
  const [listening, setListening] = useState(false);
  const recRef = useRef<SR | null>(null);
  // Buffer the final transcript so multiple result events compose, not overwrite.
  const baseRef = useRef("");
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const stop = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* already stopped */ }
  }, []);

  const start = useCallback(() => {
    const SpeechRecognition = ctor();
    if (!SpeechRecognition) return;
    // Seed the buffer with whatever's currently in the composer so dictation
    // appends to existing text instead of replacing it.
    baseRef.current = "";
    const rec = new SpeechRecognition();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (final) baseRef.current += final;
      onTranscriptRef.current((baseRef.current + interim).trimStart());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch { /* start() can throw if called twice */ }
  }, []);

  // Toggle: starting while listening stops (and flushes the final transcript).
  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => () => { try { recRef.current?.abort(); } catch { /* gone */ } }, []);

  return { supported, listening, toggle, stop };
}
