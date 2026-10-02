"use client";

import { useEffect, useRef } from "react";

// The launch video's look: characters run through these signs before they settle.
const GLYPHS = "#%&/_<>*+=!?01";

// One loop, in milliseconds. A cursor drags a selection over the word, the word
// scrambles into its swap, the cursor drags a wire from the selection into the
// link tag and clicks it, and then everything unwinds.
const STEPS = [
  ["rest", 700],
  ["glide", 520],
  ["press", 120],
  ["drag", 720],
  ["release", 140],
  ["scramble", 480],
  ["toPort", 460],
  ["grab", 120],
  ["wire", 760],
  ["connect", 180],
  ["toTag", 380],
  ["click", 160],
  ["lit", 520],
  ["hold", 2800],
  ["unwire", 360],
  ["unscramble", 480],
  ["deselect", 620],
] as const;
type Step = (typeof STEPS)[number][0];
const AT = {} as Record<Step, number>;
let elapsed = 0;
for (const [step, duration] of STEPS) {
  AT[step] = elapsed;
  elapsed += duration;
}
const LOOP_MS = elapsed;
const DURATION = Object.fromEntries(STEPS) as Record<Step, number>;
// Where the loop waits while the word or the link is hovered or focused: lit, cursor gone.
const CURSOR_LEAVE_MS = 460;
const HOLD_AT = AT.hold + CURSOR_LEAVE_MS + 100;
// The video's click: two rings, a beat apart, grow from the cursor and fade.
const RIPPLE_MS = 700;
const RIPPLE_GAP_MS = 120;

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const ease = (value: number) =>
  value < 0.5 ? 4 * value * value * value : 1 - (-2 * value + 2) ** 3 / 2;
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const progress = (t: number, step: Step) => clamp((t - AT[step]) / DURATION[step]);
const randomGlyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;

