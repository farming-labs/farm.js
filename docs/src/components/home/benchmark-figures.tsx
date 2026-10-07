"use client";

import { type PointerEvent, type ReactNode, type RefObject, useRef, useState } from "react";
import { benchmarkReport, formatBenchmarkDuration } from "../../lib/framework-benchmark";
import {
  Callout,
  type Camera,
  Inset,
  type Lens,
  LensContext,
  Line,
  Panel,
  Poly,
  type Point2,
  type Point3,
  RoundBox,
  clamp,
  fixed,
  lens,
  prefersStill,
  useFrames,
} from "../iso/scene";

// The benchmark panels as hairline drawings: one projection, one stroke
// weight, rounded solids with a single dim crease, nothing filled and nothing
// glowing. Whatever matters right now gets the one bright edge, every motion
// is a spring, and the words stay in the corners, outside the drawing.

type Framework = (typeof benchmarkReport.frameworks)[number];

const FARM: Framework = benchmarkReport.frameworks.find((framework) => framework.id === "farm")!;
const RIVALS = benchmarkReport.frameworks.filter((framework) => framework.id !== "farm");

// The title's rotation (benchmark-comparison-cycle in globals.css), as
// fractions of its whole cycle: a rival's name has landed 4% into its turn and
// starts to leave at 22%.
const CYCLE_MS = 12000;
const NAME_IN = 0.04;
const NAME_OUT = 0.22;

type Turn = { rival: number; at: number; cycle: number };

/**
 * Which rival the panel's title names, and how far into that rival's turn it
 * is. The title rotates on a CSS animation; reading that animation's clock
 * keeps the drawing in step with it, even after the panel was off screen.
 */
function readTurn(root: HTMLElement | null, now: number): Turn {
  const name = root?.closest("article")?.querySelector(".benchmark-comparison-item");
  const animation = name?.getAnimations()[0];
  const timing = animation?.effect?.getTiming();
  const cycle = Number(timing?.duration) || CYCLE_MS;
  const elapsed =
    animation?.currentTime == null
      ? now
      : Number(animation.currentTime) - Number(timing?.delay ?? 0);
  const into = ((elapsed % cycle) + cycle) % cycle;
  const length = cycle / RIVALS.length;
  return { rival: Math.floor(into / length) % RIVALS.length, at: into % length, cycle };
}

type Spring = { x: number; v: number };
const spring = (x = 0): Spring => ({ x, v: 0 });

/** One step of a slightly underdamped spring toward `to`, `dt` seconds long. */
function pull(value: Spring, to: number, dt: number, stiffness = 170, damping = 22) {
  value.v += (stiffness * (to - value.x) - damping * value.v) * dt;
  value.x += value.v * dt;
}

/** Eases a 0 to 1 amount in and out. */
const smooth = (amount: number) => amount * amount * (3 - 2 * amount);

/**
 * Steps a drawing every frame while it is on screen. `step` gets the title's
 * turn and the seconds since the last frame, moves its springs, and returns
 * what to draw. Under reduced motion it draws `still` once and stops.
 */
function useDrawing<T>(
  rootRef: RefObject<HTMLElement | null>,
  initial: T,
  still: () => T,
  step: (turn: Turn, dt: number) => T,
) {
  const [state, setState] = useState(initial);
  const lastRef = useRef<number | null>(null);
  useFrames(rootRef, (now) => {
    if (prefersStill()) {
      setState(still());
      return false;
    }
    const dt = Math.min(1 / 30, lastRef.current === null ? 0 : (now - lastRef.current) / 1000);
    lastRef.current = now;
    setState(step(readTurn(rootRef.current, now), dt));
    return true;
  });
  return state;
}

/** Where the pointer is in the drawing's own units, or null once it leaves. */
function usePointer() {
  const [pointer, setPointer] = useState<Point2 | null>(null);
  const handlers = {
    onPointerMove(event: PointerEvent<SVGSVGElement>) {
      const matrix = event.currentTarget.getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      setPointer([point.x, point.y]);
    },
    onPointerLeave(event: PointerEvent<SVGSVGElement>) {
      // A touch pointer leaves as soon as the finger lifts; keep what it tapped.
      if (event.pointerType !== "touch") setPointer(null);
    },
  };
  return [pointer, handlers] as const;
}

const CAMERA: Camera = { yaw: Math.PI / 4, pitch: Math.PI / 6, scale: 1.25, shift: [0, 0] };
const LENS = lens(CAMERA);

function Stage({
  rootRef,
  view,
  hint,
  readout,
  pointer,
  camera = LENS,
  children,
}: {
  rootRef: RefObject<HTMLDivElement>;
  view: [number, number, number, number];
  camera?: Lens;
  hint: string;
  readout: string;
  pointer: ReturnType<typeof usePointer>[1];
  children: ReactNode;
}) {
  return (
    <div
      className="benchmark-illustration benchmark-hairline relative mt-4 flex h-64 flex-col sm:h-72"
      ref={rootRef}
    >
      <svg aria-hidden className="min-h-0 w-full flex-1" viewBox={view.join(" ")} {...pointer}>
        <LensContext.Provider value={camera}>{children}</LensContext.Provider>
      </svg>
      <div
        aria-hidden
        className="flex items-center justify-between gap-4 pt-2 font-mono text-[10px] uppercase tracking-normal"
      >
        <span className="text-white/34">{hint}</span>
        <span className="text-right normal-case text-white/62 tabular-nums">{readout}</span>
      </div>
    </div>
  );
}

