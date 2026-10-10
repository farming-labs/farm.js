"use client";

import { FolderGit2, KeyRound, type LucideIcon, ScanSearch, SquareTerminal } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import {
  along,
  Box,
  Callout,
  type Camera,
  center,
  clamp,
  corners,
  Dot,
  ease,
  Feet,
  Inset,
  ISO_LENS,
  ISOMETRIC,
  lens,
  LensContext,
  lerp,
  Line,
  onGround,
  Packet,
  Panel,
  partial,
  type Point2,
  type Point3,
  Poly,
  prefersStill,
  Print,
  RoundBox,
  Screws,
  snap,
  Ticks,
  UNIT,
  useFrames,
  useLoop,
  type View,
} from "../iso/scene";

// Two drawn scenes for the agents page, in thin strokes on dark faces. Every
// object carries its real name. Each scene plays on its own, explains whatever
// you point at, holds still under reduced motion, and pauses off screen.

/** Which item arrow keys land on next, wrapping off either end to "none". */
function stepThrough(event: KeyboardEvent, current: number | null, count: number) {
  const back = event.key === "ArrowUp" || event.key === "ArrowLeft";
  const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
  if (!back && !forward) return undefined;
  event.preventDefault();
  if (current === null) return forward ? 0 : count - 1;
  const next = current + (forward ? 1 : -1);
  return next < 0 || next >= count ? null : next;
}

type FigureFrameProps = {
  /** The header, styled like the site's section labels: "01 / One codebase", "[ Fig 1 ]". */
  index: string;
  icon: LucideIcon;
  label: string;
  tag: string;
  /** A short headline and a sentence on what the scene shows. */
  heading: string;
  summary: string;
  /** What the scene is doing right now, or what the pointer is on. */
  readout: string;
  description: string;
  view: View;
  children: ReactNode;
  rootRef: React.RefObject<HTMLElement | null>;
  onKeyDown: (event: KeyboardEvent) => void;
  /** The pointer or keyboard focus left: go back to playing. */
  onRelease: () => void;
};

