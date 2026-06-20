import { api } from "../../lib/api";

export default async function DashboardPage() {
  const result = await api.auth.profile.get();
  const profile = result.data?.authenticated ? result.data.user : undefined;
  return (
    <main className="page-shell">
      <section className="card form-card">
        <h1>Dashboard</h1>
        {!profile ? (
          <>
            <p>You need to log in before accessing the dashboard.</p>
            <a className="primary-link" href="/auth/login?returnTo=/dashboard">
              Login with Auth0
            </a>
          </>
        ) : (
          <>
            <p>
              Logged in as <strong>{String(profile.name || profile.email || profile.sub)}</strong>
            </p>
            <div className="session-stack">
              <div className="session-line">
                <strong>Email</strong>
                <span>{String(profile.email || "Unavailable")}</span>
              </div>
              <div className="session-line">
                <strong>User ID</strong>
                <span>{String(profile.sub || "Unavailable")}</span>
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
        )}
      </section>
    </main>
  );
}
