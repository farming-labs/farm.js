import { BlogFigure } from "../blog/figures";
import { useArtworkMotion } from "../use-artwork-motion";

// A curved, woven lattice, identical in SSR and the browser.
// Motion is CSS-only and shares the blog's offscreen/background pause lifecycle.
// Cover the 1320px page rail without stretching the monospace glyphs.
const field = Array.from({ length: 54 }, (_, row) =>
  Array.from({ length: 240 }, (_, column) => {
    const x = (column - 120) / 60;
    const y = (row - 27) / 22;
    const curve = 0.38 * Math.cos(x * 1.7);
    const warp = x * 2.8 + y * 5 + curve;
    const weft = x * 2.8 - y * 5 - curve;
    const threads = Math.max(Math.abs(Math.sin(warp)), Math.abs(Math.sin(weft)));
    const light = 0.65 + 0.35 * Math.cos(x * 1.4 - y);
    const density = Math.pow(threads, 18) * light;
    return " .:+=*"[Math.round(density * 5)];
  }).join(""),
);

export function AgentArtwork() {
  const [ref, motion] = useArtworkMotion<HTMLDivElement>();
  return (
    <div ref={ref} className="agent-artwork" data-motion={motion} aria-hidden="true">
      <div className="agent-art-caption">
        <span>Farm.js / Agents</span>
        <span>[ Concept ]</span>
      </div>
      <pre className="agent-ascii-field">
        {field.map((row, index) => (
          <span
            className="agent-ascii-row"
            key={index}
            style={{ animationDelay: `${index * -120}ms` }}
          >
            {row}
          </span>
        ))}
      </pre>
      <div className="agent-flow agent-flow--wide">
        <BlogFigure fit kind="agents-flow" />
      </div>
      <div className="agent-flow agent-flow--stacked">
        <BlogFigure fit kind="agents-flow-stacked" />
      </div>
      <div className="agent-art-caption agent-art-caption--bottom">
        <span>Deploy · Connect · Observe</span>
        <span>+ + +</span>
      </div>
    </div>
  );
}
