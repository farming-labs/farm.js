import { api } from "../../lib/api";

export default async function DashboardPage() {
  const result = await api.auth.session.get();
  const session = result.data?.authenticated ? result.data : null;
  const fullName = session
    ? [session.user?.firstName, session.user?.lastName].filter(Boolean).join(" ")
    : "";

  return (
    <main className="page-shell">
      <section className="card form-card">
        <h1>Dashboard</h1>
        {!session ? (
          <>
            <p>You need to sign in before accessing the dashboard.</p>
            <a className="primary-link" href="/login?returnTo=/dashboard">
              Sign In with WorkOS
            </a>
          </>
        ) : (
          <>
            <p>
              Signed in as{" "}
              <strong>{fullName || session.user?.email}</strong>
            </p>
            <div className="session-stack">
              <div className="session-line">
                <strong>Email</strong>
                <span>{session.user?.email}</span>
              </div>
              <div className="session-line">
                <strong>User ID</strong>
                <span>{session.user?.id}</span>
              </div>
              <div className="session-line">
                <strong>Session ID</strong>
                <span>{session.sessionId}</span>
              </div>
              <div className="session-line">
                <strong>Organization</strong>
                <span>{session.organizationId || "Personal account"}</span>
              </div>
            </div>
            <div className="action-row">
              <form action="/logout" className="logout-form" method="post">
                <button className="ghost-button" type="submit">
                  Logout
                </button>
              </form>
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
