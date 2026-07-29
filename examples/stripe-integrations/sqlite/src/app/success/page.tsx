"use client";

import { useEffect, useState } from "react";
import type { StripeSessionResult } from "@farm.js/integrations/stripe/client";
import { apiClient } from "../../lib/api";
import { authClient } from "../../lib/auth-client";
import { saveBillingHistoryEntry } from "../../lib/billing-history";
import { SuccessClient } from "../success-client";

type SessionState =
  | { status: "idle"; sessionId?: string; portalActivated: boolean; customerId?: string }
  | { status: "loading"; sessionId?: string; portalActivated: boolean; customerId?: string }
  | {
      status: "ready";
      sessionId?: string;
      portalActivated: boolean;
      customerId?: string;
      session: StripeSessionResult;
    }
  | {
      status: "error";
      sessionId?: string;
      portalActivated: boolean;
      customerId?: string;
      message: string;
    };

function readSearchState() {
  if (typeof window === "undefined") {
    return {
      sessionId: undefined,
      portalActivated: false,
      customerId: undefined,
    };
  }

  const search = new URLSearchParams(window.location.search);
  return {
    sessionId: search.get("session_id") || undefined,
    portalActivated: search.get("portal") === "1",
    customerId: search.get("customer_id") || undefined,
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

      if (!result.data) {
        setState({
          status: "error",
          ...searchState,
          message: "Stripe session lookup returned no session data.",
        });
        return;
      }

      setState({
        status: "ready",
        ...searchState,
        customerId:
          searchState.customerId ||
          (typeof result.data.customerId === "string"
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

  useEffect(() => {
    if (state.status !== "ready") {
      return;
    }

    let cancelled = false;

    authClient.getSession().then((response) => {
      if (cancelled) {
        return;
      }

      const authenticatedEmail = response.data?.user?.email?.trim();
      const email = authenticatedEmail || state.session.customerEmail?.trim() || "";
      if (!email) {
        return;
      }

      saveBillingHistoryEntry({
        email,
        sessionId: state.sessionId ?? state.session.id,
        customerId: state.customerId ?? state.session.customerId,
        status: state.session.status,
        paymentStatus: state.session.paymentStatus,
        mode: state.session.mode,
        amountTotal: state.session.amountTotal,
        currency: state.session.currency,
        capturedAt: new Date().toISOString(),
        lineItems: state.session.lineItems,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [state]);

  return (
    <main className="page-shell">
      <section className="hero">
        <span className="eyebrow">Checkout Result</span>
        <h1>Payment Flow Complete</h1>
        <p>
          This page resolves the Checkout Session through the Stripe integration,
          then reuses that state to open the portal flow.
        </p>
      </section>

      <section className="playground-grid">
        <section className="card">
          <h2>Session Lookup</h2>
          {!state.sessionId ? <p>No session id was provided.</p> : null}
          {state.status === "loading" ? <p>Loading checkout session...</p> : null}
          {state.status === "error" ? <p>{state.message}</p> : null}
          {state.status === "ready" ? (
            <>
              <div className="session-stack">
                <div className="session-line">
                  <strong>Customer</strong>
                  <span>{state.session.customerEmail ?? "Unknown email"}</span>
                </div>
                <div className="session-line">
                  <strong>Payment Status</strong>
                  <span>{state.session.paymentStatus ?? "unknown"}</span>
                </div>
                <div className="session-line">
                  <strong>Total</strong>
                  <span>
                    {typeof state.session.amountTotal === "number"
                      ? `${(state.session.amountTotal / 100).toFixed(2)} ${state.session.currency ?? "usd"}`
                      : "Unknown total"}
                  </span>
                </div>
              </div>
              <pre className="response-pre">{JSON.stringify(state.session, null, 2)}</pre>
            </>
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
