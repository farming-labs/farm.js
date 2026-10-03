import {
  Bot,
  FileText,
  MessageSquare,
  Monitor,
  RadioTower,
  Smartphone,
  Wrench,
} from "lucide-react";
import { siCloudflare, siStripe } from "simple-icons";
import type { CSSProperties, ReactNode } from "react";
import {
  FIGURES,
  STAGE,
  roundPath,
  type FigureGeometry,
  type FigureKind,
  type IconKey,
} from "./figure-scripts";

const pct = (value: number, total: number) => `${(value / total) * 100}%`;

const brand = (path: string) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d={path} />
  </svg>
);

const ICONS: Record<IconKey, ReactNode> = {
  stripe: brand(siStripe.path),
  cloudflare: brand(siCloudflare.path),
  eve: (
    <svg viewBox="0 20 102 62" fill="currentColor" aria-hidden="true">
      <path d="M49.28 66.94 75.03 34.96h-6.89L47.91 60.11l-5.49 6.83h6.86ZM0 34.96h42.4v5.11H0zm0 13.32h27.66v5.11H0zm0 13.54h27.66v5.11H0zm69.63-26.86H102v5.11H69.63zm4.71 13.32H102v5.11H74.34zm0 13.54H102v5.11H74.34z" />
    </svg>
  ),
  farm: <img src="/favicon.svg" alt="" />,
  agent: <Bot aria-hidden strokeWidth={1.5} />,
  phone: <Smartphone aria-hidden strokeWidth={1.5} />,
  browser: <Monitor aria-hidden strokeWidth={1.5} />,
  relay: <RadioTower aria-hidden strokeWidth={1.5} />,
  chat: <MessageSquare aria-hidden strokeWidth={1.5} />,
  tool: <Wrench aria-hidden strokeWidth={1.5} />,
  page: <FileText aria-hidden strokeWidth={1.5} />,
};

/**
 * An animated illustration for the launch post: panels and icon nodes joined by connectors,
 * replayed by `enhanceFigures`. The server renders the final frame so it reads without script.
 */
export function BlogFigure({
  kind,
  caption,
  fit = false,
}: {
  kind: FigureKind;
  caption?: string;
  /** Scale to the container instead of keeping a legible minimum width (landing cards). */
  fit?: boolean;
}) {
  const spec = FIGURES[kind];
  const wide: FigureGeometry = {
    stage: spec.stage ?? STAGE,
    panels: spec.panels,
    wires: spec.wires,
  };
  const last = spec.frame(spec.duration);
  // The stage for one layout; figures with a phone layout render both and CSS shows one.
  const renderStage = (geometry: FigureGeometry, variant?: "wide" | "narrow") => (
    <div
      className={`bf-stage${variant ? ` bf-stage--${variant}` : ""}`}
      role="img"
      aria-label={spec.label}
      style={
        {
          aspectRatio: `${geometry.stage.w} / ${geometry.stage.h}`,
          // Type is sized for a 760-unit stage; smaller stages scale it back up to the same look.
          "--bf-scale": STAGE.w / geometry.stage.w,
        } as CSSProperties
      }
    >
      {geometry.panels.map((panel) => (
        <div
          key={panel.id}
          className={`bf-panel${panel.flow ? " bf-flow" : panel.icon ? " bf-node" : ""}${panel.code ? " bf-panel--code" : ""}`}
          data-panel={panel.id}
          data-state={last.states?.[panel.id]}
          style={{
            left: pct(panel.x, geometry.stage.w),
            top: pct(panel.y, geometry.stage.h),
            width: pct(panel.w, geometry.stage.w),
            height: pct(panel.h, geometry.stage.h),
          }}
        >
          {panel.flow ? (
            <>
              <span className="bf-flow-icon">{panel.icon ? ICONS[panel.icon] : null}</span>
              <span className="bf-flow-text">
                <span className="bf-flow-kicker">{panel.kicker}</span>
                {panel.badges ? (
                  <span className="bf-flow-title bf-flow-badges" aria-label={panel.label}>
                    {panel.badges.map(([icon, name]) => (
                      <span className="bf-badge" key={name}>
                        {ICONS[icon]}
                        {name}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="bf-flow-title">{panel.label}</span>
                )}
              </span>
            </>
          ) : panel.icon ? (
            <>
              <span className="bf-icon">{ICONS[panel.icon]}</span>
              <span className="bf-label">{panel.label}</span>
              {panel.sub ? <span className="bf-sub">{panel.sub}</span> : null}
            </>
          ) : panel.code ? (
            <span className="bf-legend">{panel.title}</span>
          ) : (
            <div className="bf-head">
              <span>{panel.title}</span>
              <span
                data-slot={`${panel.id}:meta`}
                dangerouslySetInnerHTML={{ __html: last.slots[`${panel.id}:meta`] ?? "" }}
              />
            </div>
          )}
          <div
            className="bf-body"
            data-slot={panel.id}
            dangerouslySetInnerHTML={{ __html: last.slots[panel.id] ?? "" }}
          />
        </div>
      ))}
      <svg
        className="bf-wires"
        viewBox={`0 0 ${geometry.stage.w} ${geometry.stage.h}`}
        aria-hidden="true"
      >
        {Object.entries(geometry.wires).map(([id, points]) => {
          const [ax, ay] = points[0];
          const [bx, by] = points[points.length - 1];
          return (
            <g key={id} data-wire={id} data-dim={last.wires[id]?.dim ? "" : undefined}>
              <path className="bf-wire" d={roundPath(points)} />
              <circle className="bf-end" data-end="a" cx={ax} cy={ay} r="3.2" />
              <circle className="bf-end" data-end="b" cx={bx} cy={by} r="3.2" />
              <circle className="bf-glow" r="10" />
              <circle className="bf-pulse" r="4" />
            </g>
          );
        })}
      </svg>
    </div>
  );

  return (
    <figure className={`blog-figure${fit ? " blog-figure--fit" : ""}`} data-figure={kind}>
      {renderStage(wide, spec.narrow && !fit ? "wide" : undefined)}
      {spec.narrow && !fit ? renderStage(spec.narrow, "narrow") : null}
      {spec.source ? (
        <pre className="sr-only" data-figure-source="">
          {spec.source}
        </pre>
      ) : null}
      {/* Landing cards loop on their own; only the post offers pause, copy, and replay. */}
      {fit ? null : (
        <div className="bf-controls">
          <button type="button" className="bf-toggle" aria-label="Pause illustration">
            <svg viewBox="0 0 24 24">
              <path className="bf-icon-pause" d="M8 5h3v14H8zM13 5h3v14h-3z" />
              <path className="bf-icon-play" d="M8 5.5v13l11-6.5z" />
            </svg>
          </button>
          {spec.source ? (
            <button
              type="button"
              className="bf-copy"
              aria-label={spec.excerpt ? "Copy the full file" : "Copy code"}
            >
              <span>{spec.excerpt ? "Copy full file" : "Copy code"}</span>
            </button>
          ) : null}
          <button type="button" className="bf-replay" aria-label="Replay illustration">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
          </button>
        </div>
      )}
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
