"use client";

import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  along,
  Box,
  Callout,
  clamp,
  ease,
  Feet,
  Inset,
  ISO_LENS,
  lerp,
  Line,
  Packet,
  type Point2,
  type Point3,
  Print,
  RoundBox,
  useLoop,
} from "../iso/scene";

// The parts of a Farm mobile app, as the agents page draws its readiness stack:
// glass panes on four posts, on a base that stands for the phone. From the top:
// the native frame, the navigator, the screens, and the bridge. Your Farm app,
// the same server the web uses, stands off the phone at the end of a link. A
// tap travels down through each part to the server and back up to the frame;
// the part it is in rises, and a wire names it. Pointing at a part holds the
// scene and explains it; letting go resumes where it was.

const PANES = [
  {
    name: "bridge",
    tag: "__farmBridge",
    detail: "__farmBridge",
    playing: "__farmBridge · origin-scoped: navigation, server calls, modules",
    explain: "__farmBridge · origin-scoped calls between the page and the app",
  },
  {
    name: "screens",
    tag: "web · native · rn",
    detail: "web · native · react native",
    playing: "web screen · /notes opens in a WebView of your page",
    explain: "screens · a WebView of the page, native views, or page.native.tsx",
  },
  {
    name: "navigator",
    tag: "routes",
    detail: "farm-routes.json",
    playing: "navigator · farm-routes.json opens /notes as a web screen",
    explain: "navigator · picks web, native, or React Native for each route",
  },
  {
    name: "native frame",
    tag: "tabs · sheets",
    detail: "tabs · stack · sheets",
    playing: "tap · the Notes tab in the native frame",
    explain: "native frame · tabs, a stack per tab, sheets, and the back gesture",
  },
] as const;
const TOP = PANES.length - 1;
const SERVER = {
  playing: "your Farm app · renders /notes with your auth and data",
  explain: "your Farm app · the same server as the web: SSR, auth, data",
};
const DRAWN = "/notes · on screen inside the native frame, served by your Farm app";
const RESTING = "a tap travels from the native frame to your server and back";

const PANE_Z0 = 0.45;
const PANE_GAP = 0.42;
const PANE_THIN = 0.05;
const PANE_TOP = 0.14;
const paneZ = (i: number) => PANE_Z0 + i * PANE_GAP;
const paneThick = (i: number) => (i === TOP ? PANE_TOP : PANE_THIN);
const PANE: Point2 = [0.3, 3.7];
const POSTS: Point2[] = [
  [0.6, 0.6],
  [3.4, 0.6],
  [0.6, 3.4],
  [3.4, 3.4],
];
const FRONT_POST = POSTS[3]!;
const POST_W = 0.045;
// The part being visited rises a little; the panes above it clear the way.
const RAISE = 0.14;
const LIFT = 0.3;
const POST_TOP = paneZ(TOP) + PANE_TOP + LIFT + 0.36;
const BASE_Y: Point2 = [-0.9, 4.9];
// Your Farm app stands off the phone, to the right, at the end of a link.
const SERVER_X: Point2 = [6.4, 7.8];
const SERVER_Y: Point2 = [0.6, 2.0];
const SERVER_Z: Point2 = [0, 1.15];
const SERVER_DOOR: Point3 = [SERVER_X[0], 1.3, 0.04];
const LINK: Point3[] = [
  [FRONT_POST[0], FRONT_POST[1], 0.04],
  [5.3, FRONT_POST[1], 0.04],
  [5.3, SERVER_DOOR[1], 0.04],
  SERVER_DOOR,
];

// The tap's stops, top down and back up. Pane stops are the pane's index.
type Stop = number | "server" | "drawn";
const STOPS: Stop[] = [TOP, 2, 1, 0, "server", "drawn"];
const STEP_MS = 1300;
const MOVE_MS = 520;
const WIRE_MS = 600;
const REST_MS = 1700;
const LOOP_MS = STOPS.length * STEP_MS + REST_MS;
// Server and first client render: the scene at rest, the tap already answered.
const REST_T = LOOP_MS - 1;

const VIEW: [number, number, number, number] = [-178, -96, 380, 268];
const GUTTER = 104;
// Which side each pane's label wires out to; the frame's turns in over the stack.
const PANE_WIRES: { side: -1 | 1; rise: number; turnIn?: boolean }[] = [
  { side: -1, rise: 16 },
  { side: 1, rise: 14 },
  { side: -1, rise: 16 },
  { side: 1, rise: 22, turnIn: true },
];

const paneOf = (stop: Stop | null) =>
  typeof stop === "number" ? stop : stop === "drawn" ? TOP : null;
