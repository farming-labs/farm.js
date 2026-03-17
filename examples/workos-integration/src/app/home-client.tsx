"use client";

export function HomeClient() {
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
              <span>Protected by the WorkOS integration middleware.</span>
            </a>
          </div>
        </section>

        <section className="card">
          <h2>Integration Routes</h2>
          <div className="session-stack">
            <div className="session-line">
              <strong>/login</strong>
              <span>Creates a WorkOS authorization URL with a return target.</span>
            </div>
            <div className="session-line">
              <strong>/signup</strong>
              <span>Starts the same flow with the sign-up screen hint.</span>
            </div>
            <div className="session-line">
              <strong>/callback</strong>
              <span>Exchanges the code for a sealed session cookie.</span>
            </div>
            <div className="session-line">
              <strong>/auth/session</strong>
              <span>Returns the authenticated user payload for the dashboard UI.</span>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
