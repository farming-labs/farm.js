"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { apiClient } from "../lib/api";
import type {
  LocalDemoEchoResult,
  LocalDemoStatusResult,
} from "../lib/integrations/local-demo";

type Feedback =
  | {
      tone: "error" | "success";
      message: string;
    }
  | null;

function asStatusResult(value: unknown): LocalDemoStatusResult | null {
  if (
    value &&
    typeof value === "object" &&
    "integration" in value &&
    "bootedAt" in value
  ) {
    return value as LocalDemoStatusResult;
  }

  return null;
}

function asEchoResult(value: unknown): LocalDemoEchoResult | null {
  if (
    value &&
    typeof value === "object" &&
    "uppercase" in value &&
    "length" in value
  ) {
    return value as LocalDemoEchoResult;
  }

  return null;
}

export default function LocalDemoCard() {
  const [message, setMessage] = useState("Farm custom integrations");
  const [status, setStatus] = useState<LocalDemoStatusResult | null>(null);
  const [echo, setEcho] = useState<LocalDemoEchoResult | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [submittingEcho, setSubmittingEcho] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      setLoadingStatus(true);
      const result = await apiClient.localDemo.message.get();

      if (cancelled) {
        return;
      }

      if (result.error) {
        setFeedback({
          tone: "error",
          message: result.error.message,
        });
        setStatus(null);
      } else {
        setFeedback(null);
        setStatus(asStatusResult(result.data));
      }

      setLoadingStatus(false);
    }

    void loadStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshStatus() {
    setLoadingStatus(true);
    const result = await apiClient.localDemo.message.get();

    if (result.error) {
      setFeedback({
        tone: "error",
        message: result.error.message,
      });
      setStatus(null);
    } else {
      setFeedback(null);
      setStatus(asStatusResult(result.data));
    }

    setLoadingStatus(false);
  }

  async function handleEcho(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingEcho(true);
    setFeedback(null);

    const result = await apiClient.localDemo.message.post({
      body: {
        message,
      },
    });

    if (result.error) {
      setFeedback({
        tone: "error",
        message: result.error.message,
      });
      setEcho(null);
    } else {
      setFeedback({
        tone: "success",
        message: "Custom integration request completed.",
      });
      setEcho(asEchoResult(result.data));
    }

    setSubmittingEcho(false);
  }

  return (
    <section className="card">
      <h2>App-local Integration</h2>
      <p>
        This demo is defined inside the example itself and registered in <code>farm.config.ts</code>.
        Farm infers the typed client calls from the integration routes and keeps the actual handler
        code on the server. The per-route middleware array also runs before the handler for these
        requests.
      </p>

      {feedback ? (
        <div className={`auth-notice auth-notice-${feedback.tone}`}>{feedback.message}</div>
      ) : null}

      <div className="action-row">
        <button className="ghost-button" type="button" onClick={refreshStatus} disabled={loadingStatus}>
          {loadingStatus ? <span className="button-spinner" aria-hidden="true" /> : null}
          <span>{loadingStatus ? "Refreshing status..." : "Refresh local status"}</span>
        </button>
      </div>

      <div className="response-panel">
        <div className="response-meta">
          <span className="status-pill">GET /api/local-demo/message</span>
          <strong>{status?.message || "Waiting for the local integration response."}</strong>
        </div>
        <pre>{JSON.stringify(status, null, 2)}</pre>
      </div>

      <form className="auth-form" onSubmit={handleEcho}>
        <label className="auth-label">
          <span>Echo Message</span>
          <input
            className="auth-input"
            type="text"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Type anything"
            required
          />
        </label>

        <button
          className="auth-submit"
          type="submit"
          disabled={submittingEcho || message.trim().length === 0}
        >
          {submittingEcho ? <span className="button-spinner" aria-hidden="true" /> : null}
          <span>{submittingEcho ? "Sending echo..." : "Send echo"}</span>
        </button>
      </form>

      <div className="response-panel">
        <div className="response-meta">
          <span className="status-pill">POST /api/local-demo/message</span>
          <strong>Typed client call through the same shared integration API.</strong>
        </div>
        <pre>{JSON.stringify(echo, null, 2)}</pre>
      </div>
    </section>
  );
}
