export default function Page() {
  return (
    <main className="shell">
      <div className="page-grid">
        <header className="hero">
          <p className="eyebrow">@farm.js/hints</p>
          <h1>See the problems hiding in the page.</h1>
          <p className="intro">
            Hints watches the route you are building and turns browser signals into concrete fixes,
            without changing the production application.
          </p>
        </header>

        <section className="demo-card" aria-labelledby="demo-heading">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Intentional test case</p>
              <h2 id="demo-heading">Three things to inspect</h2>
            </div>
            <button className="icon-button" type="button">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>

          <div className="preview-row">
            <img src="/field.svg" alt="Rows in a field at sunset" />
            <div>
              <strong id="field-status">Field monitor</strong>
              <span id="field-status">Updated just now</span>
            </div>
          </div>

          <button className="nested-control" type="button">
            View report <a href="#details">Open details</a>
          </button>
        </section>

        <aside className="note" id="details">
          <span>How to use this demo</span>
          <p>
            Open Farm Hints in the bottom corner, expand a finding, then select its row to reveal
            the matching element on this page.
          </p>
        </aside>
      </div>
    </main>
  );
}
