"use client";

import { useEffect, useState } from "react";

type SessionState =
  | { status: "loading" }
  | { status: "unauthorized" }
  | {
      status: "ready";
      data: {
        sessionId: string;
        organizationId?: string;
        user: {
          id: string;
          email: string;
          firstName?: string;
          lastName?: string;
          profilePictureUrl?: string;
        };
      };
    };

export default function DashboardPage() {
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch("/auth/session", {
      credentials: "include",
    })
      .then(async (response) => {
        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setSession({ status: "unauthorized" });
          return;
        }

        const data = await response.json();
        setSession({
          status: "ready",
          data,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setSession({ status: "unauthorized" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const fullName =
    session.status === "ready"
      ? [session.data.user.firstName, session.data.user.lastName].filter(Boolean).join(" ")
      : "";

  return (
    <main className="page-shell">
      <section className="card form-card">
        <h1>Dashboard</h1>
        {session.status === "loading" ? <p>Loading WorkOS session...</p> : null}
        {session.status === "unauthorized" ? (
          <>
            <p>You need to sign in before accessing the dashboard.</p>
            <a className="primary-link" href="/login?returnTo=/dashboard">
              Sign In with WorkOS
            </a>
          </>
        ) : null}
        {session.status === "ready" ? (
          <>
            <p>
              Signed in as{" "}
              <strong>{fullName || session.data.user.email}</strong>
            </p>
            <div className="session-stack">
              <div className="session-line">
                <strong>Email</strong>
                <span>{session.data.user.email}</span>
              </div>
              <div className="session-line">
                <strong>User ID</strong>
                <span>{session.data.user.id}</span>
              </div>
              <div className="session-line">
                <strong>Session ID</strong>
                <span>{session.data.sessionId}</span>
              </div>
              <div className="session-line">
                <strong>Organization</strong>
                <span>{session.data.organizationId || "Personal account"}</span>
              </div>
            </div>
            <div className="action-row">
              <form action="/logout" className="logout-form" method="post">
                <button className="ghost-button" type="submit">
                  Logout
                </button>
              </form>
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
