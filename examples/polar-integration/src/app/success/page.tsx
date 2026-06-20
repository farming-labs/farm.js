"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../../lib/api";

export default function SuccessPage() {
  const [openingPortal, setOpeningPortal] = useState(false);
  const [status, setStatus] = useState<unknown>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      const result = await apiClient.billing.status();
      if (cancelled) {
        return;
      }

      if (result.error) {
        setFeedback(result.error.message);
        return;
      }

      setStatus(result.data ?? null);
    }

    void loadStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  async function openPortal() {
    setOpeningPortal(true);
    setFeedback(null);

    const result = await apiClient.billing.portal({
      body: {
        returnTo: "/success",
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
    <main className="page-shell">
      <section className="hero">
        <span className="eyebrow">Polar Checkout</span>
        <h1>Checkout Flow Complete</h1>
        <p>
          This page re-loads billing status from Polar customer state and lets you
          jump straight into the customer portal.
        </p>
      </section>

      <section className="playground-grid">
        <section className="card">
          <h2>Current Billing Status</h2>
          {feedback ? <div className="notice notice-error">{feedback}</div> : null}
          <pre className="response-pre">{JSON.stringify(status, null, 2)}</pre>
        </section>

        <section className="card">
          <h2>Next Step</h2>
          <p>
            If the checkout created or updated a Polar customer, you can open the
            customer portal from here.
          </p>
          <div className="action-row">
            <button
              className="primary-button"
              disabled={openingPortal}
              onClick={() => void openPortal()}
              type="button"
            >
              <span>{openingPortal ? "Opening Portal..." : "Open Customer Portal"}</span>
            </button>
            <a className="secondary-link" href="/dashboard">
              Return to Dashboard
            </a>
          </div>
        </section>
      </section>
    </main>
  );
}
