/**
 * The in-flight answer text lives here, outside React state. Tokens arrive
 * every few milliseconds; keeping the string in App state re-rendered the
 * entire workspace (rails, canvas, overlays) per token. Readers subscribe via
 * useSyncExternalStore (AnswerSurface); App only writes.
 */
export interface VerdictStore {
  get: () => string;
  reset: () => void;
  append: (t: string) => void;
  set: (s: string) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createVerdictStore(): VerdictStore {
  let text = "";
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  return {
    get: () => text,
    reset: () => {
      text = "";
      notify();
    },
    append: (t: string) => {
      if (!t) return;
      text += t;
      notify();
    },
    set: (s: string) => {
      text = s;
      notify();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const verdictStore = createVerdictStore();
