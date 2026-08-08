"use client";

import { useAuth } from "@farm.js/auth/client";
import { useEffect } from "react";
import { SignOutButton } from "../../components/sign-out-button";
import { SiteHeader } from "../../components/site-header";

export default function DashboardPage() {
  const { isPending, session, user } = useAuth();

  useEffect(() => {
    if (!isPending && !user) {
      window.location.replace("/sign-in");
    }
  }, [isPending, user]);

  if (isPending) {
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

  if (!user || !session) {
    return (
      <main className="loading-shell" aria-label="Returning to sign in" aria-live="polite">
        <div className="loading-block">
          <span className="loading-label">Session unavailable</span>
          <p className="loading-message">Returning you to the sign-in page…</p>
        </div>
      </main>
    );
  }

  const createdAt = new Date(user.createdAt).toLocaleDateString("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const expiresAt = new Date(session.expiresAt).toLocaleString("en", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });

  return (
    <div className="site-frame">
      <SiteHeader user={user} />

      <main className="dashboard-shell">
        <div className="dashboard-heading">
          <div>
            <span className="section-index">PROTECTED / MIDDLEWARE VERIFIED</span>
            <h1>Welcome back, {user.name}.</h1>
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
                <dd>{user.name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{user.email}</dd>
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
                <dd className="mono truncate">{session.id}</dd>
              </div>
              <div>
                <dt>Expires</dt>
                <dd>{expiresAt}</dd>
              </div>
              <div>
                <dt>Storage</dt>
                <dd>SQLite locally / Postgres in production</dd>
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
              <p>Set the production FARMJS Auth URL, secret, and database URL in your host.</p>
            </div>
            <div>
              <span>02</span>
              <p>Run the FARMJS Auth migration command before serving production traffic.</p>
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
