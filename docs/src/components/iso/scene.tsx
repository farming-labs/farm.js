// The drawing kit behind the site's isometric scenes: a camera, shapes that
// draw through it, printed names, callouts, and a clock that runs while a
// scene is on screen. Drawn in thin strokes on dark faces; scene.css styles
// everything inside an element with the class iso-scene.

import {
  type CSSProperties,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import "./scene.css";

export const UNIT = 30;
export const ARC_STEPS = 5;

export type Point2 = [number, number];
export type Point3 = [number, number, number];

export const clamp = (value: number) => Math.min(1, Math.max(0, value));
export const ease = (value: number) =>
  value < 0.5 ? 4 * value * value * value : 1 - (-2 * value + 2) ** 3 / 2;
export const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
// Server and browser can disagree in the last bit of a sine, which is enough
// to flip a rounded coordinate and break hydration. Snap trigonometry to a
// fixed precision first, and never print a negative zero.
export const snap = (value: number) => Math.round(value * 1e9) / 1e9;
export const fixed = (value: number) => (Math.abs(value) < 0.005 ? 0 : value).toFixed(2);
export const format = ([sx, sy]: Point2) => `${fixed(sx)},${fixed(sy)}`;
export const center = ([from, to]: Point2) => (from + to) / 2;

// ---------------------------------------------------------------------------
// The camera. World x runs right, y runs toward the viewer, z runs up. The
// camera turns about z (yaw), tilts down (pitch), and scales and shifts the
// result into the figure. Yaw 45° and pitch 35.26° is a true isometric view;
// yaw and pitch 0 look straight at the fronts of things.

export type Camera = { yaw: number; pitch: number; scale: number; shift: Point2 };
export const ISOMETRIC: Camera = {
  yaw: Math.PI / 4,
  pitch: Math.asin(Math.sqrt(1 / 3)),
  scale: Math.sqrt(1.5),
  shift: [0, 0],
};

export function lens({ yaw, pitch, scale, shift: [dx, dy] }: Camera) {
  const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)].map(
    snap,
  ) as [number, number, number, number];
  const k = scale * UNIT;
  const at = (x: number, y: number, z: number): Point2 => [
    (x * cy - y * sy) * k + dx,
    ((x * sy + y * cy) * sp - z * cp) * k + dy,
  ];
  return {
    at,
    points: (corners: Point3[]) => corners.map(([x, y, z]) => format(at(x, y, z))).join(" "),
    path: (lines: Point3[][]) =>
      lines
        .map((line) =>
          line.map(([x, y, z], i) => `${i ? "L" : "M"}${format(at(x, y, z))}`).join(""),
        )
        .join(""),
    /** How far right on screen, and how near the viewer, a ground point is. */
    across: (x: number, y: number) => x * cy - y * sy,
    depth: (x: number, y: number) => x * sy + y * cy,
    /** One world unit along x, along y, and down z, on screen, in text units. */
    axes: {
      x: [cy * scale, sy * sp * scale] as Point2,
      y: [-sy * scale, cy * sp * scale] as Point2,
      down: [0, cp * scale] as Point2,
    },
    /** How much a flat circle's radius stretches across and down the screen. */
    flat: [k, k * sp] as Point2,
    /** How face-on the tops of things are, from 0 (edge-on) to about 0.58. */
    tilt: sp,
  };
}
export type Lens = ReturnType<typeof lens>;

export const ISO_LENS = lens(ISOMETRIC);
export const LensContext = createContext<Lens>(ISO_LENS);
export const useLens = () => useContext(LensContext);

// ---------------------------------------------------------------------------
// Shapes. Each draws through the current camera.

