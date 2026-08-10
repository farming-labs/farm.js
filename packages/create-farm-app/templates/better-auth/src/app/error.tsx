"use client";

import type { ErrorProps } from "@farm.js/core";

export default function ErrorBoundary({ error, reset }: ErrorProps) {
  const message = error instanceof Error ? error.message : "An unexpected error occurred.";

  return (
    <main className="error-shell">
      <section className="error-panel">
        <span className="section-index">ERROR / RECOVERABLE</span>
        <h1>That route did not finish loading.</h1>
        <p>{message}</p>
        <div className="hero-actions">
          <button className="button button-primary" onClick={reset} type="button">
            Try again
          </button>
          <a className="button button-secondary" href="/">
            Return home
          </a>
        </div>
      </section>
    </main>
  );
}
