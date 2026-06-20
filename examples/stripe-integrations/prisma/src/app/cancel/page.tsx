export default function CancelPage() {
  return (
    <main className="page-shell">
      <section className="card form-card">
        <span className="eyebrow">Checkout Cancelled</span>
        <h1>No charge was completed</h1>
        <p>
          The Stripe mock redirected back to the cancel page. You can return home and
          start another checkout session at any time.
        </p>
        <div className="action-row">
          <a className="primary-link" href="/">
            Return Home
          </a>
          <a className="secondary-link" href="/success?portal=1">
            Preview Success Layout
          </a>
        </div>
      </section>
    </main>
  );
}
