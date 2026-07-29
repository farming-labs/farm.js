"use client";

import { useEffect, useState } from "react";
import type { StripeBillingStatusResult } from "@farm.js/integrations/stripe/client";
import { authClient } from "../../lib/auth-client";
import { readBillingHistory, type BillingHistoryEntry } from "../../lib/billing-history";
import { apiClient } from "../../lib/api";

type SessionState =
  | { status: "loading" }
  | { status: "unauthorized" }
  | { status: "ready"; user: { email: string; name: string } };

export default function DashboardPage() {
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [billingHistory, setBillingHistory] = useState<BillingHistoryEntry[]>([]);
  const [billingStatus, setBillingStatus] = useState<StripeBillingStatusResult | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    authClient.getSession().then(async (response) => {
      if (cancelled) return;

      if (response.error || !response.data?.user) {
        setSession({ status: "unauthorized" });
        return;
      }

      setSession({
        status: "ready",
        user: {
          email: response.data.user.email ?? "unknown@farmjs.dev",
          name: response.data.user.name ?? "Unknown User",
        },
      });
      setBillingHistory(readBillingHistory(response.data.user.email ?? ""));

      const statusResult = await apiClient.billing.status();
      if (cancelled) {
        return;
      }

      if (statusResult.error) {
        setBillingError(statusResult.error.message);
        return;
      }

      setBillingStatus(statusResult.data ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await authClient.signOut();
    window.location.href = "/";
  }

  return (
    <main className="page-shell">
      <section className="card form-card">
        <h1>Dashboard</h1>
        {session.status === "loading" ? <p>Loading session...</p> : null}
        {session.status === "unauthorized" ? (
          <>
            <p>You need to sign in before accessing the dashboard.</p>
            <a className="primary-link" href="/sign-in">
              Go to Sign In
            </a>
          </>
        ) : null}
        {session.status === "ready" ? (
          <>
            <p>
              Signed in as <strong>{session.user.name}</strong> ({session.user.email})
            </p>
            <div className="session-stack">
              <div className="session-line">
                <strong>Current Plan</strong>
                <span>{billingStatus?.planId ?? "free"}</span>
              </div>
              <div className="session-line">
                <strong>Billing Status</strong>
                <span>{billingStatus?.status ?? "free"}</span>
              </div>
              <div className="session-line">
                <strong>Stripe Customer</strong>
                <span>{billingStatus?.stripeCustomerId ?? "Not linked yet"}</span>
              </div>
              <div className="session-line">
                <strong>Saved Billing Entries</strong>
                <span>{billingHistory.length}</span>
              </div>
              {billingError ? (
                <div className="session-line">
                  <strong>Billing Error</strong>
                  <span>{billingError}</span>
                </div>
              ) : null}
              {billingHistory.length > 0 ? (
                billingHistory.map((entry) => (
                  <div className="session-line" key={entry.sessionId}>
                    <strong>{entry.lineItems[0]?.description ?? entry.mode ?? "Purchase"}</strong>
                    <span>
                      {typeof entry.amountTotal === "number"
                        ? `${(entry.amountTotal / 100).toFixed(2)} ${entry.currency ?? "usd"}`
                        : entry.paymentStatus ?? "unknown"}
                    </span>
                  </div>
                ))
              ) : (
                <div className="session-line">
                  <strong>No billing activity yet</strong>
                  <span>Complete a checkout to see it here.</span>
                </div>
              )}
            </div>
            <div className="action-row">
              <button className="primary-button" onClick={logout} type="button">
                Logout
              </button>
              <a className="secondary-link" href="/">
                Back to Stripe Demo
              </a>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