const liftsFor = (pane: number | null) =>
  PANES.map((_, i) => (pane === null || i < pane ? 0 : i === pane ? RAISE : LIFT));

function frame(t: number) {
  const index = Math.floor(t / STEP_MS);
  const stop: Stop | null = index < STOPS.length ? STOPS[index]! : null;
  const into = t - index * STEP_MS;
  const previous: Stop | null = index > 0 && index <= STOPS.length ? STOPS[index - 1]! : null;
  // After the last stop the same ease settles the lifted pane back down.
  const move = ease(clamp(into / MOVE_MS));
  const from = liftsFor(paneOf(previous));
  const to = liftsFor(paneOf(stop));
  const lifts = to.map((value, i) => lerp(from[i]!, value, move));
  const bottoms = PANES.map((_, i) => paneZ(i) + lifts[i]!);
  const tops = bottoms.map((bottom, i) => bottom + paneThick(i));
  const onPost = (pane: number): Point3 => [...FRONT_POST, tops[pane]!];
  const placeOf = (at: Stop | null): Point3 =>
    at === "server" ? SERVER_DOOR : onPost(paneOf(at) ?? TOP);
  // Between the bridge and the server the tap runs down the post and along the link.
  let packet: Point3;
  if (stop === "server" && previous === 0) {
    packet = along([onPost(0), ...LINK], move);
  } else if (previous === "server") {
    packet = along([...LINK].reverse().concat([onPost(TOP)]), move);
  } else {
    const a = placeOf(previous ?? TOP);
    const b = placeOf(stop);
    packet = a.map((value, axis) => lerp(value, b[axis]!, move)) as Point3;
  }
  return {
    stop,
    tops,
    bottoms,
    packet,
    wire: stop === null ? 0 : ease(clamp(into / WIRE_MS)),
  };
}

/** The top pane: the screen area and a tab bar with the Notes tab. */
function FramePane({ top, lit }: { top: number; lit: boolean }) {
  return (
    <>
      <Inset r={0.1} x={[0.65, 3.35]} y={[0.65, 2.3]} z={top} />
      {["notes", "settings"].map((tab, i) => (
        <RoundBox
          className={lit && i === 0 ? "iso-tool iso-tool-on" : "iso-tool"}
          key={tab}
          r={0.08}
          x={[0.75 + i * 1.3, 1.95 + i * 1.3]}
          y={[2.45, 2.83]}
          z={[top, top + 0.04]}
        >
          <Print at={[0.92 + i * 1.3, 2.71, top + 0.04]} face="top" size={3.8}>
            {tab}
          </Print>
        </RoundBox>
      ))}
    </>
  );
}

function PaneCallout({ pane, top, drawn }: { pane: number; top: number; drawn: number }) {
  const { name, detail } = PANES[pane]!;
  const { side, rise, turnIn } = PANE_WIRES[pane]!;
  const [x0, y0] = side < 0 ? [PANE[0] + 0.12, PANE[1] - 0.08] : [PANE[1] - 0.08, PANE[0] + 0.12];
  const [ax, ay] = ISO_LENS.at(x0, y0, top);
  const gutter = side * (turnIn ? GUTTER - 30 : GUTTER);
  const turn = side * 8;
  return (
    <Callout
      align={side < 0 ? "end" : "start"}
      detail={[detail]}
      drawn={drawn}
      label={name}
      route={[
        [ax, ay],
        [gutter, ay],
        [gutter, ay - rise],
        [gutter + turn, ay - rise],
      ]}
    />
  );
}

const BASE = (
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
      <tspan className="iso-print-dim">com.example.notes</tspan>
    </Print>
  </>
);

