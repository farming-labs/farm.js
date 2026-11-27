export default function Page() {
  return (
    <main>
      <h1>Farm agents</h1>
      <p>
        Try the checkout price for <a href="/api/examples/quote?quantity=1">one canvas bag</a> or{" "}
        <a href="/api/examples/quote?quantity=3">three bags</a>. Run <code>pnpm smoke</code> in this
        example to follow the quote through a demo payment and refund approval.
      </p>
      <p>
        Run <code>pnpm dev:polyroute</code> to try the Rust packing route at{" "}
        <code>/api/examples/packing?quantity=5</code>. Five bags need two boxes.
      </p>
      <p>
        The refund agent runs at <code>/api/agent/agents/refund/runs</code>. Its manifest is at{" "}
        <a href="/api/agent/manifest.json">/api/agent/manifest.json</a>.
      </p>
    </main>
  );
}
