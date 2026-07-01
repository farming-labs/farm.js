"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../lib/api";

type SessionState =
  | { status: "loading" }
  | { status: "unauthorized" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      data: {
        sessionId?: string;
        organizationId?: string;
        user?: {
          id: string;
          email: string;
          firstName?: string | null;
          lastName?: string | null;
        };
      };
    };

export function HomeClient() {
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      const result = await apiClient.auth.session.get();

      if (cancelled) {
        return;
      }

      if (result.error) {
        if ("status" in result.error && result.error.status === 401) {
          setSession({ status: "unauthorized" });
          return;
        }

        setSession({ status: "error", message: result.error.message });
        return;
      }

      if (!result.data?.authenticated) {
        setSession({ status: "unauthorized" });
        return;
      }

      setSession({
        status: "ready",
        data: result.data,
      });
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    const result = await apiClient.auth.logout.post();

    if (result.data?.redirectTo) {
      window.location.assign(result.data.redirectTo);
      return;
    }

    setLoggingOut(false);
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <span className="eyebrow">Real WorkOS AuthKit</span>
        <h1>WorkOS Integration</h1>
        <p>
          Start the hosted WorkOS sign-in or sign-up flow, land on a protected dashboard,
          and log out through integration-owned routes.
        </p>
      </section>

      <section className="playground-grid">
        <section className="card">
          <h2>Get Started</h2>
          <div className="link-grid">
            <a className="nav-card" href="/login?returnTo=/dashboard">
              <strong>Sign In</strong>
              <span>Start the hosted WorkOS sign-in flow and continue to the dashboard.</span>
            </a>
            <a className="nav-card" href="/signup?returnTo=/dashboard">
              <strong>Sign Up</strong>
              <span>Create an account through WorkOS AuthKit and continue to the dashboard.</span>
            </a>
            <a className="nav-card" href="/dashboard">
              <strong>Dashboard</strong>
              <span>Rendered on the server through the typed integration API.</span>
            </a>
          </div>
        </section>

        <section className="card">
          <h2>Typed Client Probe</h2>
          {session.status === "loading" ? <p>Checking the current WorkOS session…</p> : null}
          {session.status === "unauthorized" ? (
            <p>No active WorkOS session was found. Use the sign-in or sign-up links to start one.</p>
          ) : null}
          {session.status === "error" ? <p>{session.message}</p> : null}
          {session.status === "ready" ? (
            <>
              <div className="session-stack">
                <div className="session-line">
                  <strong>Email</strong>
                  <span>{session.data.user?.email || "Unavailable"}</span>
                </div>
                <div className="session-line">
                  <strong>Session ID</strong>
                  <span>{session.data.sessionId || "Unavailable"}</span>
                </div>
                <div className="session-line">
                  <strong>Organization</strong>
                  <span>{session.data.organizationId || "Personal account"}</span>
                </div>
              </div>
              <div className="action-row">
                <a className="primary-link" href="/dashboard">
                  Open Dashboard
                </a>
                <button className="ghost-button" onClick={() => void handleLogout()} type="button">
                  {loggingOut ? "Logging out..." : "Logout with apiClient"}
                </button>
              </div>
            </>
          ) : null}
        </section>
      </section>
    </main>
  );
}
