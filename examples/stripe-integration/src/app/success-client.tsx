"use client";

import { useState } from "react";
import { apiClient } from "../lib/api";

export function SuccessClient(props: {
  sessionId?: string;
  customerId?: string;
  portalActivated: boolean;
}) {
  const [openingPortal, setOpeningPortal] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function openPortal() {
    if (!props.sessionId && !props.customerId) {
      setFeedback("A session id or customer id is required to open the billing portal.");
      return;
    }

    setOpeningPortal(true);
    setFeedback(null);

    const result = await apiClient.billing.portal({
      body: {
        sessionId: props.sessionId,
        customerId: props.customerId,
        returnTo: props.sessionId ? `/success?session_id=${props.sessionId}` : "/success",
      },
    });

    if (result.error) {
      setFeedback(result.error.message);
      setOpeningPortal(false);
      return;
    }

    if (result.data?.redirectTo) {
      window.location.assign(result.data.redirectTo);
      return;
    }

    setOpeningPortal(false);
  }

  return (
    <section className="card">
      <h2>Next Step</h2>
      {props.portalActivated ? (
        <div className="notice notice-success">
          Billing portal flow completed and returned back to this page.
        </div>
      ) : null}
      {feedback ? <div className="notice notice-error">{feedback}</div> : null}

      <div className="session-stack">
        <div className="session-line">
          <strong>Client Checkout</strong>
          <span><code>apiClient.billing.checkout()</code></span>
        </div>
        <div className="session-line">
          <strong>Server Session</strong>
          <span><code>api.billing.session()</code></span>
        </div>
        <div className="session-line">
          <strong>Billing Portal</strong>
          <span><code>apiClient.billing.portal()</code></span>
        </div>
      </div>

      <div className="action-row">
        <button
          className="primary-button"
          disabled={openingPortal}
          onClick={() => void openPortal()}
          type="button"
        >
          {openingPortal ? <span className="button-spinner" aria-hidden="true" /> : null}
          <span>{openingPortal ? "Opening Portal..." : "Open Billing Portal"}</span>
        </button>
        <a className="secondary-link" href="/">
          Start Another Checkout
        </a>
      </div>
    </section>
  );
}