/** A rounded rectangle's outline in world x/y. */
export function roundRect([x0, x1]: Point2, [y0, y1]: Point2, r: number): Point2[] {
  const radius = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  if (radius <= 0) {
    return [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
  }
  const corners: [number, number, number][] = [
    [x1 - radius, y0 + radius, -90],
    [x1 - radius, y1 - radius, 0],
    [x0 + radius, y1 - radius, 90],
    [x0 + radius, y0 + radius, 180],
  ];
  return corners.flatMap(([cx, cy, start]) =>
    Array.from({ length: ARC_STEPS + 1 }, (_, step): Point2 => {
      const angle = ((start + (90 * step) / ARC_STEPS) * Math.PI) / 180;
      return [cx + radius * snap(Math.cos(angle)), cy + radius * snap(Math.sin(angle))];
    }),
  );
}

export type BoxProps = {
  x: Point2;
  y: Point2;
  z: Point2;
  className?: string;
};

/** A box's three faces the camera can see: the front (+y), the right side (+x), and the top. */
export function Box({ x: [x0, x1], y: [y0, y1], z: [z0, z1], className }: BoxProps) {
  const { points } = useLens();
  return (
    <g className={className}>
      <polygon
        className="iso-left"
        points={points([
          [x0, y1, z1],
          [x1, y1, z1],
          [x1, y1, z0],
          [x0, y1, z0],
        ])}
      />
      <polygon
        className="iso-right"
        points={points([
          [x1, y0, z1],
          [x1, y1, z1],
          [x1, y1, z0],
          [x1, y0, z0],
        ])}
      />
      <polygon
        className="iso-top"
        points={points([
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
        ])}
      />
    </g>
  );
}

export type RoundBoxProps = BoxProps & { r: number; children?: ReactNode; style?: CSSProperties };

/**
 * A slab with rounded corners: the band of side the camera can see, then the
 * top. The visible side is the outline's near arc, between its leftmost and
 * rightmost points on screen.
 */
export function RoundBox({ x, y, z: [z0, z1], r, className, children, style }: RoundBoxProps) {
  const { points, across, depth } = useLens();
  const outline = roundRect(x, y, r);
  let left = 0;
  let right = 0;
  outline.forEach(([px, py], i) => {
    if (across(px, py) < across(...outline[left]!)) left = i;
    if (across(px, py) > across(...outline[right]!)) right = i;
  });
  const arc = (from: number, to: number) => {
    const result: Point2[] = [];
    for (let i = from; ; i = (i + 1) % outline.length) {
      result.push(outline[i]!);
      if (i === to) return result;
    }
  };
  const nearness = (line: Point2[]) =>
    line.reduce((sum, [px, py]) => sum + depth(px, py), 0) / line.length;
  const forward = arc(left, right);
  const backward = arc(right, left).reverse();
  const near = nearness(forward) > nearness(backward) ? forward : backward;
  return (
    <g className={className} style={style}>
      <polygon
        className="iso-side"
        points={points([
          ...near.map(([px, py]): Point3 => [px, py, z1]),
          ...[...near].reverse().map(([px, py]): Point3 => [px, py, z0]),
        ])}
      />
      <polygon className="iso-top" points={points(outline.map(([px, py]) => [px, py, z1]))} />
      {children}
    </g>
  );
}

/** Open lines through world points. */
export function Line({
  lines,
  className,
  on,
}: {
  lines: Point3[][];
  className?: string;
  on?: boolean;
}) {
  const { path } = useLens();
  return <path className={className} d={path(lines)} data-on={on || undefined} />;
}

/** A closed outline through world points. */
export function Poly({ corners, className }: { corners: Point3[]; className?: string }) {
  const { points } = useLens();
  return <polygon className={className} points={points(corners)} />;
}

/** A rounded outline lying flat at height z: an inset on a top, a footprint on the ground. */
export function Inset({
  x,
  y,
  z,
  r = 0,
  className = "iso-detail-line",
}: {
  x: Point2;
  y: Point2;
  z: number;
  r?: number;
  className?: string;
}) {
  return (
    <Poly
      className={className}
      corners={roundRect(x, y, r).map(([px, py]): Point3 => [px, py, z])}
    />
  );
}

/** A face-on rectangle standing on the plane y = `y`. */
export function Panel({
  x: [x0, x1],
  y,
  z: [z0, z1],
  className = "iso-detail-line",
}: {
  x: Point2;
  y: number;
  z: Point2;
  className?: string;
}) {
  return (
    <Poly
      className={className}
      corners={[
        [x0, y, z0],
        [x1, y, z0],
        [x1, y, z1],
        [x0, y, z1],
      ]}
    />
  );
}

/** A circle lying flat at height z. */
export function Dot({
  at: [x, y, z],
  r,
  className,
  style,
}: {
  at: Point3;
  r: number;
  className?: string;
  style?: CSSProperties;
}) {
  const { at, flat } = useLens();
  const [cx, cy] = at(x, y, z);
  return (
    <ellipse
      className={className}
      cx={fixed(cx)}
      cy={fixed(cy)}
      rx={fixed(r * flat[0])}
      ry={fixed(r * flat[1])}
      style={style}
    />
  );
}

/** Short marks every `every` units along x or y, like a ruler's. */
export function Ticks({
  from,
  to,
  every,
  mark,
}: {
  from: Point3;
  to: Point3;
  every: number;
  /** The offset of each mark from the line, and how often a mark runs long. */
  mark: [Point3, number];
}) {
  const [[dx, dy, dz], long] = mark;
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const count = Math.floor(length / every);
  return (
    <Line
      className="iso-tick"
      lines={Array.from({ length: count + 1 }, (_, i): Point3[] => {
        const [x, y, z] = [
          lerp(from[0], to[0], (i * every) / length),
          lerp(from[1], to[1], (i * every) / length),
          from[2],
        ];
        const reach = i % long === 0 ? 1.7 : 1;
        return [
          [x, y, z],
          [x + dx * reach, y + dy * reach, z + dz * reach],
        ];
      })}
    />
  );
}

export type Face = "top" | "front";

/**
 * Text printed on a surface, starting at the left end of its baseline. Front
 * text stands upright on a +y face; top text lies on a top face, and fades out
 * as the camera levels off and tops turn edge-on. `size` is in drawing units;
 * the stylesheet scales it up a little on narrow screens.
 */
export function Print({
  at: [x, y, z],
  face = "front",
  size = 5,
  children,
}: {
  at: Point3;
  face?: Face;
  size?: number;
  children: ReactNode;
}) {
  const { at, axes, tilt } = useLens();
  const [sx, sy] = at(x, y, z);
  const [a, b] = axes.x;
  const [c, d] = face === "top" ? axes.y : axes.down;
  const n = (value: number) => (Math.abs(value) < 0.00005 ? 0 : value).toFixed(4);
  const style = { "--iso-text": size } as CSSProperties;
  if (face === "top") style.opacity = clamp((tilt - 0.2) / 0.25);
  return (
    <text
      className="iso-print"
      style={style}
      transform={`matrix(${n(a)} ${n(b)} ${n(c)} ${n(d)} ${fixed(sx)} ${fixed(sy)})`}
    >
      {children}
    </text>
  );
}

/** The bright cube that stands for whatever is moving: a deploy, a request, a reply. */
export function Packet({ at: [x, y, z] }: { at: Point3 }) {
  return (
    <RoundBox
      className="iso-packet"
      r={0.04}
      x={[x - 0.1, x + 0.1]}
      y={[y - 0.1, y + 0.1]}
      z={[z, z + 0.18]}
    />
  );
}

/** The first `amount` (0 to 1) of a line on screen, ending wherever the amount runs out. */
export function traced(line: Point2[], amount: number): Point2[] {
  const lengths = line.slice(1).map(([x, y], i) => Math.hypot(x - line[i]![0], y - line[i]![1]));
  let left = lengths.reduce((sum, length) => sum + length, 0) * clamp(amount);
  const result: Point2[] = [line[0]!];
  for (let i = 0; i < lengths.length; i++) {
    const [ax, ay] = line[i]!;
    const [bx, by] = line[i + 1]!;
    if (left >= lengths[i]!) {
      result.push([bx, by]);
      left -= lengths[i]!;
      continue;
    }
    const ratio = lengths[i] ? left / lengths[i]! : 0;
    result.push([lerp(ax, bx, ratio), lerp(ay, by, ratio)]);
    break;
  }
  return result;
}

/** A path through points on screen with its elbows rounded, as the hero draws its wire. */
export function elbowed(line: Point2[], radius = 6): string {
  let d = `M${format(line[0]!)}`;
  for (let i = 1; i < line.length - 1; i++) {
    const [x0, y0] = line[i - 1]!;
    const [x1, y1] = line[i]!;
    const [x2, y2] = line[i + 1]!;
    const into = Math.hypot(x1 - x0, y1 - y0) || 1;
    const out = Math.hypot(x2 - x1, y2 - y1) || 1;
    const a = Math.min(radius, into / 2);
    const b = Math.min(radius, out / 2);
    d += `L${format([x1 - ((x1 - x0) / into) * a, y1 - ((y1 - y0) / into) * a])}`;
    d += `Q${format([x1, y1])} ${format([x1 + ((x2 - x1) / out) * b, y1 + ((y2 - y1) / out) * b])}`;
  }
  return `${d}L${format(line[line.length - 1]!)}`;
}

/**
 * A readable label for a part too small to read in the drawing, wired to it
 * the way the hero wires its selection: a dot on the part, a wire drawn out
 * along `route` (on screen, in view units) as `drawn` runs from 0 to 1, and
 * once it lands, an end mark and the label beside it.
 */
export function Callout({
  route,
  drawn,
  align = "start",
  label,
  detail = [],
}: {
  route: Point2[];
  drawn: number;
  align?: "start" | "end";
  label: string;
  detail?: readonly string[];
}) {
  const [ax, ay] = route[0]!;
  const [bx, by] = route[route.length - 1]!;
  const textX = align === "end" ? bx - 4 : bx + 4;
  return (
    <g aria-hidden className="iso-callout" data-linked={drawn >= 1 || undefined}>
      <path d={elbowed(traced(route, drawn))} />
      <circle cx={fixed(ax)} cy={fixed(ay)} r="1.7" />
      <rect height="3" width="3" x={fixed(bx - 1.5)} y={fixed(by - 1.5)} />
      <text
        style={{ "--iso-text": 5.6 } as CSSProperties}
        textAnchor={align}
        x={fixed(textX)}
        y={fixed(by + 2)}
      >
        {label}
      </text>
      {detail.map((line, i) => (
        <text
          className="iso-callout-detail"
          key={line}
          style={{ "--iso-text": 4.6 } as CSSProperties}
          textAnchor={align}
          x={fixed(textX)}
          y={fixed(by + 9 + i * 7)}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

/** The part of a polyline from its start to `amount` (0 to 1) of the way along. */
export function partial(line: Point3[], amount: number): Point3[] {
  const lengths = line
    .slice(1)
    .map(([x, y, z], i) => Math.hypot(x - line[i]![0], y - line[i]![1], z - line[i]![2]));
  let left = lengths.reduce((sum, length) => sum + length, 0) * clamp(amount);
  const result: Point3[] = [line[0]!];
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    const [from, to] = [line[i]!, line[i + 1]!];
    if (left <= length) {
      const t = length ? left / length : 1;
      result.push([lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)]);
      return result;
    }
    result.push(to);
    left -= length;
  }
  return result;
}
export const along = (line: Point3[], amount: number) => partial(line, amount).at(-1)!;

export const onGround = (line: Point2[], z = 0.03) => line.map(([x, y]): Point3 => [x, y, z]);

// ---------------------------------------------------------------------------
// Playback.

/**
 * Calls `step(now)` every frame while the figure is on screen, until it returns
 * false. The returned `kick` restarts the loop, for example after a hover.
 */
export function useFrames(
  rootRef: React.RefObject<HTMLElement | null>,
  step: (now: number) => boolean,
) {
  const stepRef = useRef(step);
  stepRef.current = step;
  const kickRef = useRef<() => void>(() => {});
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    let visible = false;
    const tick = (now: number) => {
      const more = stepRef.current(now);
      frame = visible && more ? requestAnimationFrame(tick) : 0;
    };
    const kick = () => {
      if (!frame && visible) frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (visible) kick();
    });
    observer.observe(root);
    kickRef.current = kick;
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [rootRef]);
  return kickRef;
}

export function prefersStill() {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The clock behind a looping scene: milliseconds into the loop, advancing while
 * the scene is on screen and nobody is steering it. It starts at `from`.
 */
export function useLoop(
  rootRef: React.RefObject<HTMLElement | null>,
  length: number,
  from: number,
  held: boolean,
) {
  const [t, setT] = useState(from);
  const startRef = useRef<number | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const heldRef = useRef(held);
  heldRef.current = held;
  const kickRef = useFrames(rootRef, (now) => {
    if (heldRef.current || prefersStill()) {
      startRef.current = null;
      return false;
    }
    // Pick up where the scene left off.
    startRef.current ??= now - tRef.current;
    setT((now - startRef.current) % length);
    return true;
  });
  useEffect(() => {
    if (!held) kickRef.current();
  }, [held, kickRef]);
  return t;
}

export type View = [number, number, number, number];

/** Small rounded feet under a plate's corners, drawn before the plate itself. */
export function Feet({ at, z }: { at: Point2[]; z: Point2 }) {
  return (
    <>
      {at.map(([x, y]) => (
        <RoundBox
          key={`${x}-${y}`}
          r={0.12}
          x={[x - 0.13, x + 0.13]}
          y={[y - 0.13, y + 0.13]}
          z={z}
        />
      ))}
    </>
  );
}

/** Screw heads in a plate's corners. */
export function Screws({ at, z }: { at: Point2[]; z: number }) {
  return (
    <>
      {at.map(([x, y]) => (
        <Dot at={[x, y, z]} className="iso-ink-faint" key={`${x}-${y}`} r={0.045} />
      ))}
    </>
  );
}

export const corners = ([x0, x1]: Point2, [y0, y1]: Point2): Point2[] => [
  [x0, y0],
  [x1, y0],
  [x0, y1],
  [x1, y1],
];
