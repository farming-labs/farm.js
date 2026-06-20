"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../lib/api";

type ProfileState =
  | { status: "loading" }
  | { status: "unauthorized" }
  | { status: "error"; message: string }
  | { status: "ready"; user: { email?: string; name?: string; sub?: string; picture?: string } };

export function HomeClient() {
  const [profile, setProfile] = useState<ProfileState>({ status: "loading" });
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      const result = await apiClient.auth.profile.get();

      if (cancelled) {
        return;
      }

      if (result.error) {
        if ("status" in result.error && result.error.status === 401) {
          setProfile({ status: "unauthorized" });
          return;
        }

        setProfile({ status: "error", message: result.error.message });
        return;
      }

      if (!result.data?.authenticated) {
        setProfile({ status: "unauthorized" });
        return;
      }

      setProfile({
        status: "ready",
        user: result.data.user || {},
      });
    }

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    const result = await apiClient.auth.logout.get();

    if (result.data?.redirectTo) {
      window.location.assign(result.data.redirectTo);
      return;
    }

    setLoggingOut(false);
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <span className="eyebrow">Real Auth0 Routes</span>
        <h1>Auth0 Integration</h1>
        <p>
          Start with built-in Auth0 routes from the integration layer, land on a protected
          dashboard, and use the typed Farm client to inspect or end the current session.
        </p>
      </section>

      <section className="playground-grid">
        <section className="card">
          <h2>Get Started</h2>
          <div className="link-grid">
            <a className="nav-card" href="/auth/login?returnTo=/dashboard">
              <strong>Login</strong>
              <span>Start the hosted Auth0 sign-in flow and continue to the dashboard.</span>
            </a>
            <a className="nav-card" href="/auth/signup?returnTo=/dashboard">
              <strong>Sign Up</strong>
              <span>Open the hosted Auth0 sign-up flow with the same callback wiring.</span>
            </a>
            <a className="nav-card" href="/dashboard">
              <strong>Dashboard</strong>
              <span>Rendered on the server through the typed integration API.</span>
            </a>
          </div>
        </section>

        <section className="card">
          <h2>Typed Client Probe</h2>
          {profile.status === "loading" ? <p>Checking the current Auth0 session…</p> : null}
          {profile.status === "unauthorized" ? (
            <p>No active Auth0 session was found. Use the login or sign-up links to start one.</p>
          ) : null}
          {profile.status === "error" ? <p>{profile.message}</p> : null}
          {profile.status === "ready" ? (
            <>
              <div className="session-stack">
                <div className="session-line">
                  <strong>Email</strong>
                  <span>{profile.user.email || "Unavailable"}</span>
                </div>
                <div className="session-line">
                  <strong>User ID</strong>
                  <span>{profile.user.sub || "Unavailable"}</span>
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
