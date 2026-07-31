"use client";

export default function Page() {
  return (
    <main className="page-shell">
      <section className="playground">
        <div className="hero">
          <span className="eyebrow">Farm Auth Flow</span>
          <h1>Sign in, open the dashboard, and log out.</h1>
          <p>
            Farm Auth provides the catch-all route, local database, server
            helpers, and client API. Email and password authentication works
            without a separate auth instance or client setup.
          </p>
        </div>

        <div className="playground-grid">
          <section className="card">
            <h2>Get Started</h2>
            <div className="link-grid">
              <a className="nav-card" href="/sign-in">
                <strong>Sign In</strong>
                <span>Use the Farm Auth client to create a session.</span>
              </a>
              <a className="nav-card" href="/sign-up">
                <strong>Sign Up</strong>
                <span>Create a demo user and continue to the dashboard.</span>
              </a>
              <a className="nav-card" href="/dashboard">
                <strong>Dashboard</strong>
                <span>Open the protected dashboard backed by session state.</span>
              </a>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
