export default function Loading() {
  return (
    <main className="loading-shell" aria-label="Loading page" aria-live="polite">
      <div className="loading-block">
        <span className="loading-label">Loading account</span>
        <div className="loading-line wide" />
        <div className="loading-line" />
        <div className="loading-grid">
          <div />
          <div />
        </div>
      </div>
    </main>
  );
}
