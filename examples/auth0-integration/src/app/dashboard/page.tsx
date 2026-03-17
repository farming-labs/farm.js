"use client";

import { useEffect, useState } from "react";

type ProfileState =
  | { status: "loading" }
  | { status: "unauthorized" }
  | { status: "ready"; user: { email?: string; name?: string; sub?: string; picture?: string } };

export default function DashboardPage() {
  const [profile, setProfile] = useState<ProfileState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch("/auth/profile", {
      credentials: "include",
    })
      .then(async (response) => {
        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setProfile({ status: "unauthorized" });
          return;
        }

        const data = await response.json();
        setProfile({
          status: "ready",
          user: data.user,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setProfile({ status: "unauthorized" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="page-shell">
      <section className="card form-card">
        <h1>Dashboard</h1>
        {profile.status === "loading" ? <p>Loading profile...</p> : null}
        {profile.status === "unauthorized" ? (
          <>
            <p>You need to log in before accessing the dashboard.</p>
            <a className="primary-link" href="/auth/login?returnTo=/dashboard">
              Login with Auth0
            </a>
          </>
        ) : null}
        {profile.status === "ready" ? (
          <>
            <p>
              Logged in as <strong>{profile.user.name || profile.user.email || profile.user.sub}</strong>
            </p>
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
              <a className="ghost-button" href="/auth/logout">
                Logout
              </a>
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
