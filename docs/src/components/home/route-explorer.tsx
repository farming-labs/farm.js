"use client";

import { type CSSProperties, useEffect, useState } from "react";

// The routing card's explorer: what the selected file in the app tree becomes,
// drawn as a small hairline browser. The URL types in, the part of the page the
// file renders gets the bright edge, and an API route turns the window into
// the response it sends.

type Focus = "shell" | "home" | "dashboard" | "api";

const ROUTES: Record<string, { url: string; focus: Focus; caption: string }> = {
  "app/layout.tsx": { url: "/", focus: "shell", caption: "layout.tsx wraps every page" },
  "app/page.tsx": { url: "/", focus: "home", caption: "page.tsx renders /" },
  "app/dashboard/page.tsx": {
    url: "/dashboard",
    focus: "dashboard",
    caption: "dashboard/page.tsx renders /dashboard",
  },
  "app/api/users/route.ts": {
    url: "/api/users",
    focus: "api",
    caption: "route.ts answers GET /api/users",
  },
};

const box = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x + r}Q${x},${y + h} ${x},${y + h - r}V${y + r}Q${x},${y} ${x + r},${y}Z`;

/** A stroke that draws itself in when it mounts, `order` beats after the others. */
function Draw({ d, order = 0, className }: { d: string; order?: number; className?: string }) {
  return (
    <path
      className={className}
      d={d}
      pathLength={1}
      style={{ "--route-draw-delay": `${order * 70}ms` } as CSSProperties}
    />
  );
}

function useTyped(text: string) {
  const [typed, setTyped] = useState(text);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(text);
      return;
    }
    let count = 0;
    setTyped("");
    const timer = window.setInterval(() => {
      count += 1;
      setTyped(text.slice(0, count));
      if (count >= text.length) window.clearInterval(timer);
    }, 32);
    return () => window.clearInterval(timer);
  }, [text]);
  return typed;
}

function PageBody({ focus }: { focus: Focus }) {
  return (
    <>
      {/* The layout's shell: header with a mark and links, and a footer. */}
      <g data-hot={focus === "shell" || undefined}>
        <Draw d={box(16, 40, 188, 14, 3)} />
        <Draw className="farm-route-faint" d="M24,47h8M140,47h12M158,47h12M176,47h20" order={1} />
        <Draw d={box(16, 160, 188, 9, 2.5)} order={2} />
      </g>
      <g data-hot={focus !== "shell" || undefined} key={focus}>
        <Draw d={box(16, 59, 188, 96, 3)} />
        {focus === "dashboard" ? (
          <>
            <Draw
              className="farm-route-faint"
              d="M24,70h22M24,80h18M24,90h20M24,100h16"
              order={1}
            />
            <Draw d="M54,59V155" order={1} />
            <Draw d={box(62, 66, 40, 24, 3)} order={2} />
            <Draw d={box(108, 66, 40, 24, 3)} order={3} />
            <Draw d={box(154, 66, 42, 24, 3)} order={4} />
            <Draw d={box(62, 96, 134, 52, 3)} order={5} />
            <Draw d="M70,138L88,124L104,130L122,112L140,118L158,104L188,110" order={6} />
          </>
        ) : (
          <>
            <Draw className="farm-route-faint" d="M26,76h84M26,86h64" order={1} />
            <Draw className="farm-route-faint" d="M26,100h72M26,107h56" order={2} />
            <Draw d={box(26, 120, 38, 11, 5.5)} order={3} />
            <Draw d={box(122, 68, 72, 58, 4)} order={2} />
            <Draw
              className="farm-route-faint"
              d="M126,122L148,98L162,110L172,102L190,120"
              order={4}
            />
          </>
        )}
      </g>
    </>
  );
}

function ApiBody() {
  const lines = ["[", '  { "id": 1, "name": "Ada" },', '  { "id": 2, "name": "Lin" }', "]"];
  return (
    <g data-hot key="api">
      <Draw d={box(16, 40, 188, 129, 3)} />
      <Draw d={box(24, 49, 22, 11, 3)} order={1} />
      <text className="farm-route-text farm-route-strong" x={28} y={57}>
        GET
      </text>
      <text className="farm-route-text farm-route-strong" x={54} y={57}>
        200
      </text>
      <text className="farm-route-text" x={72} y={57}>
        application/json
      </text>
      <Draw className="farm-route-faint" d="M24,68H196" order={2} />
      {lines.map((line, i) => (
        <text
          className="farm-route-text farm-route-json"
          key={line}
          style={{ "--route-draw-delay": `${180 + i * 90}ms` } as CSSProperties}
          x={28}
          y={84 + i * 12}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

export function RouteExplorer({ path }: { path: string }) {
  const route = ROUTES[path] ?? ROUTES["app/page.tsx"]!;
  const typed = useTyped(route.url);
  return (
    <div className="farm-route-explorer flex h-full flex-col justify-center px-3 py-2">
      <svg aria-hidden className="w-full" viewBox="0 0 220 190">
        <path d={box(8, 10, 204, 166, 8)} />
        <path className="farm-route-faint" d="M8,32H212" />
        {[184, 192, 200].map((cx) => (
          <circle className="farm-route-dot" cx={cx} cy={21} key={cx} r={2} />
        ))}
        <g data-route-explorer-anchor>
          <path d={box(16, 15, 158, 12, 6)} />
        </g>
        <text className="farm-route-text farm-route-strong" x={24} y={23.5}>
          {typed}
          <tspan className="farm-route-caret">▏</tspan>
        </text>
        {route.focus === "api" ? <ApiBody /> : <PageBody focus={route.focus} />}
        <text className="farm-route-text farm-route-caption" x={10} y={188}>
          {route.caption}
        </text>
      </svg>
    </div>
  );
}
