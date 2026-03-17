"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type SessionState =
  | { status: "loading" }
  | { status: "unauthorized" }
  | {
      status: "ready";
      user: {
        id: string;
        email?: string;
      };
    };

export default function DashboardPage() {
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;

    api.supabase
      .session()
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.error || !result.data?.authenticated) {
          if (
            result.error &&
            "status" in result.error &&
            result.error.status !== 401
          ) {
            console.error(result.error);
          }
          setSession({ status: "unauthorized" });
          return;
        }

        setSession({
          status: "ready",
          user: {
            id: String(result.data.user?.id || ""),
            email:
              typeof result.data.user?.email === "string"
                ? result.data.user.email
                : undefined,
          },
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    setLoggingOut(true);

    const result = await api.supabase.logout({
      body: {
        returnTo: "/",
      },
    });
    if (result.error) {
      setLoggingOut(false);
      console.error(result.error);
      return;
    }

    if (result.data) {
      window.location.assign(result.data.redirectTo);
    }
  }

  return (
    <main className="page-shell">
      <section className="card form-card">
        <h1>Dashboard</h1>
        {session.status === "loading" ? <p>Loading Supabase session...</p> : null}
        {session.status === "unauthorized" ? (
          <>
            <p>You need to sign in before accessing the dashboard.</p>
            <a className="primary-link" href="/sign-in?returnTo=/dashboard">
              Sign In with Supabase
            </a>
          </>
        ) : null}
        {session.status === "ready" ? (
          <>
            <p>
              Signed in as <strong>{session.user.email || session.user.id}</strong>
            </p>
            <div className="session-stack">
              <div className="session-line">
                <strong>Email</strong>
                <span>{session.user.email || "Unavailable"}</span>
              </div>
              <div className="session-line">
                <strong>User ID</strong>
                <span>{session.user.id}</span>
              </div>
            </div>
            <div className="action-row">
              <button className="ghost-button" type="button" onClick={handleLogout} disabled={loggingOut}>
                {loggingOut ? <span className="button-spinner" aria-hidden="true" /> : null}
                <span>{loggingOut ? "Logging out..." : "Logout"}</span>
              </button>
              <a className="secondary-link" href="/">
                Return Home
              </a>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
