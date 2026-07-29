"use client";

/**
 * Last-resort admin boundary.
 *
 * A global error replaces the root layout, so this file supplies its own
 * document and styling and deliberately avoids shared UI dependencies.
 */

import { useEffect, useRef } from "react";

export default function AdminGlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    console.error("Admin console root failure", error);
  }, [error]);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Admin console unavailable</title>
        <meta name="color-scheme" content="light dark" />
      </head>
      <body>
        <style>{`
          :root {
            color-scheme: light dark;
            font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100vh;
            background: #f8fafc;
            color: #0f172a;
          }
          .admin-global {
            display: flex;
            min-height: 100vh;
            align-items: center;
            justify-content: center;
            padding: 2rem 1rem;
          }
          .admin-global__card {
            width: 100%;
            max-width: 34rem;
            padding: 2rem;
            border: 1px solid #e2e8f0;
            border-radius: 0.875rem;
            background: #ffffff;
            box-shadow: 0 12px 32px rgb(15 23 42 / 0.08);
            text-align: center;
          }
          .admin-global__mark {
            display: inline-flex;
            width: 3rem;
            height: 3rem;
            align-items: center;
            justify-content: center;
            border-radius: 0.75rem;
            background: #fee2e2;
            color: #b91c1c;
            font-weight: 700;
          }
          .admin-global__eyebrow {
            margin: 1.25rem 0 0;
            color: #b91c1c;
            font-size: 0.75rem;
            font-weight: 700;
            letter-spacing: 0.14em;
            text-transform: uppercase;
          }
          .admin-global h1 {
            margin: 0.25rem 0 0;
            font-size: 1.5rem;
            line-height: 1.3;
            outline: none;
          }
          .admin-global__description {
            max-width: 27rem;
            margin: 0.75rem auto 0;
            color: #64748b;
            font-size: 0.875rem;
            line-height: 1.6;
          }
          .admin-global__reference {
            margin: 1rem 0 0;
            color: #64748b;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.75rem;
          }
          .admin-global__actions {
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 0.75rem;
            margin-top: 1.5rem;
          }
          .admin-global__action {
            min-height: 2.5rem;
            padding: 0.55rem 1rem;
            border: 1px solid #cbd5e1;
            border-radius: 0.5rem;
            background: #ffffff;
            color: #0f172a;
            cursor: pointer;
            font: inherit;
            font-size: 0.875rem;
            font-weight: 600;
            text-decoration: none;
          }
          .admin-global__action--primary {
            border-color: #0f172a;
            background: #0f172a;
            color: #ffffff;
          }
          .admin-global__action:hover { filter: brightness(0.96); }
          .admin-global__action:focus-visible {
            outline: 3px solid #60a5fa;
            outline-offset: 3px;
          }
          @media (prefers-color-scheme: dark) {
            body { background: #020617; color: #f8fafc; }
            .admin-global__card {
              border-color: #1e293b;
              background: #0f172a;
              box-shadow: 0 12px 32px rgb(0 0 0 / 0.28);
            }
            .admin-global__mark { background: #450a0a; color: #fca5a5; }
            .admin-global__eyebrow { color: #fca5a5; }
            .admin-global__description,
            .admin-global__reference { color: #94a3b8; }
            .admin-global__action {
              border-color: #475569;
              background: #0f172a;
              color: #f8fafc;
            }
            .admin-global__action--primary {
              border-color: #f8fafc;
              background: #f8fafc;
              color: #0f172a;
            }
          }
        `}</style>

        <main className="admin-global" aria-labelledby="admin-global-title">
          <section className="admin-global__card">
            <span className="admin-global__mark" aria-hidden>
              !
            </span>
            <p className="admin-global__eyebrow">System recovery</p>
            <h1 ref={headingRef} id="admin-global-title" tabIndex={-1}>
              The admin console could not start
            </h1>
            <p className="admin-global__description">
              Try loading the console again. If the problem continues, share the
              reference below with your incident team.
            </p>
            {error.digest ? (
              <p className="admin-global__reference">
                Reference: {error.digest}
              </p>
            ) : null}
            <div className="admin-global__actions">
              {/* A hard navigation is intentional: the root layout just failed. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a className="admin-global__action" href="/">
                Reload console
              </a>
              <button
                className="admin-global__action admin-global__action--primary"
                type="button"
                onClick={reset}
              >
                Try again
              </button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
