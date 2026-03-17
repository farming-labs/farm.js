"use client";

import { useEffect, useState } from "react";
import { auth, signOut } from "../../../auth";

type SessionState =
  | { status: "loading" }
  | { status: "unauthorized" }
  | { status: "ready"; user: { email: string; name: string } };

export default function DashboardPage() {
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    auth().then((response) => {
      if (cancelled) return;

      if (response.status >= 400) {
        setSession({ status: "unauthorized" });
        return;
      }

      const data = JSON.parse(response.body);
      setSession({
        status: "ready",
        user: data.user,
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
