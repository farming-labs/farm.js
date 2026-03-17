"use client";

export default function Page() {
  return (
    <main className="page-shell">
      <section className="playground">
        <div className="hero">
          <span className="eyebrow">Auth.js Flow</span>
          <h1>Sign in, open the dashboard, and sign out.</h1>
          <p>
            This example mirrors the Auth.js <code>auth.ts</code> export
            pattern, then turns it into a simple login flow inside Farm.
          </p>
        </div>

        <div className="playground-grid">
          <section className="card">
            <h2>Get Started</h2>
            <div className="link-grid">
              <button className="nav-card" onClick={() => (window.location.href = "/sign-in")} type="button">
                <strong>Sign In</strong>
                <span>Use the exported Auth.js helper to create a session.</span>
              </button>
              <button className="nav-card" onClick={() => (window.location.href = "/dashboard")} type="button">
                <strong>Dashboard</strong>
                <span>Open the session-backed dashboard.</span>
              </button>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
