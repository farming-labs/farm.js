// A deterministic character field keeps the illustration crisp in SSR and costs
// no canvas, JavaScript animation loop, image request, or client-side dependency.
const field = Array.from({ length: 56 }, (_, row) =>
  Array.from({ length: 112 }, (_, column) => {
    const x = column / 14;
    const y = row / 9;
    // Layered contours: a woven landscape instead of the previous circular field.
    const contour = Math.sin(y * 3.8 + Math.sin(x * 0.9) * 2.4 + x * 0.65);
    const crosswind = Math.cos(x * 1.4 - y * 0.8) * 0.18;
    const density = Math.max(0, Math.min(1, (contour + 1) * 0.4 + crosswind));
    return " .:-=+*#"[Math.min(7, Math.floor(density * 8))];
  }).join(""),
);

function RollingDigit({ value, order }: { value: number; order: number }) {
  return (
    <span className="blog-art-digit" style={{ animationDelay: `${order * 100}ms` }}>
      <span className="blog-art-value">{value}</span>
      <span className="blog-art-reel">
        {Array.from({ length: 10 }, (_, index) => (
          <span key={index}>{(value + index) % 10}</span>
        ))}
      </span>
    </span>
  );
}

export function ReleaseArtwork({ fullBleed = false }: { fullBleed?: boolean }) {
  return (
    <div
      className={`blog-release-art${fullBleed ? " blog-release-art--full-bleed" : ""}`}
      aria-hidden="true"
    >
      {!fullBleed && (
        <>
          <div className="blog-art-corner blog-art-corner--tl" />
          <div className="blog-art-corner blog-art-corner--tr" />
          <div className="blog-art-corner blog-art-corner--bl" />
          <div className="blog-art-corner blog-art-corner--br" />
        </>
      )}
      <div className="blog-art-label">
        <span>FARM.JS</span>
        <span>RELEASE / 001</span>
      </div>
      <pre className="blog-ascii-field">
        <span className="blog-ascii-rows">
          {field.map((row, index) => (
            <span
              className="blog-ascii-row"
              key={index}
              style={{ animationDelay: `${index * -110}ms` }}
            >
              {row}
            </span>
          ))}
        </span>
      </pre>
      <div className="blog-art-version" data-version="v 0.1.0">
        <span className="blog-art-prefix">v </span>
        <span className="blog-art-number">
          <RollingDigit value={0} order={0} />
          <span className="blog-art-dot">.</span>
          <RollingDigit value={1} order={1} />
          <span className="blog-art-dot">.</span>
          <RollingDigit value={0} order={2} />
          <span className="blog-art-caret">
            <span className="blog-art-cursor">_</span>
          </span>
        </span>
      </div>
      <div className="blog-art-caption">
        <span>BUILT TO BUILD ON.</span>
        <span>[ STABLE ]</span>
      </div>
    </div>
  );
}
