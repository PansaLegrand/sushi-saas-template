"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  ALLOW_ALL,
  DENY_ALL,
  isAllowed,
  readStoredConsent,
  writeStoredConsent,
  type ConsentCategory,
  type ConsentState,
} from "@/lib/consent";

interface ConsentContextValue {
  /** Null until the stored decision has been read, and while none exists. */
  state: ConsentState | null;
  /** False until mounted. Guards against rendering the banner during SSR. */
  ready: boolean;
  /** True once the visitor has made a choice. Drives banner visibility. */
  decided: boolean;
  allows: (category: ConsentCategory) => boolean;
  acceptAll: () => void;
  rejectAll: () => void;
  save: (state: ConsentState) => void;
  /**
   * Whether the banner is being shown again on request. Withdrawing consent has
   * to be as easy as giving it, so the footer can reopen this at any time.
   */
  promptOpen: boolean;
  openPrompt: () => void;
  closePrompt: () => void;
}

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConsentState | null>(null);
  const [ready, setReady] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);

  // The cookie can only be read after mount. Rendering the banner (or a gated
  // script) before this would either mismatch hydration or, worse, load the
  // script for one frame before the decision is known.
  useEffect(() => {
    setState(readStoredConsent());
    setReady(true);
  }, []);

  const save = useCallback((next: ConsentState) => {
    writeStoredConsent(next);
    setState(next);
    setPromptOpen(false);
  }, []);

  const value = useMemo<ConsentContextValue>(
    () => ({
      state,
      ready,
      decided: ready && state !== null,
      allows: (category) => ready && isAllowed(state, category),
      acceptAll: () => save({ ...ALLOW_ALL }),
      rejectAll: () => save({ ...DENY_ALL }),
      save,
      promptOpen,
      openPrompt: () => setPromptOpen(true),
      closePrompt: () => setPromptOpen(false),
    }),
    [state, ready, promptOpen, save]
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

/**
 * Consent for one category.
 *
 * Returns false when used outside the provider rather than throwing. A missing
 * provider must fail closed: the alternative is a refactor that silently starts
 * loading trackers again.
 */
export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext);

  if (!ctx) {
    return {
      state: null,
      ready: false,
      decided: false,
      allows: () => false,
      acceptAll: () => {},
      rejectAll: () => {},
      save: () => {},
      promptOpen: false,
      openPrompt: () => {},
      closePrompt: () => {},
    };
  }

  return ctx;
}
