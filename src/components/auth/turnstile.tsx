"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import { getCaptchaSiteKey, isCaptchaEnabled } from "@/lib/captcha";

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      "timeout-callback"?: () => void;
      theme?: "light" | "dark" | "auto";
      appearance?: "always" | "execute" | "interaction-only";
    }
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("failed to load turnstile"))
      );
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Allow a later mount to retry rather than caching the failure forever.
      scriptPromise = null;
      reject(new Error("failed to load turnstile"));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export interface TurnstileHandle {
  /**
   * Discard the current token and re-run the challenge. Turnstile tokens are
   * single-use, so this must be called after every submit attempt.
   */
  reset: () => void;
}

interface TurnstileProps {
  /** Receives the token, or `null` when it expires or the challenge errors. */
  onToken: (token: string | null) => void;
  onError?: () => void;
  className?: string;
}

/**
 * Cloudflare Turnstile widget.
 *
 * Renders nothing when the challenge is disabled or unconfigured, so forms can
 * mount it unconditionally.
 */
export const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(
  function Turnstile({ onToken, onError, className }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const widgetIdRef = useRef<string | null>(null);
    const onTokenRef = useRef(onToken);
    const onErrorRef = useRef(onError);

    // Keep the latest callbacks without re-rendering the widget, which would
    // reset the challenge on every parent state change.
    useEffect(() => {
      onTokenRef.current = onToken;
      onErrorRef.current = onError;
    }, [onToken, onError]);

    useImperativeHandle(
      ref,
      () => ({
        reset: () => {
          if (widgetIdRef.current && window.turnstile) {
            window.turnstile.reset(widgetIdRef.current);
            onTokenRef.current(null);
          }
        },
      }),
      []
    );

    const enabled = isCaptchaEnabled();
    const siteKey = getCaptchaSiteKey();

    useEffect(() => {
      if (!enabled || !siteKey) return;

      let cancelled = false;

      loadTurnstileScript()
        .then(() => {
          if (cancelled || !containerRef.current || !window.turnstile) return;
          if (widgetIdRef.current) return;

          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            callback: (token) => onTokenRef.current(token),
            "error-callback": () => {
              onTokenRef.current(null);
              onErrorRef.current?.();
            },
            "expired-callback": () => onTokenRef.current(null),
            "timeout-callback": () => onTokenRef.current(null),
            theme: "auto",
          });
        })
        .catch(() => {
          if (cancelled) return;
          onTokenRef.current(null);
          onErrorRef.current?.();
        });

      return () => {
        cancelled = true;
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
      };
    }, [enabled, siteKey]);

    if (!enabled || !siteKey) return null;

    return <div ref={containerRef} className={className} />;
  }
);

/**
 * Whether a form may submit given the current token. Always true when the
 * challenge is off.
 */
export function canSubmitWithCaptcha(token: string | null): boolean {
  return !isCaptchaEnabled() || Boolean(token);
}

export default Turnstile;