function FigureFrame({
  index,
  icon: Icon,
  label,
  tag,
  heading,
  summary,
  readout,
  description,
  view,
  children,
  rootRef,
  onKeyDown,
  onRelease,
}: FigureFrameProps) {
  // Clicking a figure, or pressing Enter on it, opens it close up in a dialog
  // over the blurred page. The same scene plays in both places.
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const show = () => {
    if (open) return;
    setOpen(true);
    dialogRef.current?.showModal();
  };
  const top = (
    <div aria-hidden className="agents-iso-top">
      <span className="agents-iso-label">
        <span className="agents-iso-label-index">{index}</span>
        <span className="agents-iso-label-slash">/</span>
        <Icon className="agents-iso-label-icon" strokeWidth={1.5} />
        <span className="agents-iso-label-text">{label}</span>
      </span>
      <span className="agents-iso-tag">[ {tag} ]</span>
    </div>
  );
  const drawing = (
    <svg
      aria-hidden
      onPointerLeave={(event) => {
        // A touch pointer leaves as soon as the finger lifts; keep what it tapped.
        if (event.pointerType !== "touch") onRelease();
      }}
      viewBox={view.join(" ")}
    >
      {children}
    </svg>
  );
  return (
    <figure
      aria-label={description}
      className="agents-iso"
      data-figure={index}
      onBlur={onRelease}
      onClick={show}
      onKeyDown={(event) => {
        if (
          !open &&
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          show();
          return;
        }
        onKeyDown(event);
      }}
      ref={rootRef as React.RefObject<HTMLElement>}
      tabIndex={0}
    >
      {top}
      <p className="agents-iso-title font-geist-pixel">{heading}</p>
      <p className="agents-iso-summary">{summary}</p>
      {/* A soft light sits behind the drawing, never over it. */}
      <div className="agents-iso-stage iso-scene">{drawing}</div>
      <figcaption className="agents-iso-readout">{readout}</figcaption>
      <dialog
        aria-label={`${label}, close up`}
        className="agents-iso-dialog"
        onClick={(event) => {
          // A click on the backdrop lands on the dialog itself.
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
        onClose={() => {
          setOpen(false);
          onRelease();
        }}
        ref={dialogRef}
      >
        {open && (
          <div className="agents-iso-dialog-body">
            <div className="agents-iso-dialog-head">
              {top}
              <button
                className="agents-iso-close"
                onClick={() => dialogRef.current?.close()}
                type="button"
              >
                [ Close ]
              </button>
            </div>
            <p className="agents-iso-title font-geist-pixel">{heading}</p>
            <div className="agents-iso-stage agents-iso-stage-large iso-scene">{drawing}</div>
            <p className="agents-iso-readout">{readout}</p>
          </div>
        )}
      </dialog>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Fig 1: one codebase, a street. Your repo stands at one end on a monitor;
// farm deploy sends each folder down the road to become the service it
// describes: the agent on Eve, your API routes as an MCP server at /api/mcp,
// and your pages at /. The scene starts face-on, like a diagram, then the
// camera swings round to show it in depth while it deploys, and swings back.

const STREET_Y = 2.05;
const LOT_Y: Point2 = [0.6, 1.4];
const SERVICES = [
  {
    file: "agent/",
    name: "agent",
    detail: "eve()",
    x: [3.4, 5.2] as Point2,
    look: "agent",
    live: "agent live on Eve",
    readout: "agent/ deploys as your Eve agent · integrations: { agent: eve() }",
  },
  {
    file: "app/api/orders",
    name: "mcp",
    detail: "/api/mcp",
    x: [5.7, 7.5] as Point2,
    look: "server",
    live: "mcp live at /api/mcp",
    readout: "API routes you list become MCP tools at /api/mcp",
  },
  {
    file: "app/page.tsx",
    name: "website",
    detail: "/",
    x: [8, 9.8] as Point2,
    look: "site",
    live: "website live at /",
    readout: "your pages at /, with Markdown copies for agents",
  },
] as const;
const SCREEN_X: Point2 = [0, 2.9];
const SCREEN_FRONT = 1.08;
const SCREEN_Z: Point2 = [0.34, 1.9];
const FILE_Z = [1.36, 1.1, 0.84];
const SERVICE_TOP = 1.05;
const PLATE_X: Point2 = [-0.4, 10.2];
const PLATE_Y: Point2 = [0.25, 3.05];
const DEPLOY_VIEW: [number, number, number, number] = [-98, -48, 366, 262];
// Face-on: level, a touch above the ground, scaled and shifted to sit in the
// middle of the same frame the isometric view fills.
const FACE_ON: Camera = { yaw: 0, pitch: 0.06, scale: 1.1, shift: [-77, 104] };

// The loop: open in 3D with everything live, swing round to face-on after a
// moment, hold, swing back while the buildings sink, ship each service in
// turn, and rest live in 3D, where the next loop starts.
const TURN_MS = 1500;
const TO_FACE = 2000;
const FACE_HOLD = 2000;
const TO_DEPTH = TO_FACE + TURN_MS + FACE_HOLD;
const SINK_MS = 450;
const SHIP_AT = TO_DEPTH + TURN_MS + 200;
const SHIP_EVERY = 1350;
const RIDE_MS = 750;
const RISE_MS = 450;
const DEPLOY_LOOP = SHIP_AT + SERVICES.length * SHIP_EVERY + 1900;

const SCREEN_DOOR = center(SCREEN_X);
const route = (k: number) =>
  onGround([
    [SCREEN_DOOR, 1.32],
    [SCREEN_DOOR, STREET_Y],
    [center(SERVICES[k]!.x), STREET_Y],
    [center(SERVICES[k]!.x), LOT_Y[1] + 0.1],
  ]);

/** A level, face-on camera that frames an x range and a z range in the middle of a view. */
function faceOn(
  view: [number, number, number, number],
  [x0, x1]: Point2,
  [z0, z1]: Point2,
  depth: number,
): Camera {
  const pitch = 0.06;
  const scale = Math.min(
    (view[2] * 0.88) / ((x1 - x0) * UNIT),
    (view[3] * 0.62) / ((z1 - z0) * UNIT),
  );
  const k = scale * UNIT;
  const across = ((x0 + x1) / 2) * k;
  const down = (depth * snap(Math.sin(pitch)) - ((z0 + z1) / 2) * snap(Math.cos(pitch))) * k;
  return {
    yaw: 0,
    pitch,
    scale,
    shift: [view[0] + view[2] / 2 - across, view[1] + view[3] / 2 - down],
  };
}

function blend(from: Camera, to: Camera, amount: number): Camera {
  return {
    yaw: lerp(from.yaw, to.yaw, amount),
    pitch: lerp(from.pitch, to.pitch, amount),
    scale: lerp(from.scale, to.scale, amount),
    shift: [lerp(from.shift[0], to.shift[0], amount), lerp(from.shift[1], to.shift[1], amount)],
  };
}

/**
 * A building on its lot: a plinth, a soft-cornered body with an inset roof and
 * a cornice line, its name and route across the front, and whatever makes it
 * read as what it is.
 */
function Building({
  x,
  top,
  name,
  detail,
  look,
  shown = 1,
}: {
  x: Point2;
  top: number;
  name: string;
  detail: string;
  look: "agent" | "server" | "site";
  /** How much of the building's dressing shows, 0 to 1, while it rises. */
  shown?: number;
}) {
  const [x0, x1] = x;
  const [y0, y1] = LOT_Y;
  const [cx, cy] = [center(x), center(LOT_Y)];
  const base = 0.1;
  const height = top - base;
  return (
    <>
      <RoundBox r={0.08} x={[x0 - 0.06, x1 + 0.06]} y={[y0 - 0.06, y1 + 0.06]} z={[0.04, base]} />
      <RoundBox r={0.07} x={x} y={LOT_Y} z={[base, top]}>
        <Inset r={0.05} x={[x0 + 0.1, x1 - 0.1]} y={[y0 + 0.1, y1 - 0.1]} z={top} />
      </RoundBox>
      <g style={{ opacity: shown }}>
        <Line
          className="iso-detail-line"
          lines={[
            [
              [x0 + 0.07, y1, top - 0.06],
              [x1 - 0.07, y1, top - 0.06],
            ],
          ]}
        />
        {look === "agent" && (
          // Two eyes on the roof and an antenna between them.
          <>
            <Dot at={[cx - 0.32, cy, top]} className="iso-ink" r={0.08} />
            <Dot at={[cx + 0.32, cy, top]} className="iso-ink" r={0.08} />
            <Box x={[cx - 0.025, cx + 0.025]} y={[cy - 0.025, cy + 0.025]} z={[top, top + 0.32]} />
            <RoundBox
              r={0.06}
              x={[cx - 0.065, cx + 0.065]}
              y={[cy - 0.065, cy + 0.065]}
              z={[top + 0.32, top + 0.42]}
            />
          </>
        )}
        {look === "server" && (
          // Rack units below the sign, and vents down each unit's side.
          <>
            <Line
              className="iso-detail-line"
              lines={[0.15, 0.32].map((share): Point3[] => [
                [x0 + 0.04, y1, base + share * height],
                [x1 - 0.04, y1, base + share * height],
              ])}
            />
            <Line
              className="iso-tick"
              lines={[1 / 6, 1 / 2, 5 / 6].flatMap((share) =>
                [-0.05, 0, 0.05].map((dz): Point3[] => [
                  [x1, y0 + 0.18, base + share * height + dz],
                  [x1, y1 - 0.18, base + share * height + dz],
                ]),
              )}
            />
            {[0.075, 0.235].map((share) => (
              <Panel
                className="iso-led-face"
                key={share}
                x={[x1 - 0.2, x1 - 0.13]}
                y={y1}
                z={[base + share * height - 0.025, base + share * height + 0.025]}
              />
            ))}
          </>
        )}
        {look === "site" && (
          // A browser on the roof: its bar, three dots, and lines of a page.
          <>
            <Line
              className="iso-detail-line"
              lines={[
                [
                  [x0 + 0.1, y0 + 0.32, top],
                  [x1 - 0.1, y0 + 0.32, top],
                ],
              ]}
            />
            {[0.22, 0.34, 0.46].map((offset) => (
              <Dot at={[x0 + offset, y0 + 0.21, top]} className="iso-ink" key={offset} r={0.035} />
            ))}
            <Line
              className="iso-tick"
              lines={[
                [0.5, 1.1],
                [0.62, 0.8],
              ].map(([dy, length]): Point3[] => [
                [x0 + 0.25, y0 + dy!, top],
                [x0 + 0.25 + length!, y0 + dy!, top],
              ])}
            />
          </>
        )}
        <Print at={[x0 + 0.16, y1, top - 0.32]} size={6}>
          {name}
        </Print>
        <Print at={[x0 + 0.16, y1, top - 0.54]} size={4.8}>
          <tspan className="iso-print-dim">{detail}</tspan>
        </Print>
      </g>
    </>
  );
}

const STREET = (
  <>
    <Feet
      at={[
        [-0.1, 2.75],
        [9.9, 2.75],
        [9.9, 0.55],
      ]}
      z={[-0.38, -0.28]}
    />
    <RoundBox className="iso-base" r={0.4} x={PLATE_X} y={PLATE_Y} z={[-0.28, 0]}>
      <Inset r={0.28} x={[-0.2, 10]} y={[0.45, 2.85]} z={0} />
      <Screws at={corners([-0.12, 9.92], [0.53, 2.77])} z={0} />
    </RoundBox>
    <Print at={[0.3, PLATE_Y[1], -0.18]} size={4.6}>
      <tspan className="iso-print-dim">your-app.com</tspan>
    </Print>
    {/* The road, the drive from the monitor, and a spur to each lot. */}
    <RoundBox
      className="iso-road"
      r={0.12}
      x={[SCREEN_DOOR - 0.24, center(SERVICES[2].x) + 0.24]}
      y={[STREET_Y - 0.24, STREET_Y + 0.24]}
      z={[0, 0.03]}
    />
    {[SCREEN_DOOR, ...SERVICES.map(({ x }) => center(x))].map((x, k) => (
      <RoundBox
        className="iso-road"
        key={x}
        r={0.06}
        x={[x - 0.14, x + 0.14]}
        y={[k === 0 ? 1.3 : LOT_Y[1] + 0.06, STREET_Y - 0.2]}
        z={[0, 0.03]}
      />
    ))}
    <Line
      className="iso-wire iso-dash"
      lines={[
        onGround(
          [
            [SCREEN_DOOR, STREET_Y],
            [center(SERVICES[2].x), STREET_Y],
          ],
          0.031,
        ),
      ]}
    />
    <Ticks
      every={0.25}
      from={[SCREEN_DOOR + 0.1, STREET_Y + 0.32, 0]}
      mark={[[0, 0.07, 0], 4]}
      to={[center(SERVICES[2].x) + 0.1, STREET_Y + 0.32, 0]}
    />
    <Print at={[0.2, 2.62, 0]} face="top" size={4.6}>
      <tspan className="iso-print-dim">$ farm deploy</tspan>
    </Print>
    {/* The monitor your repo is open on: foot, neck, and screen. */}
    <RoundBox r={0.14} x={[0.75, 2.15]} y={[0.8, 1.32]} z={[0, 0.05]} />
    <Box x={[1.39, 1.51]} y={[0.95, 1.03]} z={[0.05, SCREEN_Z[0]]} />
    <Box x={SCREEN_X} y={[0.98, SCREEN_FRONT]} z={SCREEN_Z} />
    <Panel x={[0.07, 2.83]} y={SCREEN_FRONT} z={[SCREEN_Z[0] + 0.07, SCREEN_Z[1] - 0.07]} />
    <Line
      className="iso-detail-line"
      lines={[
        [
          [0.07, SCREEN_FRONT, 1.58],
          [2.83, SCREEN_FRONT, 1.58],
        ],
      ]}
    />
    {[0.18, 0.28, 0.38].map((x) => (
      <Panel className="iso-ink-face" key={x} x={[x, x + 0.05]} y={SCREEN_FRONT} z={[1.68, 1.75]} />
    ))}
    <Print at={[0.55, SCREEN_FRONT, 1.67]} size={4.8}>
      your-app/
    </Print>
    <Print at={[0.2, SCREEN_FRONT, 0.5]} size={4.2}>
      <tspan className="iso-print-dim">main · 3 folders</tspan>
    </Print>
  </>
);

export function CodebaseFigure() {
  const rootRef = useRef<HTMLElement>(null);
  const [steer, setSteer] = useState<number | null>(null);
  const t = useLoop(rootRef, DEPLOY_LOOP, 0, steer !== null);

  const faced = ease(clamp((t - TO_FACE) / TURN_MS)) - ease(clamp((t - TO_DEPTH) / TURN_MS));
  const camera = blend(ISOMETRIC, FACE_ON, faced);
  // Live, then sunk as the camera swings back, then each ships in turn.
  const sunk = ease(clamp((t - TO_DEPTH) / SINK_MS));
  const ship = SERVICES.map((_, k) => {
    const start = SHIP_AT + k * SHIP_EVERY;
    const risen =
      t < TO_DEPTH ? 1 : Math.max(1 - sunk, ease(clamp((t - start - RIDE_MS) / RISE_MS)));
    return {
      ride: t >= start ? clamp((t - start) / RIDE_MS) : 0,
      rise: risen,
    };
  });
  const shipping = ship.findIndex(({ ride }, k) => ride > 0 && ship[k]!.rise < 1);
  const on = steer ?? (shipping >= 0 ? shipping : null);
  const live = ship.filter(({ rise }) => rise >= 1).length;
  const last = SERVICES[live - 1];
  const readout =
    steer !== null
      ? SERVICES[steer]!.readout
      : t < TO_FACE
        ? "3 services live on your-app.com · one codebase"
        : t < SHIP_AT
          ? "your-app/ → agent on eve() · mcp at /api/mcp · website at /"
          : shipping >= 0
            ? `farm deploy · ${SERVICES[shipping]!.file} → ${SERVICES[shipping]!.detail}`
            : live === SERVICES.length
              ? "3 services live on your-app.com · one codebase"
              : last
                ? last.live
                : "$ farm deploy";

  const onKeyDown = (event: KeyboardEvent) => {
    const next = stepThrough(event, steer, SERVICES.length);
    if (next !== undefined) setSteer(next);
  };

  return (
    <FigureFrame
      description="One codebase: farm deploy turns the agent/ folder into your Eve agent, your API routes into an MCP server at /api/mcp, and your pages into your website at /, all on one domain. Hover a building, or use the arrow keys, to see what each part becomes."
      heading="Ship it all from one repo."
      icon={FolderGit2}
      index="01"
      label="One codebase"
      onKeyDown={onKeyDown}
      onRelease={() => setSteer(null)}
      readout={readout}
      rootRef={rootRef}
      summary="farm deploy turns your agent/ folder, your API routes, and your pages into an agent, an MCP server, and a website, live together on your domain."
      tag="Fig 1"
      view={DEPLOY_VIEW}
    >
      <LensContext.Provider value={lens(camera)}>
        {STREET}
        {shipping >= 0 && (
          <Line
            className="iso-trail"
            lines={[partial(route(shipping), ease(ship[shipping]!.ride))]}
          />
        )}
        {SERVICES.map(({ file }, k) => (
          <g className="iso-lane" data-on={on === k || undefined} key={file}>
            <Panel
              className="iso-row-mark"
              x={[0.12, 2.78]}
              y={SCREEN_FRONT}
              z={[FILE_Z[k]! - 0.07, FILE_Z[k]! + 0.16]}
            />
            <Panel
              className="iso-ink-face"
              x={[0.2, 0.27]}
              y={SCREEN_FRONT}
              z={[FILE_Z[k]!, FILE_Z[k]! + 0.09]}
            />
            <Print at={[0.36, SCREEN_FRONT, FILE_Z[k]!]} size={4.8}>
              {file}
            </Print>
          </g>
        ))}
        {SERVICES.map(({ file, name, detail, x, look }, k) => {
          const { rise } = ship[k]!;
          return (
            <g
              className="iso-lane"
              data-on={on === k || undefined}
              key={file}
              onPointerDown={() => setSteer(k)}
              onPointerEnter={() => setSteer(k)}
            >
              <RoundBox
                className="iso-road"
                r={0.1}
                x={[x[0] - 0.12, x[1] + 0.12]}
                y={[LOT_Y[0] - 0.12, LOT_Y[1] + 0.12]}
                z={[0, 0.04]}
              >
                {rise <= 0.02 && <Inset className="iso-ghost" r={0.06} x={x} y={LOT_Y} z={0.04} />}
              </RoundBox>
              {rise > 0.02 && (
                <Building
                  detail={detail}
                  look={look}
                  name={name}
                  shown={clamp((rise - 0.5) * 2)}
                  top={0.1 + (SERVICE_TOP - 0.1) * rise}
                  x={x}
                />
              )}
            </g>
          );
        })}
        {shipping >= 0 && ship[shipping]!.ride < 1 && (
          <Packet at={along(route(shipping), ease(ship[shipping]!.ride))} />
        )}
      </LensContext.Provider>
    </FigureFrame>
  );
}

// ---------------------------------------------------------------------------
// Fig 2: agent-ready. Everything that makes a site usable by agents, as a stack
// of glass panes on four posts: robots.txt at the bottom, then the page, its
// Markdown, llms.txt, OpenAPI, MCP, and WebMCP on top. A request climbs the
// front post and checks each layer the way /agents/check does, filling a gauge
// to 100; the agent card at /.well-known is reported alongside.

const LAYERS = [
  {
    name: "robots.txt",
    detail: "allow",
    points: 15,
    playing: "GET /robots.txt · agents acting for people aren't blocked  +15",
    explain: "robots.txt · lets agents that act for people, and AI search, in",
  },
  {
    name: "page",
    detail: "html · <head>",
    points: 35,
    playing: "GET / · readable without JavaScript · title, canonical, JSON-LD  +35",
    explain: "page · readable HTML, with a title, canonical, Open Graph and JSON-LD",
  },
  {
    name: "markdown",
    detail: ".md",
    points: 20,
    playing: "GET /index.md · Accept: text/markdown  +20",
    explain: "markdown · every page at .md, or with Accept: text/markdown",
  },
  {
    name: "llms.txt",
    detail: "index",
    points: 15,
    playing: "GET /llms.txt · a Markdown map of the site  +15",
    explain: "llms.txt · a Markdown map of your site for language models",
  },
  {
    name: "openapi",
    detail: ".json",
    points: 5,
    playing: "GET /openapi.json · your API, described  +5",
    explain: "openapi · a machine-readable description of your API",
  },
  {
    name: "mcp",
    detail: "/api/mcp",
    points: 10,
    playing: "POST /api/mcp · tools agents can call  +10",
    explain: "mcp · your API routes as tools, over Streamable HTTP",
  },
  {
    name: "webmcp",
    detail: "in the page",
    points: 0,
    playing: "WebMCP · the open page registers search_products and add_to_cart · reported",
    explain: "webmcp · tools the open page registers for agents in the browser",
  },
] as const;
const TOP = LAYERS.length - 1;
const PANE_Z0 = 0.45;
const PANE_GAP = 0.4;
const PANE_THIN = 0.05;
const PANE_TOP = 0.14;
const paneZ = (i: number) => PANE_Z0 + i * PANE_GAP;
const paneThick = (i: number) => (i === TOP ? PANE_TOP : PANE_THIN);
// The scan's stops: each pane bottom up, then the agent card. Pane stops are
// the pane's index.
type Stop = number | "card" | "done";
const SCAN: Stop[] = [...LAYERS.map((_, i) => i), "card", "done"];
const STOP_MS = 1500;
const PANE: Point2 = [0.3, 3.7];
const POSTS: Point2[] = [
  [0.6, 0.6],
  [3.4, 0.6],
  [0.6, 3.4],
  [3.4, 3.4],
];
const FRONT_POST = POSTS[3]!;
const POST_W = 0.045;
// The pane being checked rises a little; the panes above it clear the way.
const RAISE = 0.14;
const LIFT = 0.3;
const POST_TOP = paneZ(TOP) + PANE_TOP + LIFT + 0.36;
const BASE_Y: Point2 = [-0.9, 4.9];
const AGENT_CARD_X: Point2 = [3.05, 4.6];
const AGENT_CARD_AT: Point3 = [center(AGENT_CARD_X), -0.2, 0.06];
const PARKED: Point3 = [...FRONT_POST, 0.04];
const GAUGE_X: Point2 = [0.4, 3.6];
const GAUGE_Y = 4.35;
const STACK_VIEW: [number, number, number, number] = [-160, -112, 320, 278];
// The stop being checked is labelled on a wire drawn out from it. Each pane
// has its own place: the wire leaves the pane from one side, climbs beside the
// stack, and turns out into a label near the pane's own height. The two lowest
// panes wire out to the left, clear of the agent card; from there the sides
// alternate. The top pane's label turns in, over the stack, where its tool
// names have room. Screen positions, in view units.
const WIRE_MS = 700;
const GUTTER = 96;
const WEBMCP_TOOLS = ["search_products", "add_to_cart"] as const;
const PANE_WIRES: { side: -1 | 1; y: number; turnIn?: boolean }[] = [
  { side: -1, y: 10 },
  { side: -1, y: -18 },
  { side: 1, y: -12 },
  { side: -1, y: -46 },
  { side: 1, y: -52 },
  { side: -1, y: -74 },
  { side: 1, y: -100, turnIn: true },
];

/** Points scored once the scan has reached a stop. */
function scoreAfter(stop: Stop) {
  const reached = SCAN.indexOf(stop);
  return LAYERS.reduce((score, layer, i) => (reached >= i ? score + layer.points : score), 0);
}

/** The top pane: a browser with the two tools the page registers for agents. */
function WebMcpPane({ top, lit }: { top: number; lit: boolean }) {
  return (
    <>
      <Inset r={0.1} x={[0.65, 3.35]} y={[0.65, 2.95]} z={top} />
      <Line
        className="iso-tick"
        lines={[
          [
            [0.65, 1.0, top],
            [3.35, 1.0, top],
          ],
        ]}
      />
      {WEBMCP_TOOLS.map((tool, i) => (
        <RoundBox
          className={lit ? "iso-tool iso-tool-on" : "iso-tool"}
          key={tool}
          r={0.08}
          x={[0.9, 2.8]}
          y={[1.35 + i * 0.6, 1.77 + i * 0.6]}
          z={[top, top + 0.04]}
        >
          <Print at={[1.02, 1.65 + i * 0.6, top + 0.04]} face="top" size={3.8}>
            {tool}()
          </Print>
        </RoundBox>
      ))}
    </>
  );
}

/** A pane's label, wired out from the pane's left or right corner to its own place. */
function PaneCallout({ pane, top, drawn }: { pane: number; top: number; drawn: number }) {
  const { name, detail, points } = LAYERS[pane]!;
  const { side, y, turnIn } = PANE_WIRES[pane]!;
  const [x0, x1] = side < 0 ? [PANE[0] + 0.12, PANE[1] - 0.08] : [PANE[1] - 0.08, PANE[0] + 0.12];
  const [ax, ay] = ISO_LENS.at(x0, x1, top);
  const gutter = side * (turnIn ? GUTTER + 16 : GUTTER);
  const turn = side * (turnIn ? -10 : 8);
  return (
    <Callout
      align={side < 0 !== Boolean(turnIn) ? "end" : "start"}
      detail={pane === TOP ? WEBMCP_TOOLS.map((tool) => `${tool}()`) : [detail, `+${points}`]}
      drawn={drawn}
      label={name}
      route={[
        [ax, ay],
        [gutter, ay],
        [gutter, y],
        [gutter + turn, y],
      ]}
    />
  );
}

const STACK_BASE = (
  <>
    <Feet
      at={[
        [4.5, -0.5],
        [-0.5, BASE_Y[1] - 0.4],
        [4.5, BASE_Y[1] - 0.4],
      ]}
      z={[-0.44, -0.32]}
    />
    <RoundBox className="iso-base" r={0.45} x={[-0.9, 4.9]} y={BASE_Y} z={[-0.32, 0]}>
      <Inset r={0.3} x={[-0.65, 4.65]} y={[BASE_Y[0] + 0.25, BASE_Y[1] - 0.25]} z={0} />
    </RoundBox>
    <Print at={[-0.35, BASE_Y[1], -0.22]} size={4.6}>
      <tspan className="iso-print-dim">your-app.com</tspan>
    </Print>
    <Ticks
      every={(GAUGE_X[1] - GAUGE_X[0]) / 10}
      from={[GAUGE_X[0], GAUGE_Y + 0.04, 0.002]}
      mark={[[0, 0.06, 0], 5]}
      to={[GAUGE_X[1], GAUGE_Y + 0.04, 0.002]}
    />
  </>
);

export function ReadinessFigure() {
  const rootRef = useRef<HTMLElement>(null);
  const [steer, setSteer] = useState<Stop | null>(null);
  const [stop, setStop] = useState<Stop | null>(null);
  const [lift, setLift] = useState<number[]>(() => LAYERS.map(() => 0));
  const [packet, setPacket] = useState<Point3>(PARKED);
  const [score, setScore] = useState(0);
  const [wiring, setWiring] = useState<{ to: Stop | null; drawn: number }>({
    to: null,
    drawn: 0,
  });
  const state = useRef({ lift, packet, stop, steer, score, wiring, changedAt: 0, wiredAt: 0 });
  state.current = { ...state.current, lift, packet, stop, steer, score, wiring };

  const paneOf = (at: Stop | null) => (typeof at === "number" ? at : null);
  const targetsFor = (pane: number | null) =>
    LAYERS.map((_, i) => (pane === null || i < pane ? 0 : i === pane ? RAISE : LIFT));
  const packetFor = (at: Stop | null, targets: number[]): Point3 => {
    if (at === "card") return AGENT_CARD_AT;
    const pane = paneOf(at);
    if (pane === null) return PARKED;
    return [...FRONT_POST, paneZ(pane) + targets[pane]! + paneThick(pane)];
  };

  const kickRef = useFrames(rootRef, (now) => {
    if (prefersStill()) return false;
    const {
      lift: current,
      packet: at,
      stop: here,
      steer: held,
      score: shown,
      wiring: wired,
      changedAt,
      wiredAt,
    } = state.current;
    // Ease the panes, the request, and the gauge toward where they belong.
    const targets = targetsFor(paneOf(here));
    const next = current.map((value, i) => value + (targets[i]! - value) * 0.16);
    if (next.some((value, i) => Math.abs(value - current[i]!) > 0.0005)) setLift(next);
    const goal = packetFor(here, targets);
    if (goal.some((value, axis) => Math.abs(value - at[axis]!) > 0.002)) {
      setPacket(at.map((value, axis) => value + (goal[axis]! - value) * 0.14) as Point3);
    }
    const scored = here === null ? 0 : scoreAfter(here);
    if (Math.abs(scored - shown) > 0.3) setScore(shown + (scored - shown) * 0.1);
    else if (shown !== scored) setScore(scored);
    // The label's wire draws out again from each new stop.
    const pointed = held ?? here;
    if (pointed !== wired.to) {
      state.current.wiredAt = now;
      state.current.wiring = { to: pointed, drawn: 0 };
      setWiring(state.current.wiring);
    } else if (wired.drawn < 1) {
      setWiring({ to: pointed, drawn: ease(clamp((now - wiredAt) / WIRE_MS)) });
    }
    // Nobody steering: walk the scan bottom up, rest on the score, start over.
    if (held === null && now - changedAt > (here === "done" ? STOP_MS * 1.8 : STOP_MS)) {
      const position = here === null ? -1 : SCAN.indexOf(here);
      visit(position + 1 < SCAN.length ? SCAN[position + 1]! : null);
    }
    return true;
  });

  function visit(at: Stop | null) {
    setStop(at);
    state.current.changedAt = performance.now();
    if (prefersStill()) {
      const targets = targetsFor(paneOf(at));
      setLift(targets);
      setPacket(packetFor(at, targets));
      setScore(at === null ? 0 : scoreAfter(at));
      setWiring({ to: at, drawn: 1 });
    }
    kickRef.current();
  }
  // Where the scan was when a pointer or the keyboard took over, so letting go
  // picks it up there instead of starting over.
  const resumeRef = useRef<{ stop: Stop | null; elapsed: number } | null>(null);
  const hold = (at: Stop | null) => {
    if (at !== null) {
      resumeRef.current ??= {
        stop: state.current.stop,
        elapsed: performance.now() - state.current.changedAt,
      };
      setSteer(at);
      visit(at);
      return;
    }
    const resume = resumeRef.current;
    if (!resume) return;
    resumeRef.current = null;
    setSteer(null);
    visit(resume.stop);
    state.current.changedAt = performance.now() - resume.elapsed;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const order: Stop[] = [...LAYERS.map((_, i) => i), "card"];
    const position = steer === null || !order.includes(steer) ? null : order.indexOf(steer);
    const next = stepThrough(event, position, order.length);
    if (next !== undefined) hold(next === null ? null : order[next]!);
  };

  const shown = Math.round(score);
  const readout =
    steer === "card"
      ? "agent card · at /.well-known, reported while the spec settles"
      : typeof steer === "number"
        ? LAYERS[steer]!.explain
        : stop === "card"
          ? "GET /.well-known/agent-card.json · reported"
          : typeof stop === "number"
            ? LAYERS[stop]!.playing
            : stop === "done"
              ? "agent-ready · 100/100 · the agent card and WebMCP reported"
              : "an agent opens your-app.com";

  // Paint bottom to top: the posts up to a pane, then the pane.
  const bottoms = LAYERS.map((_, i) => paneZ(i) + lift[i]!);
  const tops = LAYERS.map((_, i) => bottoms[i]! + paneThick(i));
  const filled = lerp(GAUGE_X[0], GAUGE_X[1], score / 100);
  const post = ([x, y]: Point2, from: number, to: number) => (
    <Box
      key={`${x}-${y}`}
      x={[x - POST_W, x + POST_W]}
      y={[y - POST_W, y + POST_W]}
      z={[from, to]}
    />
  );

  return (
    <FigureFrame
      description="Agent-ready: everything that makes a site usable by agents, as a stack: robots.txt, a readable page with metadata, its Markdown, llms.txt, OpenAPI, an MCP server, and WebMCP tools in the page, checked layer by layer the way /agents/check does and scored to 100. Hover a layer, or use the arrow keys, to see what it is."
      heading="Readable, callable, checked."
      icon={ScanSearch}
      index="02"
      label="Agent-ready"
      onKeyDown={onKeyDown}
      onRelease={() => hold(null)}
      readout={readout}
      rootRef={rootRef}
      summary="Every layer an agent looks for, from robots.txt and Markdown to MCP and the WebMCP tools in your page, checked the way /agents/check does."
      tag="Fig 2"
      view={STACK_VIEW}
    >
      {STACK_BASE}
      {/* The agent card stands at the back of the base, at /.well-known. */}
      <g
        className="iso-lane"
        data-on={stop === "card" || steer === "card" || undefined}
        onPointerDown={() => hold("card")}
        onPointerEnter={() => hold("card")}
      >
        <Box x={[AGENT_CARD_X[0] - 0.1, AGENT_CARD_X[1] + 0.1]} y={[-0.56, -0.3]} z={[0, 0.05]} />
        <Box x={AGENT_CARD_X} y={[-0.45, -0.39]} z={[0.05, 0.6]} />
        <Print at={[AGENT_CARD_X[0] + 0.12, -0.39, 0.32]} size={4.2}>
          /.well-known
        </Print>
      </g>
      {LAYERS.map(({ name, detail }, i) => (
        <g key={name}>
          {POSTS.map((at) => post(at, i === 0 ? 0 : tops[i - 1]!, bottoms[i]!))}
          <g
            className={i === TOP ? "iso-lane iso-pane iso-pane-solid" : "iso-lane iso-pane"}
            data-on={stop === i || steer === i || undefined}
            onPointerDown={() => hold(i)}
            onPointerEnter={() => hold(i)}
          >
            <RoundBox r={0.07} x={PANE} y={PANE} z={[bottoms[i]!, tops[i]!]}>
              {i === TOP && <WebMcpPane lit={stop === TOP || steer === TOP} top={tops[i]!} />}
              <Print at={[0.8, 3.5, tops[i]!]} face="top" size={4.8}>
                {name} <tspan className="iso-print-dim">{detail}</tspan>
              </Print>
            </RoundBox>
          </g>
        </g>
      ))}
      {POSTS.map((at) => post(at, tops[TOP]!, POST_TOP))}
      {POSTS.map(([x, y]) => (
        <RoundBox
          key={`cap-${x}-${y}`}
          r={0.07}
          x={[x - 0.07, x + 0.07]}
          y={[y - 0.07, y + 0.07]}
          z={[POST_TOP, POST_TOP + 0.05]}
        />
      ))}
      <Line
        className="iso-trail"
        lines={[
          [
            [GAUGE_X[0], GAUGE_Y, 0.004],
            [filled, GAUGE_Y, 0.004],
          ],
        ]}
      />
      <Print at={[GAUGE_X[0], GAUGE_Y - 0.12, 0]} face="top" size={4.4}>
        agent-ready <tspan className="iso-print-dim">{shown}/100</tspan>
      </Print>
      <Packet at={packet} />
      {typeof wiring.to === "number" && (
        <PaneCallout drawn={wiring.drawn} key={wiring.to} pane={wiring.to} top={tops[wiring.to]!} />
      )}
      {wiring.to === "card" && (
        <Callout
          detail={["agent-card.json", "reported"]}
          drawn={wiring.drawn}
          label="/.well-known"
          route={(([x, y]) => [
            [x, y],
            [x, -82],
            [x + 8, -82],
          ])(ISO_LENS.at(AGENT_CARD_X[0] + 0.25, -0.39, 0.6))}
        />
      )}
    </FigureFrame>
  );
}

// ---------------------------------------------------------------------------
// Fig 3: farm dev, on a vintage all-in-one. The screen boots to the Farm.js
// mark, the keyboard types the command, and the screen lists what came up on
// one origin: the Eve agent runtime, the MCP server at /api/mcp, and the site.

// What the screen prints after the command, and when.
const LINES = [
  { at: 0, text: "$ farm dev", readout: "$ farm dev" },
  { at: 1500, text: "✓ site /", readout: "http://localhost:3000 · your site" },
  // The screen shortens Farm's log line, "eve runtime ready", to fit.
  { at: 2100, text: "✓ eve ready", readout: "eve runtime ready · your agent, on the same origin" },
  { at: 2700, text: "✓ mcp /api/mcp", readout: "mcp ready at /api/mcp · the tools you listed" },
] as const;
// The command, key by key: eight characters and Enter.
const KEYSTROKES = ["f", "a", "r", "m", " ", "d", "e", "v", "enter"] as const;
const KEY_MS = 110;
const TYPE_MS = KEYSTROKES.length * KEY_MS;
// A scanline sweeps the screen while it boots, so the boot reads as one.
const SCAN_MS = 850;
// How long a keystroke's dash takes to run one dash length down the cable.
const CORD_MS = 450;
// The command and its output play out in 3D. Once the output has finished,
// right before the logo comes up, the camera swings round to face the screen;
// the screen blinks off, the logo boots face-on, and the camera swings back
// for the next run.
const SWING_IN = 3500;
const POWER_OFF = 4400;
const BOOT_AT = 4800;
const SWING_BACK = 6600;
const DEV_LOOP = 8600;
const DEV_START = 0;
const BODY_X: Point2 = [0.5, 2.7];
const BODY_Y: Point2 = [0.3, 2.1];
const BODY_TOP = 2.5;
const CRT_X: Point2 = [0.84, 2.36];
const CRT_Z: Point2 = [1.18, 2.15];
const KEYBOARD_X: Point2 = [0.3, 2.9];
const KEYBOARD_Y: Point2 = [2.75, 3.65];
// A plain QWERTY layout: each row a little further right than the one above.
const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"] as const;
const KEY_ROW_Y = [2.92, 3.13, 3.34];
const KEY_PITCH = 0.21;
const KEY_TOP = 0.19;
const KEY_PRESSED = 0.145;
const DEV_VIEW: [number, number, number, number] = [-150, -92, 300, 262];
const DEV_FACE_ON = faceOn(DEV_VIEW, [-0.5, 4.7], [-0.4, BODY_TOP], 2);
// The keyboard's cable, from its back edge round to the computer's side.
const KEY_CABLE = coil(
  [
    [2.65, 2.75, 0.03],
    [3.4, 2.55, 0.03],
    [3.35, 1.5, 0.03],
    [2.7, 1.25, 0.3],
  ],
  0,
  0,
);

/** A cable lying on the ground, wound into loose coils. */
function coil(controls: Point3[], turns: number, wobble: number): Point3[] {
  return Array.from({ length: 64 }, (_, step): Point3 => {
    const t = step / 63;
    const weights = [(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3];
    const [x, y, z] = [0, 1, 2].map((axis) =>
      controls.reduce((sum, point, k) => sum + point[axis]! * weights[k]!, 0),
    ) as Point3;
    const swing = Math.sin(t * Math.PI * 2 * turns) * wobble * Math.sin(t * Math.PI);
    return [x + swing, y - swing, z];
  });
}

const DESK = (
  <>
    <Feet
      at={[
        [4.3, -0.05],
        [-0.15, 4.05],
        [4.3, 4.05],
      ]}
      z={[-0.4, -0.28]}
    />
    <RoundBox className="iso-base" r={0.4} x={[-0.5, 4.7]} y={[-0.3, 4.4]} z={[-0.28, 0]}>
      <Inset r={0.28} x={[-0.28, 4.48]} y={[-0.08, 4.18]} z={0} />
      <Screws at={corners([-0.2, 4.4], [0, 4.1])} z={0} />
    </RoundBox>
    <Print at={[-0.1, 4.4, -0.19]} size={4.6}>
      <tspan className="iso-print-dim">localhost:3000</tspan>
    </Print>
    {/* The mouse's cable runs back to the computer. */}
    <Line
      className="iso-cord"
      lines={[
        coil(
          [
            [3.62, 2.88, 0.03],
            [3.75, 2.2, 0.03],
            [3.6, 0.9, 0.03],
            [2.7, 0.8, 0.22],
          ],
          0,
          0,
        ),
      ]}
    />
  </>
);

/** The all-in-one computer: body, recessed screen, drive slot, power light, and vents. */
function Computer({ screen, on }: { screen: ReactNode; on: boolean }) {
  const front = BODY_Y[1];
  return (
    <>
      <RoundBox r={0.14} x={BODY_X} y={BODY_Y} z={[0, BODY_TOP]}>
        <Inset
          r={0.1}
          x={[BODY_X[0] + 0.14, BODY_X[1] - 0.14]}
          y={[BODY_Y[0] + 0.14, BODY_Y[1] - 0.14]}
          z={BODY_TOP}
        />
      </RoundBox>
      <Panel x={[0.76, 2.44]} y={front} z={[1.04, 2.29]} />
      <Panel className={on ? "iso-crt iso-crt-on" : "iso-crt"} x={CRT_X} y={front} z={CRT_Z} />
      {screen}
      <Panel className="iso-slot" x={[1.62, 2.32]} y={front} z={[0.7, 0.77]} />
      <Panel
        className={on ? "iso-power iso-power-on" : "iso-power"}
        x={[0.84, 0.92]}
        y={front}
        z={[0.72, 0.77]}
      />
      <Print at={[0.84, front, 0.36]} size={3.6}>
        <tspan className="iso-print-dim">farm.js</tspan>
      </Print>
      <Line
        className="iso-tick"
        lines={[1.62, 1.74, 1.86, 1.98, 2.1].map((z): Point3[] => [
          [BODY_X[1], BODY_Y[0] + 0.3, z],
          [BODY_X[1], BODY_Y[1] - 0.3, z],
        ])}
      />
    </>
  );
}

/** The Farm.js mark: three stacked bars, as on the site's header. */
function FarmMark({ x, z }: { x: number; z: number }) {
  const front = BODY_Y[1];
  return (
    <>
      <Panel className="iso-ink-face" x={[x, x + 0.46]} y={front} z={[z + 0.2, z + 0.27]} />
      <Panel className="iso-ink-face" x={[x, x + 0.6]} y={front} z={[z + 0.1, z + 0.17]} />
      <Panel className="iso-ink-face" x={[x, x + 0.18]} y={front} z={[z, z + 0.07]} />
      <Panel className="iso-ink-face" x={[x + 0.24, x + 0.42]} y={front} z={[z, z + 0.07]} />
    </>
  );
}

type Keycap = { id: string; x: Point2; y: Point2 };
const KEYCAPS: Keycap[] = [
  ...KEY_ROWS.flatMap((row, r) =>
    [...row].map((id, column): Keycap => {
      const x = KEYBOARD_X[0] + 0.14 + r * 0.1 + column * KEY_PITCH;
      return { id, x: [x, x + 0.17], y: [KEY_ROW_Y[r]! - 0.075, KEY_ROW_Y[r]! + 0.075] };
    }),
  ),
  {
    id: "enter",
    x: [KEYBOARD_X[0] + 0.24 + 9 * KEY_PITCH, KEYBOARD_X[0] + 0.56 + 9 * KEY_PITCH],
    y: [KEY_ROW_Y[1]! - 0.075, KEY_ROW_Y[1]! + 0.075],
  },
  { id: " ", x: [1.0, 2.1], y: [3.48, 3.6] },
];

/** The keyboard: a deck of keycaps, the one being typed pressed down and lit. */
function Keyboard({ pressed }: { pressed: string | null }) {
  return (
    <>
      <RoundBox r={0.08} x={KEYBOARD_X} y={KEYBOARD_Y} z={[0, 0.12]} />
      {KEYCAPS.map(({ id, x, y }) => (
        <RoundBox
          className={pressed === id ? "iso-key iso-key-on" : "iso-key"}
          key={id}
          r={0.03}
          x={x}
          y={y}
          z={[0.12, pressed === id ? KEY_PRESSED : KEY_TOP]}
        />
      ))}
    </>
  );
}

export function DevFigure() {
  const rootRef = useRef<HTMLElement>(null);
  const [steer, setSteer] = useState<"computer" | "keyboard" | null>(null);
  const t = useLoop(rootRef, DEV_LOOP, DEV_START, steer !== null);
  // Pointing at either part freezes the scene with everything up on the screen.
  const now = t;
  const swung = ease(clamp((t - SWING_IN) / TURN_MS)) - ease(clamp((t - SWING_BACK) / TURN_MS));

  const booting = now >= BOOT_AT;
  const on = booting || now < POWER_OFF;
  const shown = LINES.filter(({ at }) => now >= at);
  const typed = clamp(now / TYPE_MS);
  const typing = !booting && now < TYPE_MS;
  const pressed = typing ? KEYSTROKES[Math.floor(now / KEY_MS)]! : null;
  const readout =
    steer === "computer"
      ? "your app under farm dev · the site, its agent, and its tools on one origin"
      : steer === "keyboard"
        ? "one command starts all of it · farm dev"
        : booting
          ? "booting · farm.js"
          : on
            ? shown.at(-1)!.readout
            : "farm dev · ready when you are";

  const front = BODY_Y[1];
  const sweep = lerp(CRT_Z[1], CRT_Z[0], ((now - BOOT_AT) % SCAN_MS) / SCAN_MS);
  const screen = booting ? (
    <>
      <Line
        className="iso-scan"
        lines={[
          [
            [CRT_X[0] + 0.02, front, sweep],
            [CRT_X[1] - 0.02, front, sweep],
          ],
        ]}
      />
      <FarmMark x={1.3} z={1.62} />
      <Print at={[1.32, front, 1.38]} size={4}>
        farm.js
      </Print>
    </>
  ) : on ? (
    <>
      {shown.map(({ text }, i) => (
        <Print at={[0.93, front, 1.96 - i * 0.2]} key={text} size={4.8}>
          {i === 0 ? text.slice(0, Math.max(2, Math.round(text.length * typed))) : text}
        </Print>
      ))}
    </>
  ) : null;

  return (
    <FigureFrame
      description="farm dev on a vintage computer: the screen boots to the Farm.js mark, the keyboard types farm dev, and the screen lists the Eve agent runtime, the MCP server at /api/mcp, and the site at localhost:3000, all on one origin."
      heading="One command, one origin."
      icon={SquareTerminal}
      index="03"
      label="farm dev"
      onKeyDown={() => {}}
      onRelease={() => setSteer(null)}
      readout={readout}
      rootRef={rootRef}
      summary="farm dev starts your app with its agent and its tools beside it, all served from the origin you already use."
      tag="Fig 3"
      view={DEV_VIEW}
    >
      <LensContext.Provider value={lens(blend(ISOMETRIC, DEV_FACE_ON, swung))}>
        {DESK}
        {/* Each keystroke runs down the cable into the computer. */}
        <g style={typing ? { strokeDashoffset: -((now % CORD_MS) / CORD_MS) * 12 } : undefined}>
          <Line className={typing ? "iso-cord iso-cord-live" : "iso-cord"} lines={[KEY_CABLE]} />
        </g>
        <g
          className="iso-lane"
          data-on={steer === "computer" || undefined}
          onPointerDown={() => setSteer("computer")}
          onPointerEnter={() => setSteer("computer")}
        >
          <Computer on={on} screen={screen} />
        </g>
        <g
          className="iso-lane"
          data-on={steer === "keyboard" || typing || undefined}
          onPointerDown={() => setSteer("keyboard")}
          onPointerEnter={() => setSteer("keyboard")}
        >
          <Keyboard pressed={pressed} />
        </g>
        {/* The mouse. */}
        <RoundBox r={0.12} x={[3.42, 3.8]} y={[2.88, 3.42]} z={[0, 0.12]}>
          <Line
            className="iso-tick"
            lines={[
              [
                [3.42, 3.08, 0.12],
                [3.8, 3.08, 0.12],
              ],
            ]}
          />
        </RoundBox>
      </LensContext.Provider>
    </FigureFrame>
  );
}

// ---------------------------------------------------------------------------
// Fig 4: discovery isn't permission. A pin lock stands for your authorize():
// one pin per MCP tool. The reader's key lifts the pins for list_projects and
// search_projects to the shear line and leaves create_project locked; the
// writer's key lifts all three. The tokens, subjects, and tools are the ones
// in the MCP example.

const TOOLS = [
  { name: "list_projects", route: "GET /api/projects", x: 1.35 },
  { name: "search_projects", route: "defineTool · read-only", x: 2.4 },
  { name: "create_project", route: "POST /api/projects", x: 3.45 },
] as const;
const KEYS = [
  {
    token: "demo-reader",
    subject: "demo-reader",
    cuts: [0.3, 0.3, 0.14],
    readout: "subject demo-reader · list_projects, search_projects · not create_project",
  },
  {
    token: "demo-token",
    subject: "demo-agent",
    cuts: [0.3, 0.3, 0.3],
    readout: "subject demo-agent · all three tools",
  },
] as const;
const HOUSING_X: Point2 = [0.6, 4.25];
const HOUSING_Y: Point2 = [0.5, 1.5];
const HOUSING_TOP = 0.9;
const SHEAR = HOUSING_TOP + 0.5;
const PIN_REST = 0.2;
const KEY_Y = center(HOUSING_Y);
const BLADE = 2.9;
const KEY_IN = HOUSING_X[1] - BLADE + 0.05;
// Pulled back far enough for every pin to drop, but still on the base.
const KEY_OUT = KEY_IN + 1.5;
// Each key: slide in, hold while the pins tell, slide out. Then rest.
const SLIDE_MS = 900;
const HOLD_MS = 2200;
const KEY_TURN = SLIDE_MS * 2 + HOLD_MS;
const LOCK_LOOP = KEY_TURN * KEYS.length + 1600;
const LOCK_VIEW: [number, number, number, number] = [-130, -64, 316, 236];
// Once a key is home, a request runs from the lock to each tool's tag in turn.
const ASK_AFTER = 250;
const ASK_EVERY = 320;
const ASK_MS = 650;
const SHAKE_MS = 450;
const askRoute = (x: number) =>
  onGround([
    [HOUSING_X[1] + 0.25, HOUSING_Y[1] + 0.05],
    [HOUSING_X[1] + 0.25, 2.25],
    [x, 2.25],
    [x, 1.95],
  ]);

/**
 * One key: a round bow and a blade cut to lift each pin. Only what's outside
 * the lock is drawn, from `visibleFrom` on.
 */
function Key({
  x,
  y,
  cuts,
  label,
  visibleFrom = -Infinity,
}: {
  x: number;
  y: number;
  cuts: readonly number[];
  label: string;
  visibleFrom?: number;
}) {
  const bladeFrom = Math.max(x, visibleFrom);
  return (
    <>
      {bladeFrom < x + BLADE && (
        <Box x={[bladeFrom, x + BLADE]} y={[y - 0.07, y + 0.07]} z={[0.3, 0.42]} />
      )}
      {TOOLS.map(({ x: pin }, i) => {
        const at = x + (pin - KEY_IN);
        if (at - 0.07 < visibleFrom) return null;
        return (
          <Box
            key={pin}
            x={[at - 0.07, at + 0.07]}
            y={[y - 0.05, y + 0.05]}
            z={[0.42, 0.42 + cuts[i]! * 0.4]}
          />
        );
      })}
      <RoundBox
        r={0.22}
        x={[x + BLADE, x + BLADE + 0.62]}
        y={[y - 0.26, y + 0.26]}
        z={[0.26, 0.46]}
      >
        <Dot at={[x + BLADE + 0.42, y, 0.46]} className="iso-detail-line" r={0.08} />
      </RoundBox>
      <Print at={[x + BLADE - 0.05, y + 0.26, 0.04]} size={3.4}>
        <tspan className="iso-print-dim">{label}</tspan>
      </Print>
    </>
  );
}

export function PermissionsFigure() {
  const rootRef = useRef<HTMLElement>(null);
  const [steer, setSteer] = useState<number | "lock" | null>(null);
  const t = useLoop(rootRef, LOCK_LOOP, 0, steer !== null);

  // Which key is in play, and how far into the lock it is.
  const turn = Math.min(KEYS.length, Math.floor(t / KEY_TURN));
  const local = t - turn * KEY_TURN;
  const resting = turn >= KEYS.length;
  const keyIndex = resting ? KEYS.length - 1 : turn;
  const depth = resting
    ? 0
    : local < SLIDE_MS
      ? ease(local / SLIDE_MS)
      : local < SLIDE_MS + HOLD_MS
        ? 1
        : 1 - ease((local - SLIDE_MS - HOLD_MS) / SLIDE_MS);
  const key = KEYS[keyIndex]!;
  const spare = KEYS[(keyIndex + 1) % KEYS.length]!;
  const keyX = lerp(KEY_OUT, KEY_IN, depth);
  const seated = depth > 0.98;
  // The pins ride up the blade's cuts as it goes home.
  const lifts = key.cuts.map((cut) => cut * ease(clamp((depth - 0.55) / 0.45)));
  // Once it's home, a request runs from the lock to each tool's tag in turn;
  // the tag answers when its request lands.
  const sinceAsked = (i: number) => local - SLIDE_MS - ASK_AFTER - i * ASK_EVERY;
  const asked = TOOLS.map((_, i) => (seated ? clamp(sinceAsked(i) / ASK_MS) : 0));
  const answered = TOOLS.map((_, i) => seated && asked[i]! >= 1);
  const open = TOOLS.map((_, i) => answered[i]! && key.cuts[i]! >= 0.3);
  const refused = TOOLS.map(
    (_, i) => answered[i]! && !open[i] && sinceAsked(i) - ASK_MS < SHAKE_MS,
  );
  const readout =
    typeof steer === "number"
      ? `${TOOLS[steer]!.name} · ${TOOLS[steer]!.route}`
      : steer === "lock"
        ? "authorize({ request, tools }) · returns the tools this caller may use"
        : resting
          ? "discovery never grants permission · authorize() decides per caller"
          : answered.every(Boolean)
            ? key.readout
            : `Bearer ${key.token} · authorize() checks the token`;

  return (
    <FigureFrame
      description="Discovery isn't permission: a pin lock stands for your authorize() function, one pin per MCP tool. The reader's token lifts the pins for list_projects and search_projects; create_project stays locked. The writer's token lifts all three."
      heading="Discovery isn't permission."
      icon={KeyRound}
      index="04"
      label="Permissions"
      onKeyDown={(event) => {
        const next = stepThrough(event, typeof steer === "number" ? steer : null, TOOLS.length);
        if (next !== undefined) setSteer(next);
      }}
      onRelease={() => setSteer(null)}
      readout={readout}
      rootRef={rootRef}
      summary="Every MCP call goes through your authorize(). A reader's token opens the read tools; only the writer's opens create_project."
      tag="Fig 4"
      view={LOCK_VIEW}
    >
      <>
        <Feet
          at={[
            [6.0, 0.05],
            [-0.1, 3.25],
            [6.0, 3.25],
          ]}
          z={[-0.4, -0.28]}
        />
        <RoundBox className="iso-base" r={0.4} x={[-0.4, 6.4]} y={[-0.3, 3.6]} z={[-0.28, 0]}>
          <Inset r={0.28} x={[-0.18, 6.18]} y={[-0.08, 3.38]} z={0} />
          <Screws at={corners([-0.1, 6.1], [0, 3.3])} z={0} />
        </RoundBox>
        <Print at={[0.1, 3.6, -0.19]} size={4.6}>
          <tspan className="iso-print-dim">/api/mcp</tspan>
        </Print>
        {/* The lock: housing, keyway, and the bridge that marks the shear line. */}
        <g
          className="iso-lane"
          data-on={steer === "lock" || undefined}
          onPointerDown={() => setSteer("lock")}
          onPointerEnter={() => setSteer("lock")}
        >
          <RoundBox r={0.12} x={HOUSING_X} y={HOUSING_Y} z={[0, HOUSING_TOP]}>
            <Inset
              r={0.08}
              x={[HOUSING_X[0] + 0.12, HOUSING_X[1] - 0.12]}
              y={[HOUSING_Y[0] + 0.12, HOUSING_Y[1] - 0.12]}
              z={HOUSING_TOP}
            />
          </RoundBox>
          <Poly
            className="iso-slot"
            corners={[
              [HOUSING_X[1], KEY_Y - 0.11, 0.27],
              [HOUSING_X[1], KEY_Y + 0.11, 0.27],
              [HOUSING_X[1], KEY_Y + 0.11, 0.55],
              [HOUSING_X[1], KEY_Y - 0.11, 0.55],
            ]}
          />
          <Print at={[HOUSING_X[0] + 0.2, HOUSING_Y[1], 0.64]} size={5}>
            authorize() <tspan className="iso-print-dim">your app decides</tspan>
          </Print>
        </g>
        {TOOLS.map(({ name, x }, i) => {
          const top = HOUSING_TOP + PIN_REST + lifts[i]!;
          return (
            <g className="iso-pin" data-open={open[i] || undefined} key={name}>
              <Box
                x={[x - 0.08, x + 0.08]}
                y={[KEY_Y - 0.08, KEY_Y + 0.08]}
                z={[HOUSING_TOP, top]}
              />
              <RoundBox
                r={0.07}
                x={[x - 0.1, x + 0.1]}
                y={[KEY_Y - 0.1, KEY_Y + 0.1]}
                z={[top, top + 0.06]}
              />
            </g>
          );
        })}
        <Box x={[0.92, 1.0]} y={[KEY_Y - 0.05, KEY_Y + 0.05]} z={[HOUSING_TOP, SHEAR + 0.18]} />
        <Box x={[3.8, 3.88]} y={[KEY_Y - 0.05, KEY_Y + 0.05]} z={[HOUSING_TOP, SHEAR + 0.18]} />
        <Box
          className="iso-shear"
          x={[0.92, 3.88]}
          y={[KEY_Y - 0.06, KEY_Y + 0.06]}
          z={[SHEAR + 0.18, SHEAR + 0.26]}
        />
        <Key
          cuts={key.cuts}
          label={`Bearer ${key.token}`}
          visibleFrom={HOUSING_X[1]}
          x={keyX}
          y={KEY_Y}
        />
        {/* One tag per tool, in front of its pin. */}
        {TOOLS.map(({ name, x }, i) => (
          <g
            className="iso-lane iso-tag"
            data-locked={(answered[i] && !open[i]) || undefined}
            data-refused={refused[i] || undefined}
            data-on={open[i] || steer === i || undefined}
            key={name}
            onPointerDown={() => setSteer(i)}
            onPointerEnter={() => setSteer(i)}
          >
            <Box x={[x - 0.5, x + 0.5]} y={[1.78, 1.84]} z={[0, 0.46]} />
            <Print at={[x - 0.44, 1.84, 0.27]} size={3.2}>
              {name}
            </Print>
            <Print at={[x - 0.44, 1.84, 0.1]} size={3}>
              <tspan className="iso-print-dim">
                {open[i] ? "allowed" : answered[i] ? "locked" : seated ? "checking" : "waiting"}
              </tspan>
            </Print>
          </g>
        ))}
        {/* Requests on their way to the tags. */}
        {TOOLS.map(({ name, x }, i) =>
          asked[i]! > 0 && asked[i]! < 1 ? (
            <Packet at={along(askRoute(x), ease(asked[i]!))} key={name} />
          ) : null,
        )}
        {/* The spare key lies on the base, waiting its turn. */}
        <g className="iso-spare">
          <Key cuts={spare.cuts} label={`Bearer ${spare.token}`} x={2.35} y={2.95} />
        </g>
      </>
    </FigureFrame>
  );
}