export function MobilePartsFigure() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [steer, setSteer] = useState<Stop | null>(null);
  const t = useLoop(rootRef, LOOP_MS, REST_T, steer !== null);
  // As the landing's benchmark figures do, the server sends the empty frame (which keeps its
  // size, from the viewBox) and the drawing arrives with hydration, so the homepage HTML does
  // not carry the scene's polygon points.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { stop, tops, bottoms, packet, wire } = frame(t);
  const pointed = steer ?? stop;
  const readout =
    steer === "server"
      ? SERVER.explain
      : typeof steer === "number"
        ? PANES[steer]!.explain
        : stop === "server"
          ? SERVER.playing
          : stop === "drawn"
            ? DRAWN
            : typeof stop === "number"
              ? PANES[stop]!.playing
              : RESTING;
  const lit = (pane: number) => paneOf(pointed) === pane || undefined;
  const hold = (at: Stop | null) => setSteer(at);
  const onKeyDown = (event: KeyboardEvent) => {
    const order: Stop[] = [TOP, 2, 1, 0, "server"];
    const back = event.key === "ArrowUp" || event.key === "ArrowLeft";
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    if (!back && !forward) return;
    event.preventDefault();
    const position = steer === null ? -1 : order.indexOf(steer);
    const next = position + (forward ? 1 : -1);
    hold(
      position === -1
        ? order[forward ? 0 : order.length - 1]!
        : next < 0 || next >= order.length
          ? null
          : order[next]!,
    );
  };
  const post = ([x, y]: Point2, from: number, to: number) => (
    <Box
      key={`${x}-${y}`}
      x={[x - POST_W, x + POST_W]}
      y={[y - POST_W, y + POST_W]}
      z={[from, to]}
    />
  );
  const wired = pointed === "drawn" ? TOP : pointed;
  const wiredDrawn = steer !== null ? 1 : wire;

  return (
    <div
      aria-label="The parts of a Farm mobile app: on the phone, a native frame with tabs, a navigator that picks each route's screen, the screens, and the __farmBridge; off the phone, your Farm app. A tap travels down through each part to the server and back. Point at a part, or use the arrow keys, to see what it does."
      className="iso-scene relative flex h-full w-full flex-col outline-none"
      onBlur={() => hold(null)}
      onKeyDown={onKeyDown}
      ref={rootRef}
      role="img"
      tabIndex={0}
    >
      <svg
        aria-hidden
        className="block h-auto w-full overflow-visible"
        onPointerLeave={(event) => {
          // A touch pointer leaves as soon as the finger lifts; keep what it tapped.
          if (event.pointerType !== "touch") hold(null);
        }}
        viewBox={VIEW.join(" ")}
      >
        {mounted ? (
          <>
            {BASE}
            {/* The link to your Farm app runs off the phone along the ground. */}
            <Line className="iso-ghost" lines={[LINK]} />
            <g
              className="iso-lane"
              data-on={pointed === "server" || undefined}
              onPointerDown={() => hold("server")}
              onPointerEnter={() => hold("server")}
            >
              <RoundBox r={0.12} x={SERVER_X} y={SERVER_Y} z={SERVER_Z}>
                <Print
                  at={[SERVER_X[0] + 0.2, SERVER_Y[1] - 0.25, SERVER_Z[1]]}
                  face="top"
                  size={4.4}
                >
                  your Farm app
                </Print>
              </RoundBox>
              <Print at={[SERVER_X[0] + 0.15, SERVER_Y[1], 0.45]} size={4}>
                <tspan className="iso-print-dim">your-app.com</tspan>
              </Print>
            </g>
            {PANES.map(({ name, tag }, i) => (
              <g key={name}>
                {POSTS.map((at) => post(at, i === 0 ? 0 : tops[i - 1]!, bottoms[i]!))}
                <g
                  className={i === TOP ? "iso-lane iso-pane iso-pane-solid" : "iso-lane iso-pane"}
                  data-on={lit(i)}
                  onPointerDown={() => hold(i)}
                  onPointerEnter={() => hold(i)}
                >
                  <RoundBox r={0.07} x={PANE} y={PANE} z={[bottoms[i]!, tops[i]!]}>
                    {i === TOP && <FramePane lit={Boolean(lit(TOP))} top={tops[i]!} />}
                    <Print at={[0.8, 3.5, tops[i]!]} face="top" size={4.4}>
                      {name} <tspan className="iso-print-dim">{tag}</tspan>
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
            <Packet at={packet} />
            {typeof wired === "number" && (
              <PaneCallout drawn={wiredDrawn} key={wired} pane={wired} top={tops[wired]!} />
            )}
            {wired === "server" && (
              <Callout
                detail={["ssr · auth · data"]}
                drawn={wiredDrawn}
                label="your Farm app"
                align="end"
                route={(([x, y]) => [
                  [x, y],
                  [x, 24],
                  [x - 8, 24],
                ])(ISO_LENS.at(SERVER_X[0] + 0.25, SERVER_Y[0] + 0.25, SERVER_Z[1]))}
              />
            )}
          </>
        ) : null}
      </svg>
      <div
        aria-hidden
        className="mt-3 flex min-h-[2.6em] items-start justify-between gap-4 font-mono text-[10px] uppercase leading-[1.3] tracking-normal"
      >
        <span className="shrink-0 text-white/34">Point at a part</span>
        <span className="text-right normal-case text-white/62">{readout}</span>
      </div>
    </div>
  );
}