/** SVG path with rounded elbows through the given points, as the blog figures draw wires. */
function roundPath(points: [number, number][], radius = 9): string {
  let d = `M${points[0]![0]} ${points[0]![1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[i + 1]!;
    const la = Math.hypot(x1 - x0, y1 - y0) || 1;
    const lb = Math.hypot(x2 - x1, y2 - y1) || 1;
    const a = Math.min(radius, la / 2);
    const b = Math.min(radius, lb / 2);
    d += ` L${x1 - ((x1 - x0) / la) * a} ${y1 - ((y1 - y0) / la) * a}`;
    d += ` Q${x1} ${y1} ${x1 + ((x2 - x1) / lb) * b} ${y1 + ((y2 - y1) / lb) * b}`;
  }
  const [lx, ly] = points[points.length - 1]!;
  return `${d} L${lx} ${ly}`;
}

/** A point `amount` of the way along an L-shaped route: down first, then across. */
function alongElbow(
  from: [number, number],
  to: [number, number],
  amount: number,
): [number, number] {
  const down = Math.abs(to[1] - from[1]);
  const across = Math.abs(to[0] - from[0]);
  const travelled = (down + across) * amount;
  if (travelled <= down) return [from[0], lerp(from[1], to[1], down ? travelled / down : 1)];
  return [lerp(from[0], to[0], across ? (travelled - down) / across : 1), to[1]];
}

type HeroTitleProps = {
  className?: string;
  lead: string;
  /** The word the selection lands on. Headings and assistive technology always read it. */
  word: string;
  /** What the selected word becomes. */
  swap: string;
  /** The rest of the line, after the word. */
  after: string;
  href: string;
  /** The tag the wire connects to, which links to `href`. */
  tag: string;
  /** The link's accessible name, read instead of the tag. */
  linkLabel: string;
};

/**
 * The hero heading. A cursor drags a design-tool selection over one word, the
 * word scrambles into another, and the cursor drags a wire from the selection
 * into a tag that links to that page; then it all unwinds. Hovering the word or
 * the tag, or focusing the link, holds it connected. With reduced motion the
 * selection, wire and tag simply stay, without the swap.
 *
 * Everything moves on one requestAnimationFrame timeline that writes to the
 * DOM directly, like the blog figures, so React never re-renders mid-loop.
 */
export function HeroTitle({
  className,
  lead,
  word,
  swap,
  after,
  href,
  tag,
  linkLabel,
}: HeroTitleProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const wordRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const selectRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<SVGSVGElement>(null);
  const wireRef = useRef<SVGPathElement>(null);
  const portRef = useRef<SVGCircleElement>(null);
  const endRef = useRef<SVGCircleElement>(null);
  const rippleRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const tagRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const heading = headingRef.current;
    const wordBox = wordRef.current;
    const text = textRef.current;
    const select = selectRef.current;
    const cursor = cursorRef.current;
    const wire = wireRef.current;
    const port = portRef.current;
    const end = endRef.current;
    // A copy: React clears ref slots on unmount before this effect's cleanup runs.
    const ripples = rippleRefs.current.slice();
    const tagLink = tagRef.current;
    if (
      !root ||
      !heading ||
      !wordBox ||
      !text ||
      !select ||
      !cursor ||
      !wire ||
      !port ||
      !end ||
      ripples.length !== 2 ||
      !tagLink
    ) {
      return;
    }

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let wordWidth = 0;
    let swapWidth = 0;
    let fontSize = 16;
    // Both words' widths, measured in place: the text is swapped and restored
    // within one task, so nothing paints in between.
    const measure = () => {
      const savedText = text.textContent;
      const savedWidth = wordBox.style.width;
      wordBox.style.width = "auto";
      text.textContent = word;
      wordWidth = wordBox.getBoundingClientRect().width;
      text.textContent = swap;
      swapWidth = wordBox.getBoundingClientRect().width;
      text.textContent = savedText;
      wordBox.style.width = savedWidth;
      fontSize = parseFloat(getComputedStyle(heading).fontSize) || 16;
    };

    // Per-character settle points for the scramble, reseeded every loop.
    const length = Math.max(word.length, swap.length);
    let settleAt: number[] = [];
    const reseed = () => {
      settleAt = Array.from({ length }, (_, index) => (index / length) * 0.7 + Math.random() * 0.3);
    };
    reseed();
    // Grow or shrink a character at a time, in step with the word's width.
    const scrambled = (from: string, to: string, amount: number) => {
      if (amount <= 0) return from;
      if (amount >= 1) return to;
      const visible = Math.round(lerp(from.length, to.length, amount));
      let next = "";
      for (let index = 0; index < Math.min(length, visible); index += 1) {
        next += amount >= settleAt[index]! ? (to[index] ?? "") : randomGlyph();
      }
      return next;
    };
    let shownText = word;

    const render = (t: number) => {
      const swapIn = still ? 0 : ease(progress(t, "scramble"));
      const swapOut = still ? 0 : ease(progress(t, "unscramble"));
      wordBox.style.width = `${lerp(wordWidth, swapWidth, swapIn * (1 - swapOut))}px`;
      const nextText = still
        ? word
        : t < AT.unscramble
          ? scrambled(word, swap, progress(t, "scramble"))
          : scrambled(swap, word, progress(t, "unscramble"));
      if (nextText !== shownText) {
        text.textContent = nextText;
        shownText = nextText;
      }

      const rootBox = root.getBoundingClientRect();
      const wordRect = wordBox.getBoundingClientRect();
      const headingRect = heading.getBoundingClientRect();
      const x0 = wordRect.left - rootBox.left - 0.16 * fontSize;
      const y0 = wordRect.top - rootBox.top - 0.06 * fontSize;
      const x1 = wordRect.right - rootBox.left + 0.16 * fontSize;
      const y1 = wordRect.bottom - rootBox.top + 0.04 * fontSize;

      // The tag hangs under the rest of the line, a wire's length right of the selection.
      const tagWidth = tagLink.offsetWidth;
      const tagHeight = tagLink.offsetHeight;
      const tagLeft = Math.min(x1 + Math.max(18, 0.6 * fontSize), rootBox.width - tagWidth);
      const tagTop = headingRect.bottom - rootBox.top + 8;
      const tagPress = !still && t >= AT.click && t < AT.lit ? 0.95 : 1;
      tagLink.style.transform = `translate3d(${tagLeft}px, ${tagTop}px, 0) scale(${tagPress})`;
      const portPoint: [number, number] = [x1 - Math.min(24, (x1 - x0) / 4), y1];
      const endPoint: [number, number] = [tagLeft, tagTop + tagHeight / 2];
      // Where the cursor clicks: on the tag's text, a little right of centre, as in the video.
      const clickPoint: [number, number] = [tagLeft + tagWidth * 0.58, tagTop + tagHeight * 0.62];

      // Selection: dragged open from the top-left, held, then released to the bottom-right.
      const drag = ease(progress(t, "drag"));
      const deselect = ease(progress(t, "deselect"));
      let rect: [number, number, number, number] | null = null;
      if (still) rect = [x0, y0, x1, y1];
      else if (t >= AT.drag && t < AT.release) {
        rect = [x0, y0, lerp(x0, x1, drag), lerp(y0, y1, drag)];
      } else if (t >= AT.release && t < LOOP_MS) {
        rect = [lerp(x0, x1, deselect), lerp(y0, y1, deselect), x1, y1];
      }
      if (rect) {
        select.style.opacity = String(1 - deselect);
        select.style.transform = `translate3d(${rect[0]}px, ${rect[1]}px, 0)`;
        select.style.width = `${Math.max(0, rect[2] - rect[0])}px`;
        select.style.height = `${Math.max(0, rect[3] - rect[1])}px`;
        select.toggleAttribute("data-corners", rect[2] - rect[0] > 12);
      } else {
        select.style.opacity = "0";
      }

      // Wire: drawn from the port to the cursor, then connected to the tag.
      const wireAmount = still || t >= AT.connect ? 1 : ease(progress(t, "wire"));
      const unwire = still ? 0 : ease(progress(t, "unwire"));
      const wireTip = alongElbow(portPoint, endPoint, wireAmount);
      if (still || (t >= AT.wire && t < AT.unscramble)) {
        const points: [number, number][] =
          wireTip[1] < endPoint[1]
            ? [portPoint, wireTip]
            : [portPoint, [portPoint[0], endPoint[1]], wireTip];
        wire.setAttribute("d", roundPath(points));
        wire.style.opacity = String(1 - unwire);
        port.setAttribute("cx", String(portPoint[0]));
        port.setAttribute("cy", String(portPoint[1]));
        port.style.opacity = String(1 - unwire);
      } else {
        wire.style.opacity = "0";
        port.style.opacity = "0";
      }
      const connected = still || (t >= AT.connect && t < AT.unscramble);
      end.setAttribute("cx", String(endPoint[0]));
      end.setAttribute("cy", String(endPoint[1]));
      end.style.opacity = connected ? String(1 - unwire) : "0";

      // The click's rings.
      ripples.forEach((ripple, index) => {
        const ring = still ? 0 : clamp((t - AT.click - index * RIPPLE_GAP_MS) / RIPPLE_MS);
        if (ring <= 0 || ring >= 1) {
          ripple!.style.opacity = "0";
          return;
        }
        ripple!.style.opacity = String(0.7 * (1 - ring));
        ripple!.style.transform = `translate3d(${clickPoint[0]}px, ${clickPoint[1]}px, 0) scale(${0.2 + 2.6 * ease(ring)})`;
      });

      // The tag: a dashed target while the wire is dragged, linked once the wire
      // lands, hovered and clicked by the cursor, then lit as the link it is.
      const tagState = still
        ? "on"
        : t < AT.toPort || t >= AT.unscramble
          ? "off"
          : t < AT.connect
            ? "target"
            : t < AT.toTag
              ? "linked"
              : t < AT.lit
                ? "hover"
                : "on";
      if (tagLink.dataset.state !== tagState) tagLink.dataset.state = tagState;
      tagLink.style.opacity = tagState === "off" ? "" : String(1 - unwire);

      // Cursor: glide in, drag the selection, move to the port, drag the wire, let go.
      let cursorPoint: [number, number] | null = null;
      let pressed = false;
      let cursorOpacity = 1;
      if (!still) {
        if (t >= AT.glide && t < AT.press) {
          const glide = ease(progress(t, "glide"));
          cursorPoint = [lerp(x0 - 34, x0, glide), lerp(y0 - 26, y0, glide)];
          cursorOpacity = glide;
        } else if (t >= AT.press && t < AT.release) {
          cursorPoint = [lerp(x0, x1, drag), lerp(y0, y1, drag)];
          pressed = true;
        } else if (t >= AT.release && t < AT.toPort) {
          cursorPoint = [x1, y1];
        } else if (t >= AT.toPort && t < AT.grab) {
          const move = ease(progress(t, "toPort"));
          cursorPoint = [lerp(x1, portPoint[0], move), lerp(y1, portPoint[1], move)];
        } else if (t >= AT.grab && t < AT.connect) {
          cursorPoint = wireTip;
          pressed = true;
        } else if (t >= AT.connect && t < AT.toTag) {
          cursorPoint = endPoint;
        } else if (t >= AT.toTag && t < AT.click) {
          const move = ease(progress(t, "toTag"));
          cursorPoint = [
            lerp(endPoint[0], clickPoint[0], move),
            lerp(endPoint[1], clickPoint[1], move),
          ];
        } else if (t >= AT.click && t < AT.hold) {
          cursorPoint = clickPoint;
          pressed = t < AT.lit;
        } else if (t >= AT.hold && t < AT.hold + CURSOR_LEAVE_MS) {
          const away = ease((t - AT.hold) / CURSOR_LEAVE_MS);
          cursorPoint = [clickPoint[0] + 10 * away, clickPoint[1] + 10 * away];
          cursorOpacity = 1 - away;
        }
      }
      if (cursorPoint) {
        cursor.style.opacity = String(cursorOpacity);
        cursor.style.transform = `translate3d(${cursorPoint[0] - 3}px, ${cursorPoint[1] - 2}px, 0) scale(${pressed ? 0.86 : 1})`;
      } else {
        cursor.style.opacity = "0";
      }
    };

    measure();
    let t = still ? HOLD_AT : 0;
    let held = 0;
    let visible = false;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      if (!root.isConnected) {
        frame = 0;
        return;
      }
      const delta = last ? Math.min(64, now - last) : 0;
      last = now;
      // While held, stay connected: the hold never ends.
      t = held > 0 && t >= AT.hold + DURATION.hold - 300 ? HOLD_AT : t + delta;
      if (t >= LOOP_MS) {
        t -= LOOP_MS;
        reseed();
      }
      render(t);
      frame = visible ? requestAnimationFrame(tick) : 0;
    };
    const start = () => {
      if (still || frame) return;
      last = 0;
      frame = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = Boolean(entry?.isIntersecting);
        if (visible) start();
      },
      { threshold: 0.3 },
    );
    const resize = new ResizeObserver(() => {
      measure();
      render(t);
    });
    let disposed = false;
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (disposed) return;
      measure();
      render(t);
      observer.observe(root);
      resize.observe(root);
    });

    const hold = () => {
      held += 1;
      if (still) return;
      if (t < AT.lit || t >= AT.unwire) t = HOLD_AT;
      render(t);
    };
    const letGo = () => {
      held = Math.max(0, held - 1);
    };
    // The swapped word links like its tag.
    const followTag = (event: MouseEvent) => {
      if (t < AT.scramble || t >= AT.unscramble) return;
      event.preventDefault();
      tagLink.click();
    };
    const hoverTargets = [wordBox, tagLink];
    for (const target of hoverTargets) {
      target.addEventListener("pointerenter", hold);
      target.addEventListener("pointerleave", letGo);
    }
    tagLink.addEventListener("focus", hold);
    tagLink.addEventListener("blur", letGo);
    wordBox.addEventListener("click", followTag);
    render(t);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      for (const target of hoverTargets) {
        target.removeEventListener("pointerenter", hold);
        target.removeEventListener("pointerleave", letGo);
      }
      tagLink.removeEventListener("focus", hold);
      tagLink.removeEventListener("blur", letGo);
      wordBox.removeEventListener("click", followTag);
    };
  }, [swap, word]);

  return (
    <div
      className="farm-hero-title relative mt-7 w-fit max-w-full px-4 py-4 sm:px-5 sm:py-5"
      ref={rootRef}
    >
      {/* The label keeps the heading's name steady while its visible word changes. */}
      <h1 aria-label={`${lead} ${word} ${after}`} className={className} ref={headingRef}>
        <span className="block">{lead}</span>{" "}
        <span className="block whitespace-nowrap">
          <span className="farm-hero-swap" ref={wordRef}>
            {/* Written by the animation, so React never re-renders it. */}
            <span
              className="farm-hero-swap-text"
              dangerouslySetInnerHTML={{ __html: word }}
              ref={textRef}
            />
          </span>{" "}
          {after}
        </span>
      </h1>
      <div aria-hidden className="farm-hero-select" ref={selectRef}>
        <span className="farm-hero-select-corner farm-hero-select-corner-tl" />
        <span className="farm-hero-select-corner farm-hero-select-corner-tr" />
        <span className="farm-hero-select-corner farm-hero-select-corner-bl" />
        <span className="farm-hero-select-corner farm-hero-select-corner-br" />
      </div>
      <svg aria-hidden className="farm-hero-wires">
        <path className="farm-hero-wire" ref={wireRef} />
        <circle className="farm-hero-wire-end" r="3" ref={portRef} />
        <circle className="farm-hero-wire-end" r="3" ref={endRef} />
      </svg>
      <a aria-label={linkLabel} className="farm-hero-tag" data-state="off" href={href} ref={tagRef}>
        {tag}
      </a>
      {[0, 1].map((index) => (
        <span
          aria-hidden
          className="farm-hero-ripple"
          key={index}
          ref={(node) => void (rippleRefs.current[index] = node)}
        />
      ))}
      {/* The launch video's cursor. */}
      <svg aria-hidden className="farm-hero-cursor" ref={cursorRef} viewBox="0 0 24 24">
        <path
          d="M4 2.5 19.5 10l-6.6 1.9L9.7 18.6z"
          fill="#fff"
          stroke="#000"
          strokeLinejoin="round"
          strokeWidth="1.2"
        />
      </svg>
    </div>
  );
}
