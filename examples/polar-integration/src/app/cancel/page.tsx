export default function CancelPage() {
  return (
    <main className="page-shell">
      <section className="card form-card">
        <span className="eyebrow">Checkout Cancelled</span>
        <h1>No charge was completed</h1>
        <p>
          Polar redirected back to the cancel page. You can return home and start a
          different checkout session at any time.
        </p>
        <div className="action-row">
          <a className="primary-link" href="/dashboard">
            Return to Dashboard
          </a>
          <a className="secondary-link" href="/sign-in">
            Sign In Again
          </a>
        </div>
      </section>
    </main>
  );
}
