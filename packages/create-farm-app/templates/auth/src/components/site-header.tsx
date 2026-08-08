interface HeaderUser {
  email: string;
  name: string;
}

interface SiteHeaderProps {
  user: HeaderUser | null;
}

export function SiteHeader({ user }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label="FARMJS Auth Starter home">
        <span className="brand-mark" aria-hidden="true">
          F
        </span>
        <span>
          <strong>FARMJS</strong>
          <small>Auth Starter</small>
        </span>
      </a>

      <nav className="header-nav" aria-label="Primary navigation">
        <a href="https://farm.js.dev">Docs</a>
        {user ? (
          <a className="header-account" href="/dashboard">
            <span className="avatar" aria-hidden="true">
              {(user.name || user.email).slice(0, 1).toUpperCase()}
            </span>
            <span className="account-copy">
              <small>Signed in</small>
              <strong>{user.name || user.email}</strong>
            </span>
          </a>
        ) : (
          <>
            <a href="/sign-in">Sign in</a>
            <a className="button button-small button-primary" href="/sign-up">
              Get started
            </a>
          </>
        )}
      </nav>
    </header>
  );
}
