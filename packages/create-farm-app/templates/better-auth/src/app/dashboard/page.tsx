"use client";

import { useEffect, useState } from "react";
import { SignOutButton } from "../../components/sign-out-button";
import { SiteHeader } from "../../components/site-header";
import { authClient } from "../../lib/auth-client";

type SessionState =
  | { status: "loading" }
  | { status: "unauthorized" }
  | {
      status: "ready";
      session: {
        user: {
          createdAt: Date | string;
          email: string;
          name: string;
        };
        session: {
          expiresAt: Date | string;
          id: string;
        };
      };
    };

export default function DashboardPage() {
  const [sessionState, setSessionState] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    authClient
      .getSession()
      .then((response) => {
        if (cancelled) {
          return;
        }

        if (response.error || !response.data?.user) {
          setSessionState({ status: "unauthorized" });
          window.location.replace("/sign-in");
          return;
        }

        setSessionState({
          status: "ready",
          session: response.data,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setSessionState({ status: "unauthorized" });
          window.location.replace("/sign-in");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (sessionState.status === "loading") {
    return (
      <main className="loading-shell" aria-label="Loading account" aria-live="polite">
        <div className="loading-block">
          <span className="loading-label">Verifying protected session</span>
          <div className="loading-line wide" />
          <div className="loading-line" />
          <div className="loading-grid">
            <div />
            <div />
          </div>
        </div>
      </main>
    );
  }

  if (sessionState.status === "unauthorized") {
    return (
      <main className="loading-shell" aria-label="Returning to sign in" aria-live="polite">
        <div className="loading-block">
          <span className="loading-label">Session unavailable</span>
          <p className="loading-message">Returning you to the sign-in page…</p>
        </div>
      </main>
    );
  }

  const { session } = sessionState;
  const createdAt = new Date(session.user.createdAt).toLocaleDateString("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const expiresAt = new Date(session.session.expiresAt).toLocaleString("en", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });

  return (
    <div className="site-frame">
      <SiteHeader user={session.user} />

      <main className="dashboard-shell">
        <div className="dashboard-heading">
          <div>
            <span className="section-index">PROTECTED / MIDDLEWARE VERIFIED</span>
            <h1>Welcome back, {session.user.name}.</h1>
            <p>Farm route middleware verified your session before this dashboard loaded.</p>
          </div>
          <SignOutButton />
        </div>

        <section className="dashboard-grid" aria-label="Account overview">
          <article className="account-panel">
            <div className="panel-heading">
              <span>Account</span>
              <span className="status-badge">
                <span className="status-dot" aria-hidden="true" />
                Active
              </span>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Name</dt>
                <dd>{session.user.name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{session.user.email}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{createdAt}</dd>
              </div>
            </dl>
          </article>

          <article className="session-panel">
            <div className="panel-heading">
              <span>Current session</span>
              <code>httpOnly cookie</code>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Session ID</dt>
                <dd className="mono truncate">{session.session.id}</dd>
              </div>
              <div>
                <dt>Expires</dt>
                <dd>{expiresAt}</dd>
              </div>
              <div>
                <dt>Storage</dt>
                <dd>Neon Postgres</dd>
              </div>
            </dl>
          </article>
        </section>

        <section className="next-steps" aria-labelledby="next-steps-title">
          <div className="section-heading compact">
            <span className="section-index">NEXT / MAKE IT YOURS</span>
            <h2 id="next-steps-title">The account boundary is ready for product work.</h2>
          </div>
          <div className="next-step-list">
            <div>
              <span>01</span>
              <p>Set the production auth URL, secret, and pooled database URL in your host.</p>
            </div>
            <div>
              <span>02</span>
              <p>
                Add GitHub or Google inside <code>src/lib/auth.ts</code> when you need OAuth.
              </p>
            </div>
            <div>
              <span>03</span>
              <p>Build your first protected feature beside this dashboard route.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
