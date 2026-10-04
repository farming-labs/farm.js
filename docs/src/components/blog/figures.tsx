"use client";

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
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  FIGURES,
  STAGE,
  roundPath,
  type FigureFrame,
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

// Loop: hold on the finished frame for a beat, then play again from the start.
const HOLD = 1.6;
// Points sampled along each connector, so the travelling pulse renders without DOM geometry calls.
const SAMPLES = 120;

type Status = "idle" | "playing" | "paused";
type WireMeasure = { length: number; points: [number, number][] };

function pointAt({ points }: WireMeasure, at: number): [number, number] {
  const position = Math.min(1, Math.max(0, at)) * (points.length - 1);
  const index = Math.floor(position);
  const next = points[Math.min(points.length - 1, index + 1)];
  const step = position - index;
  return [
    points[index][0] + (next[0] - points[index][0]) * step,
    points[index][1] + (next[1] - points[index][1]) * step,
  ];
}

/** One layout of a figure. Before it is live it renders exactly the server's final frame. */
function FigureStage({
  geometry,
  variant,
  frame,
  label,
  live,
}: {
  geometry: FigureGeometry;
  variant?: "wide" | "narrow";
  frame: FigureFrame;
  label: string;
  live: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const paths = useRef(new Map<string, SVGPathElement>());
  const [measures, setMeasures] = useState<Map<string, WireMeasure>>();
  // Screen pixels per stage unit: a non-scaling stroke dashes in screen pixels.
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const element = svg.current;
    if (!live || !element) return;
    const next = new Map<string, WireMeasure>();
    for (const [id, path] of paths.current) {
      const length = path.getTotalLength();
      const points = Array.from({ length: SAMPLES + 1 }, (_, index) => {
        const point = path.getPointAtLength((length * index) / SAMPLES);
        return [point.x, point.y] as [number, number];
      });
      next.set(id, { length, points });
    }
    setMeasures(next);
    const measureScale = () => setScale(element.getScreenCTM()?.a || 1);
    measureScale();
    const observer = new ResizeObserver(measureScale);
    observer.observe(element);
    return () => observer.disconnect();
  }, [live, geometry]);

  const painting = live && measures !== undefined;
  return (
    <div
      className={`bf-stage${variant ? ` bf-stage--${variant}` : ""}`}
      role="img"
      aria-label={label}
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
          data-state={frame.states?.[panel.id]}
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
                dangerouslySetInnerHTML={{ __html: frame.slots[`${panel.id}:meta`] ?? "" }}
              />
            </div>
          )}
          <div
            className="bf-body"
            data-slot={panel.id}
            dangerouslySetInnerHTML={{ __html: frame.slots[panel.id] ?? "" }}
          />
        </div>
      ))}
      <svg
        ref={svg}
        className="bf-wires"
        viewBox={`0 0 ${geometry.stage.w} ${geometry.stage.h}`}
        aria-hidden="true"
      >
        {Object.entries(geometry.wires).map(([id, points]) => {
          const [ax, ay] = points[0];
          const [bx, by] = points[points.length - 1];
          const state = frame.wires[id];
          const measure = painting ? measures.get(id) : undefined;
          const draw = state?.draw ?? 0;
          const dash = measure ? measure.length * scale : 0;
          const pulse =
            measure && state?.pulse !== undefined ? pointAt(measure, state.pulse) : undefined;
          return (
            <g key={id} data-wire={id} data-dim={state?.dim ? "" : undefined}>
              <path
                ref={(element) => {
                  if (element) paths.current.set(id, element);
                  else paths.current.delete(id);
                }}
                className="bf-wire"
                d={roundPath(points)}
                style={
                  // A finished wire drops the dash so no rounding can leave a gap at its end.
                  measure && draw < 1
                    ? { strokeDasharray: `${dash}`, strokeDashoffset: `${dash * (1 - draw)}` }
                    : undefined
                }
              />
              <circle
                className={`bf-end${measure && (state?.flashA ?? 0) > 0.2 ? " bf-flash" : ""}`}
                data-end="a"
                cx={ax}
                cy={ay}
                r="3.2"
                style={measure ? { opacity: draw > 0 ? 1 : 0 } : undefined}
              />
              <circle
                className={`bf-end${measure && (state?.flashB ?? 0) > 0.2 ? " bf-flash" : ""}`}
                data-end="b"
                cx={bx}
                cy={by}
                r="3.2"
                style={measure ? { opacity: draw >= 0.98 ? 1 : 0 } : undefined}
              />
              {[
                ["bf-glow", "10"],
                ["bf-pulse", "4"],
              ].map(([className, r]) => (
                <circle
                  key={className}
                  className={className}
                  r={r}
                  cx={pulse?.[0]}
                  cy={pulse?.[1]}
                  style={measure ? { opacity: pulse ? 1 : 0 } : undefined}
                />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * An animated illustration: panels and icon nodes joined by connectors. The server renders the
 * final frame so it reads without script. In the browser it plays on a loop once a fifth of it is
 * on screen, pauses offscreen and in background tabs (resuming when seen again), and can be paused
 * or replayed by the reader. Under reduced motion the final frame stays.
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
  const figure = useRef<HTMLElement>(null);
  const [live, setLive] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [time, setTime] = useState(spec.duration);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const controls = useRef<{ start(from?: number): void; pause(): void; playing(): boolean }>(
    undefined,
  );

  useEffect(() => {
    const element = figure.current;
    if (!element || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let elapsed = 0;
    let playing = false;
    let started = false;
    // Paused because it scrolled away or the tab was hidden, not because the reader paused it.
    let autoPaused = false;
    let visible = false;
    let frame = 0;
    let last = 0;

    function tick(now: number) {
      frame = 0;
      if (!playing) return;
      elapsed += Math.min(0.1, (now - last) / 1000);
      last = now;
      if (elapsed >= spec.duration + HOLD) elapsed = 0;
      setTime(Math.min(elapsed, spec.duration));
      frame = requestAnimationFrame(tick);
    }
    function start(from?: number) {
      autoPaused = false;
      if (from !== undefined) elapsed = from;
      started = true;
      playing = true;
      setStatus("playing");
      last = performance.now();
      if (!frame) frame = requestAnimationFrame(tick);
    }
    function pause(next: Status = "paused") {
      playing = false;
      cancelAnimationFrame(frame);
      frame = 0;
      setStatus(next);
    }
    controls.current = { start, pause: () => pause(), playing: () => playing };
    setLive(true);

    // Play once a fifth of the figure is on screen (tall phone layouts rarely show 60% at once),
    // and pause again only when it has left the screen entirely.
    const observer = new IntersectionObserver(
      ([entry]) => {
        const seen = entry.isIntersecting && entry.intersectionRatio >= 0.2;
        visible = entry.isIntersecting;
        if (!visible && playing) {
          pause();
          autoPaused = true;
        } else if (seen && (!started || autoPaused)) start(started ? undefined : 0);
      },
      // Report every 10% so a callback landing just under 20% is followed by one that crosses it.
      { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] },
    );
    observer.observe(element);
    function onVisibility() {
      if (document.hidden && playing) {
        pause();
        autoPaused = true;
      } else if (!document.hidden && autoPaused && visible) start();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(frame);
      controls.current = undefined;
    };
  }, [spec]);

  useEffect(() => {
    if (copy !== "copied") return;
    const timer = setTimeout(() => setCopy("idle"), 1600);
    return () => clearTimeout(timer);
  }, [copy]);

  const frame = spec.frame(live ? time : spec.duration);
  const wide = useMemo<FigureGeometry>(
    () => ({ stage: spec.stage ?? STAGE, panels: spec.panels, wires: spec.wires }),
    [spec],
  );
  const copyLabel = spec.excerpt ? "Copy full file" : "Copy code";

  return (
    <figure
      ref={figure}
      className={`blog-figure${fit ? " blog-figure--fit" : ""}`}
      data-figure={kind}
      data-ready={live ? "" : undefined}
      data-state={live ? status : undefined}
    >
      <FigureStage
        geometry={wide}
        variant={spec.narrow && !fit ? "wide" : undefined}
        frame={frame}
        label={spec.label}
        live={live}
      />
      {spec.narrow && !fit ? (
        <FigureStage
          geometry={spec.narrow}
          variant="narrow"
          frame={frame}
          label={spec.label}
          live={live}
        />
      ) : null}
      {spec.source ? (
        <pre className="sr-only" data-figure-source="">
          {spec.source}
        </pre>
      ) : null}
      {/* Landing cards loop on their own; only the post offers pause, copy, and replay. */}
      {fit ? null : (
        <div className="bf-controls">
          <button
            type="button"
            className="bf-toggle"
            aria-label={live && status !== "playing" ? "Play illustration" : "Pause illustration"}
            onClick={() =>
              controls.current?.playing() ? controls.current.pause() : controls.current?.start()
            }
          >
            <svg viewBox="0 0 24 24">
              <path className="bf-icon-pause" d="M8 5h3v14H8zM13 5h3v14h-3z" />
              <path className="bf-icon-play" d="M8 5.5v13l11-6.5z" />
            </svg>
          </button>
          {spec.source ? (
            <button
              type="button"
              className="bf-copy"
              data-state={copy === "copied" ? "copied" : undefined}
              aria-label={spec.excerpt ? "Copy the full file" : "Copy code"}
              onClick={() =>
                navigator.clipboard.writeText(spec.source!).then(
                  () => setCopy("copied"),
                  () => setCopy("failed"),
                )
              }
            >
              <span>
                {copy === "copied" ? "Copied" : copy === "failed" ? "Copy failed" : copyLabel}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            className="bf-replay"
            aria-label="Replay illustration"
            onClick={() => controls.current?.start(0)}
          >
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
