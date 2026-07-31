"use client";

import { useEffect, useState } from "react";
import { getSession, signOut } from "@farm.js/auth/client";

type SessionState =
  | { status: "loading" }
  | { status: "unauthorized" }
  | { status: "ready"; user: { email: string; name: string } };

export default function DashboardPage() {
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    getSession().then((response) => {
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
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await signOut();
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
            <div className="action-row">
              <button className="primary-button" onClick={logout} type="button">
                Logout
              </button>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
