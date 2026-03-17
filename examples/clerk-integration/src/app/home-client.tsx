"use client";

import { UserButton, useAuth, useClerk, useUser } from "@clerk/react";

export function HomeClient() {
  const { isLoaded, userId } = useAuth();
  const clerk = useClerk();
  const { user } = useUser();

  return (
    <main className="page-shell">
      <section className="hero">
        <span className="eyebrow">Real Clerk SDK</span>
        <h1>Clerk Integration</h1>
        <p>
          Sign in with Clerk, open the protected dashboard, and sign out with
          the real Clerk React components plus backend request authentication.
        </p>
        <p>
          For local testing, use an email ending with <code>+clerk_test</code>.
          When Clerk asks for an email verification code in development, use{" "}
          <code>424242</code>.
        </p>
      </section>

      <section className="playground-grid">
        <section className="card">
          <h2>Get Started</h2>
          {!isLoaded ? <p>Loading Clerk…</p> : null}

          {isLoaded && !userId ? (
            <div className="link-grid">
              <a className="nav-card" href="/sign-in">
                <strong>Sign In</strong>
                <span>Open the real Clerk sign-in flow.</span>
              </a>
              <a className="nav-card" href="/sign-up">
                <strong>Sign Up</strong>
                <span>Create a user through Clerk’s React component.</span>
              </a>
              <a className="nav-card" href="/dashboard">
                <strong>Dashboard</strong>
                <span>Protected by Clerk-backed middleware.</span>
              </a>
            </div>
          ) : null}

          {isLoaded && userId ? (
            <div className="response-panel">
              <div className="response-meta">
                <UserButton />
                <strong>{user?.primaryEmailAddress?.emailAddress ?? "Signed in"}</strong>
              </div>
              <div className="action-row">
                <a className="primary-link" href="/dashboard">
                  Open Dashboard
                </a>
                <button
                  className="secondary-button"
                  onClick={() => void clerk.signOut({ redirectUrl: "/" })}
                  type="button"
                >
                  Sign Out
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
