"use client";

import { useEffect, useState } from "preact/hooks";
import { authClient } from "../../lib/auth-client";

type SessionData = NonNullable<Awaited<ReturnType<typeof authClient.getSession>>["data"]>;

export default function DashboardPage() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    authClient
      .getSession()
      .then((response) => {
        if (!active) return;
        if (response.error || !response.data?.user) {
          window.location.replace("/sign-in");
          return;
        }
        setSession(response.data);
        setPending(false);
      })
      .catch(() => window.location.replace("/sign-in"));
    return () => {
      active = false;
    };
  }, []);

  async function signOut() {
    setPending(true);
    setError(null);
    const response = await authClient.signOut();
    if (response.error) {
      setError(response.error.message ?? "Could not sign out.");
      setPending(false);
      return;
    }
    window.location.assign("/");
  }

  if (!session) {
    return (
      <main className="loading-shell" aria-live="polite">
        <div className="loading-block">
          <span className="loading-label">Verifying protected session</span>
          <div className="loading-line wide" />
          <div className="loading-line" />
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <div className="dashboard-heading">
        <div>
          <span className="section-index">PROTECTED / MIDDLEWARE VERIFIED</span>
          <h1>Welcome back, {session.user.name}.</h1>
          <p>{session.user.email}</p>
        </div>
        <div className="sign-out-control">
          <button className="button button-secondary" disabled={pending} onClick={signOut}>
            {pending ? "Signing out…" : "Sign out"}
          </button>
          {error ? <span className="inline-error">{error}</span> : null}
        </div>
      </div>
    </main>
  );
}
