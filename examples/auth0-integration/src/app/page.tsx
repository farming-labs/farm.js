"use client";

export default function Page() {
  return (
    <main className="page-shell">
      <section className="hero">
        <span className="eyebrow">Real Auth0 Routes</span>
        <h1>Auth0 Integration</h1>
        <p>
          Start with built-in Auth0 routes from the integration layer, land on a protected
          dashboard, and log out through Auth0 again.
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
              <span>Protected by the Auth0 integration middleware.</span>
            </a>
          </div>
        </section>

        <section className="card">
          <h2>Integration Routes</h2>
          <div className="session-stack">
            <div className="session-line">
              <strong>/auth/login</strong>
              <span>Creates the Auth0 authorize URL and stores a signed state cookie.</span>
            </div>
            <div className="session-line">
              <strong>/auth/signup</strong>
              <span>Starts the same flow with Auth0&apos;s sign-up screen hint.</span>
            </div>
            <div className="session-line">
              <strong>/auth/callback</strong>
              <span>Exchanges the code, signs the session cookie, and redirects back.</span>
            </div>
            <div className="session-line">
              <strong>/auth/profile</strong>
              <span>Returns the signed-in Auth0 user for the dashboard UI.</span>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
