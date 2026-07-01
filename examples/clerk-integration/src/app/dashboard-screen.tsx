"use client";

import { UserButton, useAuth, useClerk, useUser } from "@clerk/react";

export function DashboardScreen() {
  const { isLoaded, userId } = useAuth();
  const clerk = useClerk();
  const { user } = useUser();

  return (
    <main className="page-shell">
      <section className="card form-card">
        <h1>Dashboard</h1>
        {!isLoaded ? <p>Loading Clerk session…</p> : null}
        {isLoaded && !userId ? (
          <>
            <p>You need to sign in before accessing the dashboard.</p>
            <a className="primary-link" href="/sign-in">
              Go to Sign In
            </a>
          </>
        ) : null}
        {isLoaded && userId ? (
          <>
            <div className="response-meta">
              <UserButton />
              <strong>{user?.fullName ?? user?.firstName ?? "Clerk User"}</strong>
            </div>
            <p>
              Signed in as{" "}
              <strong>{user?.primaryEmailAddress?.emailAddress ?? "unknown@example.com"}</strong>
            </p>
            <div className="action-row">
              <button
                className="primary-button"
                onClick={() => void clerk.signOut({ redirectUrl: "/" })}
                type="button"
              >
                Logout
              </button>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
