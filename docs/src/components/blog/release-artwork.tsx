import { useArtworkMotion } from "../use-artwork-motion";

type Density = (x: number, y: number) => number;

// A deterministic character field keeps the illustration crisp in SSR and costs
// no canvas, JavaScript animation loop, image request, or client-side dependency.
function field(density: Density) {
  return Array.from({ length: 56 }, (_, row) =>
    Array.from({ length: 112 }, (_, column) => {
      const value = Math.max(0, Math.min(1, density(column / 14, row / 9)));
      return " .:-=+*#"[Math.min(7, Math.floor(value * 8))];
    }).join(""),
  );
}

/** One release's reel: the numbered label, the version that rolls in, and its own landscape. */
export interface Release {
  /** Three digits, shown as `RELEASE / 001`. */
  number: string;
  version: readonly [number, number, number];
  tagline: string;
  status: string;
  rows: readonly string[];
}

export const RELEASES = {
  "0.1.0": {
    number: "001",
    version: [0, 1, 0],
    tagline: "BUILT TO BUILD ON.",
    status: "STABLE",
    // Layered contours: a woven landscape instead of the previous circular field.
    rows: field((x, y) => {
      const contour = Math.sin(y * 3.8 + Math.sin(x * 0.9) * 2.4 + x * 0.65);
      const crosswind = Math.cos(x * 1.4 - y * 0.8) * 0.18;
      return (contour + 1) * 0.4 + crosswind;
    }),
  },
  "0.2.0": {
    number: "002",
    version: [0, 2, 0],
    tagline: "FROM AN API ROUTE TO A NATIVE SCREEN.",
    status: "BETA",
    // Two wave trains crossing: a lattice, so the second release does not reuse the first's bands.
    rows: field((x, y) => {
      const rising = Math.sin(x * 1.9 + y * 2.6 + Math.sin(y * 0.7) * 1.2);
      const falling = Math.sin(x * 1.3 - y * 3.1 + Math.cos(x * 0.5) * 1.4);
      return (rising + falling + 2) * 0.22 + 0.06;
    }),
  },
} satisfies Record<string, Release>;

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

export function ReleaseArtwork({
  release,
  fullBleed = false,
}: {
  release: Release;
  fullBleed?: boolean;
}) {
  const [ref, motion] = useArtworkMotion<HTMLDivElement>();
  const [major, minor, patch] = release.version;
  return (
    <div
      ref={ref}
      className={`blog-release-art${fullBleed ? " blog-release-art--full-bleed" : ""}`}
      data-motion={motion}
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
        <span>{`RELEASE / ${release.number}`}</span>
      </div>
      <pre className="blog-ascii-field">
        <span className="blog-ascii-rows">
          {release.rows.map((row, index) => (
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
      <div className="blog-art-version" data-version={`v ${release.version.join(".")}`}>
        <span className="blog-art-prefix">v </span>
        <span className="blog-art-number">
          <RollingDigit value={major} order={0} />
          <span className="blog-art-dot">.</span>
          <RollingDigit value={minor} order={1} />
          <span className="blog-art-dot">.</span>
          <RollingDigit value={patch} order={2} />
          <span className="blog-art-caret">
            <span className="blog-art-cursor">_</span>
          </span>
        </span>
      </div>
      <div className="blog-art-caption">
        <span>{release.tagline}</span>
        <span>{`[ ${release.status} ]`}</span>
      </div>
    </div>
  );
}