/** A flat disc, its side band and its top: a platter, a hub, a base, a pan. */
function Disc({
  r,
  z: [z0, z1],
  at: [x, y] = [0, 0],
  camera = LENS,
}: {
  r: number;
  z: Point2;
  at?: Point2;
  camera?: Lens;
}) {
  const [cx, top] = camera.at(x, y, z1);
  const [rx, ry] = [r * camera.flat[0], r * camera.flat[1]];
  const bottom = top + (z1 - z0) * camera.axes.down[1] * 30;
  const [left, right] = [fixed(cx - rx), fixed(cx + rx)];
  const radii = `${fixed(rx)} ${fixed(ry)}`;
  return (
    <>
      <path
        d={`M${left},${fixed(top)}L${left},${fixed(bottom)}A${radii} 0 0 0 ${right},${fixed(bottom)}L${right},${fixed(top)}A${radii} 0 0 1 ${left},${fixed(top)}Z`}
      />
      <ellipse cx={fixed(cx)} cy={fixed(top)} rx={fixed(rx)} ry={fixed(ry)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Startup: a stopwatch. Every framework has a mark on the dial at the time its
// first page rendered; the hand goes round once while the title names a rival,
// and each mark rises as the hand passes it, as tall as its time: the lower,
// the faster. Farm's is first, a few degrees in, and the shortest.

const STARTUP = "devFirstPageMs";
const SLOWEST_START = Math.max(...RIVALS.map((framework) => framework.metrics[STARTUP].median));
/** Measured milliseconds for one turn of the dial. */
const DIAL_SPAN = Math.ceil((SLOWEST_START * 1.12) / 100) * 100;
/** How long the hand takes to go round, as a fraction of the title's cycle. */
const SWEEP = 0.13;
const PLATTER_R = 3.1;
const PLATTER_TOP = 0.28;
/** The dial starts at the back, the top of the drawing, and runs clockwise. */
const DIAL_START = (5 * Math.PI) / 4;
const MARK_R = 2.12;
const MARK_SIZE = 0.25;
const MARK_LOW = 0.1;
/** The height a mark rises to for the slowest time; others rise in proportion. */
const MARK_TALLEST = 1.1;
const HAND_R = 2.45;
const DIAL_VIEW: [number, number, number, number] = [-238, -100, 476, 186];
/** Where the labels sit, either side of the dial, and how far apart at least. */
const DIAL_LABEL_X = 150;
const DIAL_EDGE_X = 132;
const LABEL_GAP = 17;

const onDial = (fraction: number, radius: number): Point2 => {
  const angle = DIAL_START + fraction * Math.PI * 2;
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
};

const DIAL_MARKS = [FARM, ...RIVALS].map((framework, i, all) => {
  const fraction = framework.metrics[STARTUP].median / DIAL_SPAN;
  // A mark that would touch an earlier one moves a ring further in.
  const crowded = all
    .slice(0, i)
    .some(
      (other) =>
        Math.abs(other.metrics[STARTUP].median / DIAL_SPAN - fraction) * Math.PI * 2 * MARK_R <
        MARK_SIZE * 2.6,
    );
  return {
    framework,
    fraction,
    at: onDial(fraction, crowded ? MARK_R - 0.7 : MARK_R),
    high: MARK_LOW + 0.08 + (MARK_TALLEST * framework.metrics[STARTUP].median) / SLOWEST_START,
  };
});

/** How far up a mark is, from resting to its full height. */
const markTop = (high: number, lift: number) => PLATTER_TOP + MARK_LOW + (high - MARK_LOW) * lift;

/**
 * Each mark's label: on the side of the dial the mark is on, at the mark's
 * height where there is room, pushed down past the label above where not.
 */
const DIAL_LABELS = (() => {
  const placed = DIAL_MARKS.map((mark, index) => {
    const [x, y] = LENS.at(...mark.at, markTop(mark.high, 1));
    return { index, side: x < 0 ? -1 : 1, y };
  });
  for (const side of [-1, 1]) {
    let floor = -Infinity;
    for (const label of placed.filter((each) => each.side === side).sort((a, b) => a.y - b.y)) {
      label.y = Math.max(label.y, floor + LABEL_GAP);
      floor = label.y;
    }
  }
  return placed;
})();

/** How far round the dial a point on screen is, from 0 at the start to 1. */
function dialFraction([sx, sy]: Point2) {
  const [cx, cy] = LENS.at(0, 0, PLATTER_TOP);
  const u = (sx - cx) / LENS.flat[0];
  const v = (sy - cy) / LENS.flat[1];
  const { yaw } = CAMERA;
  const x = u * Math.cos(yaw) + v * Math.sin(yaw);
  const y = -u * Math.sin(yaw) + v * Math.cos(yaw);
  const turns = (Math.atan2(y, x) - DIAL_START) / (Math.PI * 2);
  return ((turns % 1) + 1) % 1;
}

/** The hand: a flat blade with round ends, from just behind the hub out toward the rim. */
function Hand({ fraction }: { fraction: number }) {
  const angle = DIAL_START + fraction * Math.PI * 2;
  const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
  const [nx, ny] = [-dy, dx];
  const width = 0.09;
  const z = PLATTER_TOP + 0.004;
  const cap = (along: number, from: number) =>
    Array.from({ length: 7 }, (_, step): Point3 => {
      const a = from + (Math.PI * step) / 6;
      return [
        dx * along + (dx * Math.cos(a) + nx * Math.sin(a)) * width,
        dy * along + (dy * Math.cos(a) + ny * Math.sin(a)) * width,
        z,
      ];
    });
  return (
    <polygon
      className="hl-hand"
      points={LENS.points([...cap(HAND_R, -Math.PI / 2), ...cap(-0.35, Math.PI / 2)])}
    />
  );
}

type DialState = { hand: number; lift: number[]; rival: number; sweeping: boolean };

export function StartupFigure() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pointer, handlers] = usePointer();
  const pointed = pointer && dialFraction(pointer);
  const springs = useRef({ hand: spring(), lift: DIAL_MARKS.map(() => spring()) });
  const state = useDrawing<DialState>(
    rootRef,
    { hand: 0, lift: DIAL_MARKS.map(() => 0), rival: 0, sweeping: false },
    () => ({ hand: 0, lift: DIAL_MARKS.map(() => 1), rival: 0, sweeping: false }),
    (turn, dt) => {
      const { hand, lift } = springs.current;
      const into = (turn.at - NAME_IN * turn.cycle) / (SWEEP * turn.cycle);
      // On its own the hand runs round once per name; pointed at, it follows the pointer.
      let target = pointed ?? smooth(clamp(into));
      target += Math.round(hand.x - target);
      if (pointed === null) pull(hand, target, dt, 260, 32);
      else pull(hand, target, dt, 110, 21);
      const shown = ((hand.x % 1) + 1) % 1;
      // How far the hand has been: nowhere before it sets off, all the way
      // round once it is back at the top.
      const reached = pointed !== null ? shown : into <= 0 ? 0 : into >= 1 ? 1 : shown;
      const settled = pointed === null && turn.at > NAME_OUT * turn.cycle;
      DIAL_MARKS.forEach(({ fraction }, i) => {
        pull(lift[i]!, !settled && reached >= fraction ? 1 : 0, dt, 90, 19);
      });
      return {
        hand: shown,
        lift: lift.map((value) => value.x),
        rival: turn.rival,
        sweeping: into > 0 && into < 1,
      };
    },
  );

  const rival = RIVALS[state.rival]!;
  const nearest =
    pointed === null
      ? null
      : DIAL_MARKS.reduce((best, mark) =>
          Math.abs(mark.fraction - state.hand) < Math.abs(best.fraction - state.hand) ? mark : best,
        );
  const near = nearest && Math.abs(nearest.fraction - state.hand) < 0.035 ? nearest : null;
  const time = (framework: Framework) => formatBenchmarkDuration(framework.metrics[STARTUP].median);
  const readout = near
    ? `${near.framework.label} · ${time(near.framework)}`
    : pointed !== null || state.sweeping
      ? `t ${formatBenchmarkDuration(state.hand * DIAL_SPAN)}`
      : `Farm.js ${time(FARM)} · ${rival.label} ${time(rival)}`;
  const marks = DIAL_MARKS.map((mark, i) => ({ ...mark, lift: state.lift[i]! })).sort(
    (a, b) => LENS.depth(...a.at) - LENS.depth(...b.at),
  );

  return (
    <Stage
      hint="Point at the dial"
      pointer={handlers}
      readout={readout}
      rootRef={rootRef}
      view={DIAL_VIEW}
    >
      <Disc r={PLATTER_R + 0.28} z={[-0.2, 0]} />
      <Disc r={PLATTER_R} z={[0, PLATTER_TOP]} />
      <Line
        className="hl-crease"
        lines={[
          Array.from(
            { length: 73 },
            (_, step): Point3 => [...onDial(step / 72, PLATTER_R - 0.16), PLATTER_TOP],
          ),
        ]}
      />
      <Line
        className="hl-tick"
        lines={Array.from({ length: 52 }, (_, step): Point3[] => [
          [...onDial(step / 52, PLATTER_R - 0.32), PLATTER_TOP],
          [...onDial(step / 52, PLATTER_R - (step % 13 === 0 ? 0.62 : 0.46)), PLATTER_TOP],
        ])}
      />
      <Hand fraction={state.hand} />
      <Disc r={0.26} z={[PLATTER_TOP, PLATTER_TOP + 0.12]} />
      {marks.map(({ framework, at: [x, y], high, lift }) => {
        const top = markTop(high, lift);
        const hot =
          near?.framework === framework ||
          (pointed === null && lift > 0.5 && (framework === FARM || framework === rival));
        return (
          <g data-hot={hot || undefined} key={framework.id}>
            <RoundBox
              r={0.12}
              x={[x - MARK_SIZE, x + MARK_SIZE]}
              y={[y - MARK_SIZE, y + MARK_SIZE]}
              z={[PLATTER_TOP, top]}
            >
              <Inset
                r={0.08}
                x={[x - MARK_SIZE + 0.08, x + MARK_SIZE - 0.08]}
                y={[y - MARK_SIZE + 0.08, y + MARK_SIZE - 0.08]}
                z={top}
              />
              {framework === FARM && (
                // Farm's mark carries the logo's three bars.
                <Line
                  className="hl-sign"
                  lines={[-0.07, 0, 0.07].map((dy, row): Point3[] => [
                    [x - 0.09, y + dy, top],
                    [x + (row === 1 ? 0.09 : 0.02), y + dy, top],
                  ])}
                />
              )}
            </RoundBox>
          </g>
        );
      })}
      {DIAL_LABELS.map(({ index, side, y: labelY }) => {
        const { framework, at, fraction, high } = DIAL_MARKS[index]!;
        const lift = state.lift[index]!;
        const top = markTop(high, lift);
        const [ax, ay] = LENS.at(...at, top);
        const hot =
          near?.framework === framework ||
          (pointed === null && (framework === FARM || framework === rival));
        // Pointed at, a mark keeps its label while the hand is past it. The
        // wire lands while the mark is still rising, so slow marks get read too.
        const drawn = pointed === null ? lift / 0.6 : state.hand >= fraction ? 1 : 0;
        return (
          <g data-hot={hot || undefined} key={framework.id}>
            <Callout
              align={side < 0 ? "end" : "start"}
              drawn={clamp(drawn)}
              label={`${framework.label}  ${time(framework)}`}
              route={[
                [ax, ay],
                [side * DIAL_EDGE_X, labelY],
                [side * DIAL_LABEL_X, labelY],
              ]}
            />
          </g>
        );
      })}
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// Build: a column per framework on one plinth. They all start rising together
// at the same speed and each stops at its measured build time, so the height
// is the time: the lower, the faster. Each column is stacked from one-second
// blocks, and its time is wired out to a label when it stops.

const BUILD = "buildMs";
const BUILDERS = [FARM, ...RIVALS].sort(
  (a, b) => b.metrics[BUILD].median - a.metrics[BUILD].median,
);
const SLOWEST_BUILD = BUILDERS[0]!.metrics[BUILD].median;
/** The slowest column's height; every column is in proportion to its time. */
const COLUMN_TALLEST = 2.3;
/** The column for a second of build time, so the blocks read as seconds. */
const PER_SECOND = (COLUMN_TALLEST * 1000) / SLOWEST_BUILD;
const COLUMN_HALF = 0.34;
const COLUMN_STEP = 1.12;
const COLUMN_FLOOR = 0.06;
/** How long the slowest column takes to finish, as a fraction of the title's cycle. */
const CLIMB = 0.13;
const BUILD_VIEW: [number, number, number, number] = [-112, -126, 340, 196];
const BUILD_LABEL_X = 128;

/** Tallest at the back, so no column hides a shorter one behind it. */
const COLUMNS = BUILDERS.map((framework, i) => ({
  framework,
  x: (i - (BUILDERS.length - 1) / 2) * COLUMN_STEP,
  full: (COLUMN_TALLEST * framework.metrics[BUILD].median) / SLOWEST_BUILD,
}));

/** Each column's label, at its top when it has stopped, kept clear of the label above. */
const COLUMN_LABELS = (() => {
  let floor = -Infinity;
  return COLUMNS.map(({ x, full }) => {
    const y = Math.max(LENS.at(x, 0, full)[1], floor + LABEL_GAP);
    floor = y;
    return y;
  });
})();

/** A rounded column from the plinth up to `top`, one block per second of build. */
function Column({ x, top, farm }: { x: number; top: number; farm: boolean }) {
  const cuts = [];
  for (let z = 0; z < top; z += PER_SECOND) cuts.push([z, Math.min(top, z + PER_SECOND)] as Point2);
  return (
    <>
      {cuts.map(([z0, z1]) => (
        <RoundBox
          key={z0}
          r={0.12}
          x={[x - COLUMN_HALF, x + COLUMN_HALF]}
          y={[-COLUMN_HALF, COLUMN_HALF]}
          z={[z0, z1]}
        />
      ))}
      <Inset
        r={0.08}
        x={[x - COLUMN_HALF + 0.09, x + COLUMN_HALF - 0.09]}
        y={[-COLUMN_HALF + 0.09, COLUMN_HALF - 0.09]}
        z={top}
      />
      {farm && (
        // Farm's column carries the logo's three bars.
        <Line
          className="hl-sign"
          lines={[-0.09, 0, 0.09].map((dy, row): Point3[] => [
            [x - 0.12, dy, top],
            [x + (row === 1 ? 0.12 : 0.03), dy, top],
          ])}
        />
      )}
    </>
  );
}

type ColumnState = { height: number[]; rival: number; elapsed: number; at: number };

export function BuildFigure() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pointer, handlers] = usePointer();
  const springs = useRef({ height: COLUMNS.map(() => spring(COLUMN_FLOOR)) });
  // The column under the pointer, by fixed bands, so a rising column can't
  // slide out from under it.
  const picked =
    pointer === null
      ? null
      : COLUMNS.reduce(
          (best, { x }, i) =>
            Math.abs(LENS.at(x, 0, 0)[0] - pointer[0]) <
            Math.abs(LENS.at(COLUMNS[best]!.x, 0, 0)[0] - pointer[0])
              ? i
              : best,
          0,
        );
  const state = useDrawing<ColumnState>(
    rootRef,
    { height: COLUMNS.map(() => COLUMN_FLOOR), rival: 0, elapsed: 0, at: 0 },
    () => ({
      height: COLUMNS.map(({ full }) => full),
      rival: 0,
      elapsed: SLOWEST_BUILD,
      at: NAME_OUT * CYCLE_MS,
    }),
    (turn, dt) => {
      const { height } = springs.current;
      const into = clamp((turn.at - NAME_IN * turn.cycle) / (CLIMB * turn.cycle));
      const elapsed = into * SLOWEST_BUILD;
      const settled = pointer === null && turn.at > NAME_OUT * turn.cycle;
      COLUMNS.forEach(({ framework }, i) => {
        const time = Math.min(elapsed, framework.metrics[BUILD].median);
        const target = settled ? COLUMN_FLOOR : Math.max(COLUMN_FLOOR, time * (PER_SECOND / 1000));
        pull(height[i]!, target, dt, 120, 22);
      });
      return {
        height: height.map((value) => value.x),
        rival: turn.rival,
        elapsed,
        at: turn.at,
      };
    },
  );

  const rival = RIVALS[state.rival]!;
  const time = (framework: Framework) => formatBenchmarkDuration(framework.metrics[BUILD].median);
  const settled = state.at > NAME_OUT * CYCLE_MS;
  const racing = state.elapsed > 0 && state.elapsed < SLOWEST_BUILD;
  const readout =
    picked !== null
      ? `${COLUMNS[picked]!.framework.label} · ${time(COLUMNS[picked]!.framework)}`
      : racing
        ? `t ${formatBenchmarkDuration(state.elapsed)}`
        : `Farm.js ${time(FARM)} · ${rival.label} ${time(rival)}`;

  return (
    <Stage
      hint="Point at a column"
      pointer={handlers}
      readout={readout}
      rootRef={rootRef}
      view={BUILD_VIEW}
    >
      <RoundBox r={0.4} x={[-3.05, 3.05]} y={[-0.85, 0.85]} z={[-0.26, 0]}>
        <Inset r={0.28} x={[-2.88, 2.88]} y={[-0.68, 0.68]} z={0} />
      </RoundBox>
      {COLUMNS.map(({ framework, x }, i) => {
        const hot =
          picked === i || (picked === null && (framework === FARM || framework === rival));
        return (
          <g data-hot={hot || undefined} key={framework.id}>
            <Column farm={framework === FARM} top={state.height[i]!} x={x} />
          </g>
        );
      })}
      {COLUMNS.map(({ framework, x, full }, i) => {
        const height = state.height[i]!;
        const done = state.elapsed >= framework.metrics[BUILD].median && !settled;
        const [ax, ay] = LENS.at(x, 0, height);
        const hot =
          picked === i || (picked === null && (framework === FARM || framework === rival));
        return (
          <g data-hot={hot || undefined} key={framework.id}>
            <Callout
              drawn={done || picked !== null ? clamp(height / full / 0.92) : 0}
              label={`${framework.label}  ${time(framework)}`}
              route={[
                [ax, ay],
                [ax + 10, COLUMN_LABELS[i]!],
                [BUILD_LABEL_X, COLUMN_LABELS[i]!],
              ]}
            />
          </g>
        );
      })}
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// Production boot: a rack with a server per framework. Every server's boot bar
// grows at the same speed from the same moment and stops when that server
// answered its first request, so the shorter the bar, the faster the boot.
// A server's power light comes on when it is up.

const BOOT = "productionBootMs";
const BOOTERS = [FARM, ...RIVALS].sort((a, b) => a.metrics[BOOT].median - b.metrics[BOOT].median);
const SLOWEST_BOOT = BOOTERS.at(-1)!.metrics[BOOT].median;
const UNIT_X: Point2 = [-1.6, 1.6];
const UNIT_Y: Point2 = [-0.7, 0.7];
const UNIT_H = 0.5;
const UNIT_GAP = 0.1;
const BAR_X = -1.08;
const BAR_LONGEST = 2.45;
const RACK_VIEW: [number, number, number, number] = [-74, -136, 262, 190];
const RACK_LABEL_X = 84;
/** The top server first, fastest at the top. */
const unitFloor = (row: number) => 0.08 + (BOOTERS.length - 1 - row) * (UNIT_H + UNIT_GAP);
const RACK_LABELS = (() => {
  let floor = -Infinity;
  return BOOTERS.map((framework, row) => {
    const end = BAR_X + (BAR_LONGEST * framework.metrics[BOOT].median) / SLOWEST_BOOT;
    const y = Math.max(LENS.at(end, UNIT_Y[1], unitFloor(row) + UNIT_H / 2)[1], floor + LABEL_GAP);
    floor = y;
    return y;
  });
})();

type RackState = { bar: number[]; rival: number; elapsed: number; at: number };

export function BootFigure() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pointer, handlers] = usePointer();
  const springs = useRef({ bar: BOOTERS.map(() => spring()) });
  // The server under the pointer, by fixed bands at each server's height.
  const picked =
    pointer === null
      ? null
      : BOOTERS.reduce((best, _, row) => {
          const y = LENS.at(0, UNIT_Y[1], unitFloor(row) + UNIT_H / 2)[1];
          const bestY = LENS.at(0, UNIT_Y[1], unitFloor(best) + UNIT_H / 2)[1];
          return Math.abs(y - pointer[1]) < Math.abs(bestY - pointer[1]) ? row : best;
        }, 0);
  const state = useDrawing<RackState>(
    rootRef,
    { bar: BOOTERS.map(() => 0), rival: 0, elapsed: 0, at: 0 },
    () => ({
      bar: BOOTERS.map((framework) => framework.metrics[BOOT].median / SLOWEST_BOOT),
      rival: 0,
      elapsed: SLOWEST_BOOT,
      at: NAME_OUT * CYCLE_MS,
    }),
    (turn, dt) => {
      const { bar } = springs.current;
      const into = clamp((turn.at - NAME_IN * turn.cycle) / (CLIMB * turn.cycle));
      const elapsed = into * SLOWEST_BOOT;
      const settled = pointer === null && turn.at > NAME_OUT * turn.cycle;
      BOOTERS.forEach((framework, i) => {
        const time = Math.min(elapsed, framework.metrics[BOOT].median);
        pull(bar[i]!, settled ? 0 : time / SLOWEST_BOOT, dt, 120, 22);
      });
      return { bar: bar.map((value) => value.x), rival: turn.rival, elapsed, at: turn.at };
    },
  );

  const rival = RIVALS[state.rival]!;
  const time = (framework: Framework) => formatBenchmarkDuration(framework.metrics[BOOT].median);
  const settled = state.at > NAME_OUT * CYCLE_MS;
  const readout =
    picked !== null
      ? `${BOOTERS[picked]!.label} · ${time(BOOTERS[picked]!)}`
      : state.elapsed > 0 && state.elapsed < SLOWEST_BOOT
        ? `t ${formatBenchmarkDuration(state.elapsed)}`
        : `Farm.js ${time(FARM)} · ${rival.label} ${time(rival)}`;
  const front = UNIT_Y[1];

  return (
    <Stage
      hint="Point at a server"
      pointer={handlers}
      readout={readout}
      rootRef={rootRef}
      view={RACK_VIEW}
    >
      <RoundBox r={0.3} x={[-1.85, 1.85]} y={[-0.95, 0.95]} z={[-0.24, 0.02]}>
        <Inset r={0.2} x={[-1.7, 1.7]} y={[-0.8, 0.8]} z={0.02} />
      </RoundBox>
      {BOOTERS.map((framework, row) => ({ framework, row }))
        .reverse()
        .map(({ framework, row }) => {
          const z0 = unitFloor(row);
          const length = BAR_LONGEST * state.bar[row]!;
          const up = state.elapsed >= framework.metrics[BOOT].median && !settled;
          const hot =
            picked === row || (picked === null && (framework === FARM || framework === rival));
          return (
            <g data-hot={hot || undefined} key={framework.id}>
              <RoundBox r={0.1} x={UNIT_X} y={UNIT_Y} z={[z0, z0 + UNIT_H]}>
                <Inset
                  r={0.07}
                  x={[UNIT_X[0] + 0.1, UNIT_X[1] - 0.1]}
                  y={[-0.6, 0.6]}
                  z={z0 + UNIT_H}
                />
              </RoundBox>
              <Panel
                className={up ? "hl-led-on" : "hl-sign"}
                x={[-1.46, -1.32]}
                y={front}
                z={[z0 + 0.19, z0 + 0.31]}
              />
              <Panel
                className="hl-crease"
                x={[BAR_X, BAR_X + BAR_LONGEST]}
                y={front}
                z={[z0 + 0.17, z0 + 0.33]}
              />
              {length > 0.02 && (
                <Panel
                  className="hl-bar"
                  x={[BAR_X, BAR_X + length]}
                  y={front}
                  z={[z0 + 0.17, z0 + 0.33]}
                />
              )}
              <Line
                className="hl-tick"
                lines={[1.3, 1.4, 1.5].map((x): Point3[] => [
                  [x, front, z0 + 0.12],
                  [x, front, z0 + 0.38],
                ])}
              />
            </g>
          );
        })}
      {BOOTERS.map((framework, row) => {
        const z = unitFloor(row) + UNIT_H / 2;
        const [ax, ay] = LENS.at(BAR_X + BAR_LONGEST * state.bar[row]!, front, z);
        const done = state.elapsed >= framework.metrics[BOOT].median && !settled;
        const hot =
          picked === row || (picked === null && (framework === FARM || framework === rival));
        return (
          <g data-hot={hot || undefined} key={framework.id}>
            <Callout
              drawn={done || picked === row ? 1 : 0}
              label={`${framework.label}  ${time(framework)}`}
              route={[
                [ax, ay],
                [Math.max(ax + 8, RACK_LABEL_X - 10), RACK_LABELS[row]!],
                [RACK_LABEL_X, RACK_LABELS[row]!],
              ]}
            />
          </g>
        );
      })}
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// HTML size: two printers on a desk, Farm's in front and the named rival's
// behind it. Both print their first page at the same rate while the title
// names the rival, and each stops when its whole response is out, so the
// paper is as long as the HTML, with a fold every four kilobytes. Farm's
// sheet is the short one.

const BYTES = "responseBytes";
const PRINT_CAMERA: Camera = { yaw: Math.PI / 6, pitch: Math.PI / 6, scale: 1.25, shift: [0, 0] };
const PRINT = lens(PRINT_CAMERA);
const HEAVIEST_KB = Math.max(...RIVALS.map((framework) => framework.metrics[BYTES].median)) / 1024;
const PRINTER_X: Point2 = [-2.75, -1.75];
const PRINTER_TOP = 0.5;
/** The two lanes, back (the rival) and front (Farm). */
const LANES: Point2[] = [
  [-1.05, -0.15],
  [0.15, 1.05],
];
const PAPER_INSET = 0.15;
const SLOT_Z = 0.33;
const DESK_Z = 0.03;
/** Where the paper leaves the slot, curls down, and lies on the desk. */
const CURL: [number, number][] = [
  [PRINTER_X[1], SLOT_Z],
  [-1.6, 0.31],
  [-1.48, 0.24],
  [-1.4, 0.13],
  [-1.33, DESK_Z],
];
const PAPER_END_X = 3.1;
const CURL_LENGTH = CURL.slice(1).reduce(
  (sum, [x, z], i) => sum + Math.hypot(x - CURL[i]![0], z - CURL[i]![1]),
  0,
);
/** Paper per kilobyte, so the heaviest page just reaches the desk's far end. */
const PER_KB = (CURL_LENGTH + PAPER_END_X - CURL.at(-1)![0]) / HEAVIEST_KB;
const FOLD_KB = 4;
const PRINT_VIEW: [number, number, number, number] = [-130, -88, 272, 170];
const PRINT_LABEL_TOP = PRINT_VIEW[1] + 10;
const PRINT_LABEL_BOTTOM = PRINT_VIEW[1] + PRINT_VIEW[3] - 8;

const kilobytes = (framework: Framework) => framework.metrics[BYTES].median / 1024;

/** The paper's centre line, from the slot to `kb` kilobytes along. */
function paperPath(kb: number): [number, number][] {
  let left = kb * PER_KB;
  const path: [number, number][] = [CURL[0]!];
  for (const [x, z] of [...CURL.slice(1), [PAPER_END_X + 1, DESK_Z] as [number, number]]) {
    const [px, pz] = path.at(-1)!;
    const length = Math.hypot(x - px, z - pz);
    if (length >= left) {
      path.push([px + ((x - px) * left) / length, pz + ((z - pz) * left) / length]);
      return path;
    }
    left -= length;
    path.push([x, z]);
  }
  return path;
}

/** Word lengths, in kilobytes of paper, for the rows of text printed along the sheet. */
const WORDS = [0.55, 0.3, 0.75, 0.4, 0.62, 0.25, 0.7, 0.45, 0.35, 0.8, 0.5];
const ROWS = [0.13, 0.3, 0.47];

function Paper({ lane: [y0, y1], kb }: { lane: Point2; kb: number }) {
  if (kb <= 0.01) return null;
  const [a, b] = [y0 + PAPER_INSET, y1 - PAPER_INSET];
  const path = paperPath(kb);
  const flatFrom = CURL.at(-1)![0];
  const end = path.at(-1)![0];
  // Rows of words along the flat part, a word per kilobyte or so, each row
  // starting at a different point in the list so they do not line up.
  const text: Point3[][] = [];
  ROWS.forEach((row, r) => {
    let x = flatFrom + 0.08;
    for (let i = r * 4; ; i++) {
      const length = WORDS[i % WORDS.length]! * PER_KB;
      if (x + length > end - 0.06) break;
      text.push([
        [x, a + row, DESK_Z],
        [x + length, a + row, DESK_Z],
      ]);
      x += length + PER_KB * 0.3;
    }
  });
  const folds: Point3[][] = [];
  for (let k = FOLD_KB; ; k += FOLD_KB) {
    const x = flatFrom + (k - CURL_LENGTH / PER_KB) * PER_KB;
    if (x >= end) break;
    if (x > flatFrom) {
      folds.push([
        [x, a, DESK_Z],
        [x, b, DESK_Z],
      ]);
    }
  }
  return (
    <>
      <Poly
        corners={[
          ...path.map(([x, z]): Point3 => [x, a, z]),
          ...[...path].reverse().map(([x, z]): Point3 => [x, b, z]),
        ]}
      />
      <Line className="hl-crease" lines={folds} />
      <Line className="hl-sign" lines={text} />
    </>
  );
}

function Printer({ lane: [y0, y1], head, done }: { lane: Point2; head: number; done: boolean }) {
  const [x0, x1] = PRINTER_X;
  const middle = (y0 + y1) / 2;
  const headY = middle + head * 0.22;
  return (
    <>
      <RoundBox r={0.12} x={PRINTER_X} y={[y0, y1]} z={[0, PRINTER_TOP]}>
        <Inset r={0.08} x={[x0 + 0.12, x1 - 0.32]} y={[y0 + 0.12, y1 - 0.12]} z={PRINTER_TOP} />
      </RoundBox>
      <Poly
        className="hl-crease"
        corners={[
          [x1, y0 + PAPER_INSET - 0.03, SLOT_Z - 0.04],
          [x1, y1 - PAPER_INSET + 0.03, SLOT_Z - 0.04],
          [x1, y1 - PAPER_INSET + 0.03, SLOT_Z + 0.02],
          [x1, y0 + PAPER_INSET - 0.03, SLOT_Z + 0.02],
        ]}
      />
      <Panel
        className={done ? "hl-led-on" : "hl-sign"}
        x={[x0 + 0.2, x0 + 0.32]}
        y={y1}
        z={[0.2, 0.3]}
      />
      <RoundBox
        r={0.04}
        x={[x1 - 0.28, x1 - 0.12]}
        y={[headY - 0.1, headY + 0.1]}
        z={[PRINTER_TOP, PRINTER_TOP + 0.1]}
      />
    </>
  );
}

/** Which lane a point on screen is nearest, measured at the same screen x. */
function laneAt([px, py]: Point2) {
  const distances = LANES.map(([y0, y1]) => {
    const y = (y0 + y1) / 2;
    const [ax, ay] = PRINT.at(0, y, DESK_Z);
    const [bx, by] = PRINT.at(1, y, DESK_Z);
    return Math.abs(ay + ((px - ax) * (by - ay)) / (bx - ax) - py);
  });
  return distances[0]! <= distances[1]! ? 0 : 1;
}

type PrintState = { kb: [number, number]; head: [number, number]; rival: number; at: number };

export function WeightFigure() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pointer, handlers] = usePointer();
  const springs = useRef({ back: spring(), front: spring() });
  const state = useDrawing<PrintState>(
    rootRef,
    { kb: [0, 0], head: [0, 0], rival: 0, at: 0 },
    () => ({
      kb: [kilobytes(RIVALS[0]!), kilobytes(FARM)],
      head: [0, 0],
      rival: 0,
      at: NAME_OUT * CYCLE_MS,
    }),
    (turn, dt) => {
      const { back, front } = springs.current;
      const rival = RIVALS[turn.rival]!;
      const into = clamp((turn.at - NAME_IN * turn.cycle) / (CLIMB * turn.cycle));
      const printed = into * HEAVIEST_KB;
      const settled = turn.at > NAME_OUT * turn.cycle;
      // Paper feeds at a steady rate, so the springs only smooth the start.
      pull(back, settled ? 0 : Math.min(printed, kilobytes(rival)), dt, 260, 32);
      pull(front, settled ? 0 : Math.min(printed, kilobytes(FARM)), dt, 260, 32);
      // A print head shuttles across while its printer is still printing.
      const shuttle = Math.sin(turn.at / 70);
      const busy = (kb: number) => !settled && into > 0 && printed < kb;
      return {
        kb: [back.x, front.x],
        head: [busy(kilobytes(rival)) ? shuttle : 0, busy(kilobytes(FARM)) ? shuttle : 0],
        rival: turn.rival,
        at: turn.at,
      };
    },
  );

  const rival = RIVALS[state.rival]!;
  const size = (framework: Framework) => formatKilobytes(framework.metrics[BYTES].median);
  const picked = pointer === null ? null : laneAt(pointer);
  const settled = state.at > NAME_OUT * CYCLE_MS;
  const lanes = [
    { framework: rival, kb: state.kb[0], head: state.head[0] },
    { framework: FARM, kb: state.kb[1], head: state.head[1] },
  ];
  const printing = lanes.some(({ head }) => head !== 0);
  const readout =
    picked !== null
      ? `${lanes[picked]!.framework.label} · ${size(lanes[picked]!.framework)}`
      : printing
        ? `${formatKilobytes(Math.max(state.kb[0], state.kb[1]) * 1024)} printed`
        : `Farm.js ${size(FARM)} · ${rival.label} ${size(rival)}`;

  return (
    <Stage
      camera={PRINT}
      hint="Point at a page"
      pointer={handlers}
      readout={readout}
      rootRef={rootRef}
      view={PRINT_VIEW}
    >
      <RoundBox r={0.34} x={[-3, 3.3]} y={[-1.3, 1.3]} z={[-0.22, 0]}>
        <Inset r={0.24} x={[-2.84, 3.14]} y={[-1.14, 1.14]} z={0} />
      </RoundBox>
      {lanes.map(({ framework, kb, head }, lane) => {
        const done = !settled && kb >= kilobytes(framework) * 0.98;
        const hot = picked === lane || (picked === null && kb > 0.01);
        const [y0, y1] = LANES[lane]!;
        const [ex, ez] = paperPath(kb).at(-1)!;
        const [ax, ay] = PRINT.at(ex, (y0 + y1) / 2, ez);
        const route: Point2[] =
          lane === 0
            ? [
                [ax, ay],
                [ax, PRINT_LABEL_TOP],
                [ax - 14, PRINT_LABEL_TOP],
              ]
            : [
                [ax, ay],
                [ax, PRINT_LABEL_BOTTOM],
                [ax + 14, PRINT_LABEL_BOTTOM],
              ];
        return (
          <g data-hot={hot || undefined} key={lane}>
            <Paper kb={kb} lane={LANES[lane]!} />
            <Printer done={done} head={head} lane={LANES[lane]!} />
            {kb > 0.01 && (
              <Callout
                align={lane === 0 ? "end" : "start"}
                drawn={done || (picked === lane && kb > 0.01) ? 1 : 0}
                label={`${framework.label}  ${size(framework)}`}
                route={route}
              />
            )}
          </g>
        );
      })}
    </Stage>
  );
}

function formatKilobytes(bytes: number) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
