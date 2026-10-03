import { FIGURES, type FigureKind, type WireFrame } from "./figure-scripts";

// Plays a figure's script on a loop. It starts when the figure scrolls into view, pauses offscreen
// and in background tabs (resuming when seen again), and can be paused or restarted by the reader.
// Under reduced motion the server-rendered final frame is left alone.
export function enhanceFigures(root: ParentNode): () => void {
  const figures =
    root instanceof HTMLElement && root.matches(".blog-figure[data-figure]")
      ? [root]
      : [...root.querySelectorAll<HTMLElement>(".blog-figure[data-figure]")];
  const disposers = figures.map(enhanceFigure);
  return () => {
    for (const dispose of disposers) dispose();
  };
}

const HOLD = 1.6;

function enhanceFigure(figure: HTMLElement): () => void {
  const spec = FIGURES[figure.dataset.figure as FigureKind];
  if (!spec || matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};

  const panels = [...figure.querySelectorAll<HTMLElement>("[data-panel]")];
  // A figure may render a wide and a phone layout; both share slots, wires, and panels by id.
  const slots = new Map<string, HTMLElement[]>();
  for (const el of figure.querySelectorAll<HTMLElement>("[data-slot]"))
    slots.set(el.dataset.slot!, [...(slots.get(el.dataset.slot!) ?? []), el]);
  const wires = [...figure.querySelectorAll<SVGGElement>("[data-wire]")].map((group) => {
    const path = group.querySelector<SVGPathElement>(".bf-wire")!;
    return {
      id: group.dataset.wire!,
      group,
      path,
      length: path.getTotalLength(),
      a: group.querySelector<SVGCircleElement>('[data-end="a"]')!,
      b: group.querySelector<SVGCircleElement>('[data-end="b"]')!,
      glow: group.querySelector<SVGCircleElement>(".bf-glow")!,
      pulse: group.querySelector<SVGCircleElement>(".bf-pulse")!,
    };
  });
  const toggle = figure.querySelector<HTMLButtonElement>(".bf-toggle");
  const replay = figure.querySelector<HTMLButtonElement>(".bf-replay");
  const copy = figure.querySelector<HTMLButtonElement>(".bf-copy");
  const source = figure.querySelector<HTMLElement>("[data-figure-source]")?.textContent ?? "";

  let elapsed = 0;
  let playing = false;
  let started = false;
  // Paused because it scrolled away or the tab was hidden, not because the reader paused it.
  let autoPaused = false;
  let visible = false;
  let frame = 0;
  let last = 0;
  const cache = new Map<string, string>();

  function paintWire(wire: (typeof wires)[number], state: WireFrame | undefined) {
    const draw = state?.draw ?? 0;
    wire.group.toggleAttribute("data-dim", Boolean(state?.dim));
    // A non-scaling stroke dashes in screen pixels, so the dash follows the stage's rendered scale.
    // A finished wire drops the dash so no rounding can leave a gap at its end.
    const dash = wire.length * (wire.path.getScreenCTM()?.a || 1);
    wire.path.style.strokeDasharray = draw >= 1 ? "" : `${dash}`;
    wire.path.style.strokeDashoffset = draw >= 1 ? "" : `${dash * (1 - draw)}`;
    wire.a.style.opacity = draw > 0 ? "1" : "0";
    wire.b.style.opacity = draw >= 0.98 ? "1" : "0";
    wire.a.classList.toggle("bf-flash", (state?.flashA ?? 0) > 0.2);
    wire.b.classList.toggle("bf-flash", (state?.flashB ?? 0) > 0.2);
    const on = state?.pulse !== undefined;
    for (const dot of [wire.pulse, wire.glow]) dot.style.opacity = on ? "1" : "0";
    if (on) {
      const point = wire.path.getPointAtLength(wire.length * state!.pulse!);
      for (const dot of [wire.pulse, wire.glow]) {
        dot.setAttribute("cx", `${point.x}`);
        dot.setAttribute("cy", `${point.y}`);
      }
    }
  }

  function render(t: number) {
    const next = spec.frame(t);
    for (const [key, els] of slots) {
      const html = next.slots[key] ?? "";
      if (cache.get(key) !== html) {
        for (const el of els) el.innerHTML = html;
        cache.set(key, html);
      }
    }
    for (const wire of wires) paintWire(wire, next.wires[wire.id]);
    for (const panel of panels) {
      const state = next.states?.[panel.dataset.panel!];
      if (state) panel.dataset.state = state;
      else delete panel.dataset.state;
    }
  }

  function setState(state: "idle" | "playing" | "paused") {
    figure.dataset.state = state;
    toggle?.setAttribute(
      "aria-label",
      state === "playing" ? "Pause illustration" : "Play illustration",
    );
  }

  function tick(now: number) {
    frame = 0;
    if (!playing) return;
    elapsed += Math.min(0.1, (now - last) / 1000);
    last = now;
    // Loop: hold on the finished frame for a beat, then play again from the start.
    if (elapsed >= spec.duration + HOLD) elapsed = 0;
    render(Math.min(elapsed, spec.duration));
    frame = requestAnimationFrame(tick);
  }

  function start(from?: number) {
    autoPaused = false;
    if (from !== undefined) elapsed = from;
    started = true;
    playing = true;
    setState("playing");
    last = performance.now();
    if (!frame) frame = requestAnimationFrame(tick);
  }

  function pause(state: "paused" | "idle" = "paused") {
    playing = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    setState(state);
  }

  // Keep the server's finished frame until the figure is on screen, then play from the start on
  // its own; there is no play button to press.
  figure.dataset.ready = "";
  setState("idle");

  const onToggle = () => (playing ? pause() : start());
  const onReplay = () => start(0);
  toggle?.addEventListener("click", onToggle);
  replay?.addEventListener("click", onReplay);
  let copiedTimer = 0;
  const copyLabel = copy?.querySelector("span")?.textContent ?? "Copy code";
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      copy!.dataset.state = "copied";
      copy!.querySelector("span")!.textContent = "Copied";
      window.clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => {
        delete copy!.dataset.state;
        copy!.querySelector("span")!.textContent = copyLabel;
      }, 1600);
    } catch {
      copy!.querySelector("span")!.textContent = "Copy failed";
    }
  };
  copy?.addEventListener("click", onCopy);

  // Play once a fifth of the figure is on screen (tall phone layouts rarely show 60% at once),
  // and pause again only when it has left the screen entirely.
  const observer = new IntersectionObserver(
    ([entry]) => {
      const seen = entry.isIntersecting && entry.intersectionRatio >= 0.2;
      visible = entry.isIntersecting;
      if (!visible && playing) {
        pause("paused");
        autoPaused = true;
      } else if (seen && (!started || autoPaused)) start(started ? undefined : 0);
    },
    // Report every 10% so a callback landing just under 20% is followed by one that crosses it.
    { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] },
  );
  observer.observe(figure);
  const onVisibility = () => {
    if (document.hidden && playing) {
      pause("paused");
      autoPaused = true;
    } else if (!document.hidden && autoPaused && visible) start();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    observer.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    toggle?.removeEventListener("click", onToggle);
    replay?.removeEventListener("click", onReplay);
    copy?.removeEventListener("click", onCopy);
    window.clearTimeout(copiedTimer);
    if (frame) cancelAnimationFrame(frame);
    delete figure.dataset.ready;
    delete figure.dataset.state;
    render(spec.duration);
  };
}
