"use client";

import { useEffect, useState } from "react";

interface MockStatus {
  source: string;
  status: string;
  inventory: number;
}

export function BrowserStatus() {
  const [server, setServer] = useState<MockStatus | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [browser, setBrowser] = useState<MockStatus | null>(null);
  const [browserError, setBrowserError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void loadStatus("/api/server-status", controller.signal).then(setServer, (reason: unknown) => {
      if (!controller.signal.aborted) setServerError(errorMessage(reason));
    });
    void loadStatus(
      "https://inventory.farm.test/status?surface=browser",
      controller.signal,
    ).then(setBrowser, (reason: unknown) => {
      if (!controller.signal.aborted) setBrowserError(errorMessage(reason));
    });

    return () => controller.abort();
  }, []);

  return (
    <div className="runtime-grid" aria-live="polite">
      <RuntimeStatus
        label="Server"
        waiting="Waiting for API route"
        expectedAdapter="Node interceptor"
        result={server}
        error={serverError}
      />
      <RuntimeStatus
        label="Browser"
        waiting="Waiting for worker"
        expectedAdapter="service worker"
        result={browser}
        error={browserError}
      />
    </div>
  );
}

function RuntimeStatus({
  label,
  waiting,
  expectedAdapter,
  result,
  error,
}: {
  label: string;
  waiting: string;
  expectedAdapter: string;
  result: MockStatus | null;
  error: string | null;
}) {
  return (
    <section className="runtime">
      <div className="runtime-heading">
        <span className={`status-dot ${result ? "ready" : error ? "failed" : "pending"}`} />
        <div>
          <p className="runtime-label">{label}</p>
          <h2>{result ? "Intercepted" : error ? "Not intercepted" : waiting}</h2>
        </div>
      </div>
      <dl>
        <div>
          <dt>Adapter</dt>
          <dd>{result?.source ?? expectedAdapter}</dd>
        </div>
        <div>
          <dt>Response</dt>
          <dd>{result ? `${result.inventory} items` : error ?? "pending"}</dd>
        </div>
      </dl>
    </section>
  );
}

async function loadStatus(url: string, signal: AbortSignal): Promise<MockStatus> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return response.json() as Promise<MockStatus>;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
