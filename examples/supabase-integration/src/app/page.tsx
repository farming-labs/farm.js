export default function Page() {
  return (
    <main className="page-shell">
      <section className="hero">
        <span className="eyebrow">Supabase SSR Auth</span>
        <h1>Supabase Integration</h1>
        <p>
          Use integration-owned sign-in and sign-up routes, return through the Supabase callback
          when OAuth is configured, and open a protected dashboard backed by the server session.
          You can keep the built-in screens or point the integration at your own `/sign-in` and
          `/sign-up` pages.
        </p>
      </section>

      <section className="playground-grid">
        <section className="card">
          <h2>Get Started</h2>
          <div className="link-grid">
            <a className="nav-card" href="/sign-in?returnTo=/dashboard">
              <strong>Sign In</strong>
              <span>Open the custom sign-in page backed by `api.supabase.login()`.</span>
            </a>
            <a className="nav-card" href="/sign-up?returnTo=/dashboard">
              <strong>Sign Up</strong>
              <span>Create an account through the custom page and integration client.</span>
            </a>
            <a className="nav-card" href="/dashboard">
              <strong>Dashboard</strong>
              <span>Protected by the Supabase session middleware.</span>
            </a>
          </div>
        </section>

        <section className="card">
          <h2>Integration Routes</h2>
          <div className="session-stack">
            <div className="session-line">
              <strong>/auth/login</strong>
              <span>Server auth action used by `api.supabase.login()`.</span>
            </div>
            <div className="session-line">
              <strong>/auth/signup</strong>
              <span>Server auth action used by `api.supabase.signup()`.</span>
            </div>
            <div className="session-line">
              <strong>/auth/callback</strong>
              <span>Exchanges the Supabase PKCE code for a server session.</span>
            </div>
            <div className="session-line">
              <strong>/auth/logout</strong>
              <span>Signs the user out and clears the Supabase session cookies.</span>
            </div>
            <div className="session-line">
              <strong>/auth/session</strong>
              <span>Read through `api.supabase.session()` on the client.</span>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
