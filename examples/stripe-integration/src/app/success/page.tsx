"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../../lib/api";
import { SuccessClient } from "../success-client";

type SessionState =
  | { status: "idle"; sessionId?: string; portalActivated: boolean; customerId?: string }
  | { status: "loading"; sessionId?: string; portalActivated: boolean; customerId?: string }
  | {
      status: "ready";
      sessionId?: string;
      portalActivated: boolean;
      customerId?: string;
      session: unknown;
    }
  | {
      status: "error";
      sessionId?: string;
      portalActivated: boolean;
      customerId?: string;
      message: string;
    };

function readSearchState(): {
  sessionId?: string;
  portalActivated: boolean;
  customerId?: string;
} {
  if (typeof window === "undefined") {
    return {
      portalActivated: false,
    };
  }

  const search = new URLSearchParams(window.location.search);
  return {
    sessionId:
      typeof search.get("session_id") === "string"
        ? search.get("session_id") || undefined
        : undefined,
    portalActivated: search.get("portal") === "1",
    customerId:
      typeof search.get("customer_id") === "string"
        ? search.get("customer_id") || undefined
        : undefined,
  };
}

export default function SuccessPage() {
  const [state, setState] = useState<SessionState>(() => {
    const searchState = readSearchState();
    return {
      status: searchState.sessionId ? "loading" : "idle",
      ...searchState,
    };
  });

  useEffect(() => {
    const searchState = readSearchState();

    if (!searchState.sessionId) {
      setState({
        status: "idle",
        ...searchState,
      });
      return;
    }

    let cancelled = false;

    async function loadSession() {
      setState({
        status: "loading",
        ...searchState,
      });

      const result = await apiClient.billing.session({
        query: {
          sessionId: searchState.sessionId!,
        },
      });

      if (cancelled) {
        return;
      }

      if (result.error) {
        setState({
          status: "error",
          ...searchState,
          message: result.error.message,
        });
        return;
      }

      setState({
        status: "ready",
        ...searchState,
        customerId:
          searchState.customerId ||
          (typeof result.data?.customerId === "string"
            ? result.data.customerId
            : undefined),
        session: result.data,
      });
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="page-shell">
      <section className="hero">
        <span className="eyebrow">Checkout Result</span>
        <h1>Payment Flow Complete</h1>
        <p>
          This page resolves the Stripe Checkout Session through
          <code> apiClient.billing.session()</code> so the Billing Portal control
          stays fully interactive after the return from Stripe.
        </p>
      </section>

      <section className="playground-grid">
        <section className="card">
          <h2>Session Lookup</h2>
          {!state.sessionId ? <p>No session id was provided.</p> : null}
          {state.status === "loading" ? <p>Loading checkout session...</p> : null}
          {state.status === "error" ? <p>{state.message}</p> : null}
          {state.status === "ready" ? (
            <pre className="response-pre">{JSON.stringify(state.session, null, 2)}</pre>
          ) : null}
        </section>

        <SuccessClient
          customerId={state.customerId}
          portalActivated={state.portalActivated}
          sessionId={state.sessionId}
        />
      </section>
    </main>
  );
}
