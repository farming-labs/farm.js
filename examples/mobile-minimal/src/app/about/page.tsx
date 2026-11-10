// This page is deliberately not portable: the inline elevation sketch is a <svg>, which native
// views cannot express, so the analyzer keeps the route a web screen and the report says why.
// That is the whole fallback story — the other routes go native, this one stays a web page, and
// the app shows both without any extra code.
export default function AboutPage() {
  return (
    <main style={{ padding: 16 }}>
      <h1>About this example</h1>
      <p>
        Trail Guide is the smallest Farm app that is also a native app. Every screen is a plain
        <code> page.tsx</code>. The build-time analyzer decides which ones can render as native
        views; this page cannot, because of the chart below, so it opens as a web screen.
      </p>
      <svg viewBox="0 0 320 80" width="320" height="80" role="img" aria-label="Elevation sketch">
        <polyline
          points="0,70 40,62 80,66 120,40 160,46 200,18 240,30 280,12 320,22"
          fill="none"
          stroke="#2f6f4f"
          strokeWidth="2"
        />
      </svg>
      <p>
        Run <code>pnpm report</code> to see every route's tier and the reason, straight from the
        analyzer.
      </p>
    </main>
  );
}
