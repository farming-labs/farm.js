import { api } from "../../lib/api";

export default async function ServerDemoPage() {
  const result = await api.localDemo.message.get();
  const {data, error} = await api.localDemo.message.post({
    body: {
      message: "hello from the server",
    }
  })
  return (
    <main className="page-shell">
      <section className="hero">
        <span className="eyebrow">Server Example</span>
        <h1>SSR Integration Call</h1>
        <p>
          This page is rendered on the server and resolves the local integration through the same
          typed integration client before HTML is streamed to the browser. On the server this stays
          in-process instead of making an HTTP round trip back into the same app.
        </p>
      </section>

      <section className="playground-grid">
        <section className="card">
          <h2>Server Call</h2>
          <div className="session-stack">
            <div className="session-line">
              <strong>Code Path</strong>
              <span>
                <code>
                  api.localDemo.message.get()
                </code>
              </span>
            </div>
            <div className="session-line">
              <strong>Result Source</strong>
              <span>Resolved during SSR by calling the registered integration handler directly.</span>
            </div>
          </div>
          <div className="response-panel">
            <div className="response-meta">
              <span className="status-pill">SSR</span>
              <strong>
                {result.error
                  ? "Server-side integration call failed."
                  : "Server-side integration call resolved before render."}
              </strong>
            </div>
            <pre>{JSON.stringify(result.error || result.data, null, 2)}</pre>
          </div>
        </section>

        <section className="card">
          <h2>Comparison</h2>
          <div className="session-stack">
            <div className="session-line">
              <strong>Client Path</strong>
              <span>
                <code>apiClient.localDemo.message.get()</code> from the home page card.
              </span>
            </div>
            <div className="session-line">
              <strong>Server Path</strong>
              <span>
                <code>
                  api.localDemo.message.get()
                </code>
                {" "}
                from this page.
              </span>
            </div>
            <div className="session-line">
              <strong>Shared Types</strong>
              <span>Both return the same typed <code>{"{ data, error }"}</code> shape.</span>
            </div>
          </div>
          <div className="action-row">
            <a className="primary-link" href="/">
              Return Home
            </a>
          </div>
        </section>
      </section>
    </main>
  );
}
