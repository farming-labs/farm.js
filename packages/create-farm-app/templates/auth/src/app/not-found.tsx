interface NotFoundProps {
  pathname?: string;
}

export default function NotFound({ pathname }: NotFoundProps) {
  return (
    <main className="error-shell">
      <section className="error-panel">
        <span className="section-index">404 / NOT FOUND</span>
        <h1>This route is outside the starter.</h1>
        <p>
          {pathname ? (
            <>
              Nothing is registered at <code>{pathname}</code>.
            </>
          ) : (
            "The page you requested does not exist."
          )}
        </p>
        <a className="button button-primary" href="/">
          Return home
        </a>
      </section>
    </main>
  );
}
