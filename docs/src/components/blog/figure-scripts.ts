// Scripted figures for the launch post. They illustrate what happens (services, apps, clients, and
// the requests between them) rather than repeating the code blocks next to them. Each script is a
// pure function of time: the server renders its final frame and the client player replays it.

export type FigureKind =
  | "integration"
  | "agents"
  | "webmcp"
  | "preview"
  | "runtimes"
  | "mcp-code"
  | "webmcp-code"
  | "agents-code"
  | "viby"
  | "agents-flow"
  | "agents-flow-stacked"
  | "agents-deploy"
  | "agents-connect"
  | "agents-site"
  | "agents-observe"
  | "landing-markdown"
  | "landing-strata";
export type IconKey =
  | "stripe"
  | "cloudflare"
  | "eve"
  | "farm"
  | "agent"
  | "phone"
  | "browser"
  | "relay"
  | "chat"
  | "tool"
  | "page";

export interface WireFrame {
  /** 0..1 how much of the connector is drawn. */
  draw: number;
  /** Position of the travelling pulse along the connector, 0..1, when one is in flight. */
  pulse?: number;
  /** 0..1 flash on the endpoint a pulse just reached ("a" is the path start, "b" the end). */
  flashA?: number;
  flashB?: number;
  /** An inactive route stays visible but recedes. */
  dim?: boolean;
}

export type PanelState = "hot" | "on" | "dim";

export interface FigureFrame {
  slots: Record<string, string>;
  wires: Record<string, WireFrame>;
  states?: Record<string, PanelState | undefined>;
}

export interface PanelSpec {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** App panels get a header; code panels put the title in the border; nodes show an icon. */
  title?: string;
  code?: boolean;
  icon?: IconKey;
  label?: string;
  sub?: string;
  /** Workflow step: icon tile, small kicker, title, and a status the player writes on the right. */
  flow?: boolean;
  kicker?: string;
  /** Logos with short names shown as the step's title instead of `label`. */
  badges?: [IconKey, string][];
}

/** Where a figure's panels and connectors sit on a stage of a given size. */
export interface FigureGeometry {
  stage: { w: number; h: number };
  panels: PanelSpec[];
  wires: Record<string, [number, number][]>;
}

export interface FigureSpec {
  /** A single-column layout of the same panels and connectors for phones (the post only). */
  narrow?: FigureGeometry;
  duration: number;
  /** Stage size in figure units; defaults to STAGE. Compact figures fit small landing cards. */
  stage?: { w: number; h: number };
  /** The complete code behind the figure; offered to copy and to screen readers. */
  source?: string;
  /** The figure shows a commented excerpt of `source`, so Copy takes the whole file. */
  excerpt?: boolean;
  label: string;
  panels: PanelSpec[];
  wires: Record<string, [number, number][]>;
  frame: (t: number) => FigureFrame;
}

// Stage coordinates; panels and connectors share this space so they stay aligned at any width.
export const STAGE = { w: 760, h: 400 };

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const prog = (t: number, at: number, d: number) => clamp((t - at) / d);
const ease = (p: number) => 1 - (1 - clamp(p)) ** 3;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const typed = (s: string, t: number, at: number, cps: number) =>
  s.slice(0, Math.max(0, Math.floor((t - at) * cps)));
/** Fades an element in by writing its opacity onto its own opening tag. */
const shown = (html: string, t: number, at: number) =>
  t < at
    ? ""
    : html.replace(/^<span /, `<span style="opacity:${ease(prog(t, at, 0.25)).toFixed(3)}" `);
const spinner = (t: number) => "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[Math.floor(t * 14) % 10];
const PULSE = 0.42;
const caret = '<span class="bf-caret"></span>';
const fade = (html: string, t: number, at: number) =>
  t < at ? "" : `<span style="opacity:${ease(prog(t, at, 0.25)).toFixed(3)}">${html}</span>`;
const hl = (s: string) =>
  esc(s)
    .replace(/("[^"]*"?|`[^`]*`?)/g, '<span class="bf-s">$1</span>')
    .replace(
      /\b(import|export|default|from|const|async|await|return|function|if|throw|new|type)\b/g,
      '<span class="bf-k">$1</span>',
    );
const mark = (n: number, t: number, at: number) =>
  t < at
    ? ""
    : `<span class="bf-mark" style="opacity:${ease(prog(t, at, 0.2)).toFixed(3)}">${n}</span>`;
/** Renders verbatim code lines; `hot` lines get the edit highlight, `marks` add numbered callouts. */
function codeLines(
  lines: string[],
  t: number,
  opts: {
    hot?: (i: number) => boolean;
    marks?: Record<number, [number, number]>;
    typed?: Record<number, [number, number]>;
  } = {},
) {
  return lines
    .map((l, i) => {
      const ty = opts.typed?.[i];
      let html = hl(l);
      if (ty) {
        const [at, cps] = ty;
        const typing = t >= at - 0.3 && t < at + l.length / cps + 0.3;
        html = t < at - 0.3 ? "" : hl(typed(l, t, at, cps)) + (typing ? caret : "");
      }
      const m = opts.marks?.[i];
      if (m) html += mark(m[0], t, m[1]);
      return line(html, opts.hot?.(i) ? "bf-add" : "");
    })
    .join("");
}
const line = (html: string, cls = "") =>
  `<span class="bf-line${cls ? ` ${cls}` : ""}">${html || " "}</span>`;

function wire(
  t: number,
  drawAt: number,
  pulses: [number, boolean?][] = [],
  dim = false,
): WireFrame {
  const out: WireFrame = { draw: ease(prog(t, drawAt, 0.5)), dim };
  for (const [at, forward = true] of pulses) {
    if (t >= at && t < at + PULSE) out.pulse = forward ? (t - at) / PULSE : 1 - (t - at) / PULSE;
    const since = t - (at + PULSE);
    if (since >= 0 && since < 0.35) {
      const k = 1 - since / 0.35;
      if (forward) out.flashB = Math.max(out.flashB ?? 0, k);
      else out.flashA = Math.max(out.flashA ?? 0, k);
    }
  }
  return out;
}

/** A panel is "hot" briefly after a pulse lands on it. */
const hotAfter = (t: number, arrivals: number[]) =>
  arrivals.some((at) => t >= at + PULSE && t < at + PULSE + 0.45);

/* ---------- farm add integration stripe ---------- */

const integration: FigureSpec = {
  duration: 5.2,
  label:
    "farm add integration stripe creates the integration, updates config, and lists its environment",
  panels: [
    { id: "term", title: "Terminal", x: 0, y: 28, w: 450, h: 262, code: true },
    { id: "env", title: "Environment", x: 0, y: 318, w: 450, h: 82 },
    { id: "files", title: "Files", x: 490, y: 28, w: 270, h: 372 },
  ],
  wires: {
    run: [
      [450, 116],
      [490, 116],
    ],
    loop: [
      [330, 28],
      [330, 10],
      [640, 10],
      [640, 28],
    ],
    env: [
      [225, 290],
      [225, 318],
    ],
  },
  frame(t) {
    const cmd = "farm add integration stripe";
    const c0 = 0.35;
    const cDone = c0 + cmd.length / 22;
    const out = [
      ["Added stripe integration as appIntegrations.billing", cDone + 0.25, "bf-hi"],
      ["Created:", cDone + 0.45, "bf-dim"],
      ["  src/lib/integrations/stripe.ts", cDone + 0.6, ""],
      ["  src/lib/integrations.ts", cDone + 0.75, ""],
      ["Updated:", cDone + 0.95, "bf-dim"],
      ["  farm.config.ts", cDone + 1.1, ""],
      ["  package.json", cDone + 1.25, ""],
    ] as const;
    let term = line(
      `<span class="bf-dim">$ </span><span class="bf-hi">${esc(typed(cmd, t, c0, 22))}</span>${t >= c0 - 0.3 && t < cDone + 0.25 ? caret : ""}`,
    );
    for (const [text, at, cls] of out) term += t >= at ? line(fade(esc(text), t, at), cls) : "";

    // A file row lights when the pulse carrying it arrives.
    const files = [
      ["src/", 0, "", 0],
      ["lib/", 1, "", 0],
      ["integrations/", 2, "", 0],
      ["stripe.ts", 3, "A", cDone + 0.6],
      ["integrations.ts", 2, "A", cDone + 0.75],
      ["farm.config.ts", 0, "M", cDone + 1.1],
      ["package.json", 0, "M", cDone + 1.25],
    ] as const;
    const arrive = 0.42;
    const filesHtml = files
      .map(([name, depth, flag, at]) => {
        const shown = !flag || t >= at + arrive;
        const hot = flag && t >= at + arrive && t < at + arrive + 0.5;
        const folder = name.endsWith("/");
        return (
          `<span class="bf-file${hot ? " bf-hot" : ""}" style="padding-left:${depth * 1.1}em;opacity:${shown ? 1 : 0.28}">` +
          `<span class="bf-glyph">${folder ? "▸" : "·"}</span>${esc(name)}` +
          `<span class="bf-flag">${flag && shown ? flag : ""}</span></span>`
        );
      })
      .join("");

    const envAt = cDone + 1.55;
    const env = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]
      .map((key, i) => fade(`<span class="bf-env">${key}</span>`, t, envAt + 0.42 + i * 0.12))
      .join("");

    return {
      slots: { term, files: filesHtml, env },
      wires: {
        run: wire(t, 0.2, [[cDone + 0.6], [cDone + 0.75], [cDone + 1.1], [cDone + 1.25]]),
        loop: wire(t, 0.35, [[cDone + 0.25]]),
        env: wire(t, 0.5, [[envAt]]),
      },
    };
  },
};

/* ---------- one config line picks the runtime; the app's chat talks to it through tools ---------- */

// iMessage-style tail: filled like the bubble, stroked only on its outer curve, tucked over the corner.
const TAIL =
  '<svg class="bf-tail" viewBox="0 0 16 18" aria-hidden="true"><path class="bf-tail-fill" d="M7.5 2C7.5 10 5 14.5.8 17c4.2.6 8.7-.5 11.2-3.4h1.3V2z"/><path class="bf-tail-line" d="M7.5 2C7.5 10 5 14.5.8 17c4.2.6 8.7-.5 11.2-3"/></svg>';

function bubbles(
  t: number,
  at: number,
  ask: string,
  [tool, result]: [string, string],
  answer: string,
): { html: string; toolAt: number; done: number } {
  const toolAt = at + 0.55;
  const done = toolAt + 0.7;
  const words = answer.split(" ");
  const n = Math.floor(Math.max(0, t - done - 0.25) * 14);
  let html =
    t >= at ? shown(`<span class="bf-bubble bf-bubble--you">${esc(ask)}${TAIL}</span>`, t, at) : "";
  if (t >= toolAt) {
    const running = t < done;
    html += shown(
      `<span class="bf-tool"><span class="bf-tool-name">${esc(tool)}</span><span class="bf-tool-state">${running ? spinner(t) : "✓"}</span>${running ? "" : `<span class="bf-tool-result">${esc(result)}</span>`}</span>`,
      t,
      toolAt,
    );
  }
  if (t >= done + 0.15) {
    const body = n === 0 ? `<span class="bf-dim">…</span>` : esc(words.slice(0, n).join(" "));
    html += `<span class="bf-bubble">${body}${TAIL}</span>`;
  }
  return { html, toolAt, done };
}

const agents: FigureSpec = {
  duration: 8.2,
  label:
    "The app's chat runs on Eve, then on Cloudflare Agents after a one-line config change; each runtime answers by calling a tool",
  panels: [
    { id: "eve", x: 0, y: 44, w: 180, h: 120, icon: "eve", label: "Eve", sub: "/eve" },
    {
      id: "cf",
      x: 0,
      y: 236,
      w: 180,
      h: 120,
      icon: "cloudflare",
      label: "Cloudflare Agents",
      sub: "one Worker",
    },
    { id: "chat", x: 260, y: 28, w: 500, h: 372, title: "Your app · /support" },
  ],
  wires: {
    eve: [
      [180, 104],
      [220, 104],
      [220, 214],
      [260, 214],
    ],
    cf: [
      [180, 296],
      [220, 296],
      [220, 214],
      [260, 214],
    ],
  },
  frame(t) {
    const swap = 3.7;
    const onCf = t >= swap;
    const one = bubbles(
      t,
      0.6,
      "Why is checkout failing?",
      ["inspect_route", "500 · missing STRIPE_SECRET_KEY"],
      "The Stripe key isn't set. Add it to .env and restart.",
    );
    const two = bubbles(
      t,
      swap + 0.7,
      "Does my state survive a deploy?",
      ["this.sql", "142 rows"],
      "Yes. Each agent is a Durable Object with its own SQLite storage.",
    );
    const chat = onCf
      ? `<span class="bf-note">Now on Cloudflare Agents</span>${two.html}`
      : `<span class="bf-stack" style="opacity:${(1 - prog(t, swap - 0.3, 0.3)).toFixed(3)}">${one.html}</span>`;
    return {
      slots: {
        chat: `<span class="bf-stack">${chat}</span>`,
        "chat:meta": onCf ? "cfAgent()" : "eve()",
      },
      wires: {
        eve: wire(t, 0.2, [[one.toolAt, false], [one.done - PULSE]], onCf),
        cf: wire(t, 0.3, [[swap - 0.05, false], [two.toolAt, false], [two.done - PULSE]], !onCf),
      },
      states: {
        eve: onCf ? "dim" : t >= one.toolAt && t < one.done + 0.2 ? "hot" : "on",
        cf: onCf ? (t >= two.toolAt && t < two.done + 0.2 ? "hot" : "on") : "dim",
      },
    };
  },
};

/* ---------- WebMCP: the page offers a tool, the browser's agent uses it ---------- */

const PRODUCTS = ["Keyboard", "Desk mat", "USB-C hub", "Keycaps", "Monitor arm", "Wrist rest"];

const webmcp: FigureSpec = {
  duration: 5.8,
  label:
    "The page registers a search tool; the browser's agent calls it and the page filters its products",
  panels: [
    { id: "agent", x: 0, y: 140, w: 180, h: 120, icon: "agent", label: "Browser agent" },
    { id: "page", x: 260, y: 50, w: 500, h: 300, title: "/shop" },
  ],
  wires: {
    call: [
      [180, 200],
      [260, 200],
    ],
    loop: [
      [90, 140],
      [90, 24],
      [620, 24],
      [620, 50],
    ],
  },
  frame(t) {
    const register = 0.8;
    const call = 2.0;
    const result = call + 0.9;
    const filtered = ease(prog(t, result, 0.35));
    const grid = PRODUCTS.map((name) => {
      const hit = /key/i.test(name);
      return `<span class="bf-card${hit && filtered > 0.5 ? " bf-hot" : ""}" style="opacity:${hit ? 1 : (1 - 0.72 * filtered).toFixed(3)}"><span class="bf-ph"></span>${name}</span>`;
    }).join("");
    const tool =
      t >= register
        ? shown(
            `<span class="bf-tool bf-tool--tag"><span class="bf-tool-name">search_products</span><span class="bf-tool-state">registered</span></span>`,
            t,
            register,
          )
        : "";
    const agentBody =
      (t >= call - 0.3
        ? `<span class="bf-mini">${esc(typed('search("key")', t, call - 0.3, 26))}</span>`
        : "") +
      (t >= result + 0.45
        ? shown(`<span class="bf-mini bf-hi">2 results</span>`, t, result + 0.45)
        : "");
    return {
      slots: {
        page: `${tool}<span class="bf-grid">${grid}</span>`,
        agent: agentBody,
        "page:meta": t >= register ? "1 tool" : "",
      },
      wires: {
        call: wire(t, 0.2, [[register, false], [call], [result, false]]),
        loop: wire(t, 0.4, [[register + 0.2]]),
      },
      states: {
        agent:
          hotAfter(t, [register - 0.02]) || (t >= result + 0.4 && t < result + 0.9) ? "hot" : "on",
        page: hotAfter(t, [call]) ? "hot" : undefined,
      },
    };
  },
};

/* ---------- farm preview: the outside world reaches localhost through a public URL ---------- */

const preview: FigureSpec = {
  duration: 6.4,
  label:
    "farm preview gives the local app a public URL; a phone, a teammate, and a Stripe webhook reach localhost through the relay",
  panels: [
    { id: "local", x: 0, y: 150, w: 170, h: 100, icon: "farm", label: "localhost:3000" },
    { id: "relay", x: 220, y: 150, w: 280, h: 100, icon: "relay", label: "Public URL" },
    { id: "phone", x: 560, y: 30, w: 200, h: 100, icon: "phone", label: "Phone" },
    { id: "mate", x: 560, y: 150, w: 200, h: 100, icon: "browser", label: "Teammate" },
    { id: "hook", x: 560, y: 270, w: 200, h: 100, icon: "stripe", label: "Stripe webhook" },
  ],
  wires: {
    tunnel: [
      [170, 200],
      [220, 200],
    ],
    phone: [
      [500, 200],
      [530, 200],
      [530, 80],
      [560, 80],
    ],
    mate: [
      [500, 200],
      [560, 200],
    ],
    hook: [
      [500, 200],
      [530, 200],
      [530, 320],
      [560, 320],
    ],
  },
  frame(t) {
    const open = 0.9;
    const url = "checkout-test.preview.farmjs.dev";
    // Each request comes in from its client, crosses the tunnel to localhost, and the response returns.
    const reqs = [
      ["phone", 1.6, "200"],
      ["mate", 2.5, "200"],
      ["hook", 3.4, "200 · verified"],
    ] as const;
    const slots: Record<string, string> = {
      relay:
        t >= open
          ? shown(`<span class="bf-mini bf-hi">${url}</span>`, t, open)
          : `<span class="bf-mini bf-dim">opening tunnel ${spinner(t)}</span>`,
    };
    const wires: Record<string, WireFrame> = {};
    const states: Record<string, PanelState | undefined> = {};
    const tunnelPulses: [number, boolean?][] = [];
    for (const [id, at, status] of reqs) {
      const cross = at + PULSE;
      const back = cross + PULSE + 0.1;
      const home = back + PULSE;
      tunnelPulses.push([cross, false], [back]);
      wires[id] = wire(t, 0.4, [[at, false], [home]]);
      slots[id] =
        t >= home + PULSE
          ? shown(`<span class="bf-mini bf-hi">${status}</span>`, t, home + PULSE)
          : t >= at
            ? `<span class="bf-mini bf-dim">${spinner(t)}</span>`
            : "";
      states[id] = hotAfter(t, [home]) ? "hot" : undefined;
    }
    wires.tunnel = wire(t, 0.2, tunnelPulses);
    states.local = tunnelPulses.some(
      ([at, fwd]) => fwd === false && t >= at + PULSE && t < at + PULSE + 0.35,
    )
      ? "hot"
      : "on";
    states.relay = t >= open && t < open + 0.45 ? "hot" : undefined;
    return { slots, wires, states };
  },
};

/* ---------- code merged with what it does: the post shows these blocks inside the figures ---------- */

// Code and demo share the stage in equal halves. A figure shows a commented excerpt that fits its
// half; `source` keeps the complete file for Copy and screen readers.
const HALF = 360;
const DEMO_X = 400;
/** Vertical centre of line `i` in a code panel whose top edge is at `top` (0.88em code type). */
const codeY = (top: number, i: number) => top + 29 + i * 19;
const at = (lines: string[], text: string) => lines.findIndex((l) => l.includes(text));

const ROUTE_LINES: string[] = [
  "// src/app/api/projects/route.ts",
  'import { createEndpoint, type EndpointMiddlewareContext } from "@farm.js/core/api";',
  'import { z } from "zod";',
  'import { getSession } from "../../../lib/auth";',
  'import { listProjects } from "../../../lib/projects";',
  "",
  "async function requireProjectAccess({ request }: EndpointMiddlewareContext) {",
  "  const session = await getSession(request);",
  '  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });',
  '  if (!session.scopes.includes("projects:read")) {',
  '    return Response.json({ error: "Forbidden" }, { status: 403 });',
  "  }",
  "  return { userId: session.user.id };",
  "}",
  "",
  "export const GET = createEndpoint(",
  '  "/api/projects",',
  "  {",
  '    method: "GET",',
  '    query: z.object({ status: z.enum(["active", "planned"]).optional() }),',
  "    middleware: [requireProjectAccess],",
  "  },",
  "  async ({ query, context }) => ({",
  "    projects: await listProjects(context.userId, query.status),",
  "  }),",
  ");",
];
const ROUTE_VIEW: string[] = [
  "// src/app/api/projects/route.ts",
  "",
  "async function requireProjectAccess(ctx) {",
  "  // 401 without a session, 403 without the",
  "  // projects:read scope, else { userId }",
  "}",
  "",
  "export const GET = createEndpoint(",
  '  "/api/projects",',
  "  {",
  '    method: "GET",',
  "    query: z.object({",
  '      status: z.enum(["active", "planned"])',
  "        .optional(),",
  "    }),",
  "    middleware: [requireProjectAccess],",
  "  },",
  "  // HTTP requests and MCP calls both land here",
  "  async ({ query, context }) => ({",
  "    projects: await listProjects(",
  "      context.userId,",
  "      query.status,",
  "    ),",
  "  }),",
  ");",
];
const R_MW = at(ROUTE_VIEW, "async function");
const R_HANDLER = at(ROUTE_VIEW, "async ({ query");
const R_H = codeY(0, ROUTE_VIEW.length) - 10;
/** Vertical centre of line `i` in the MCP client log, below its header. */
const logY = (i: number) => 28 + 50 + i * 19;

const mcpCode: FigureSpec = {
  duration: 7.4,
  stage: { w: 760, h: 28 + R_H },
  source: ROUTE_LINES.join("\n"),
  excerpt: true,
  label:
    "An MCP client calls list_projects; the request runs the route's middleware and handler, then the projects come back",
  panels: [
    {
      id: "route",
      x: 0,
      y: 28,
      w: HALF,
      h: R_H,
      code: true,
      title: "route.ts",
    },
    { id: "client", x: DEMO_X, y: 28, w: HALF, h: R_H, title: "MCP client" },
  ],
  wires: {
    call: [
      [DEMO_X, logY(0)],
      [374, logY(0)],
      [374, codeY(28, R_MW)],
      [HALF, codeY(28, R_MW)],
    ],
    back: [
      [HALF, codeY(28, R_HANDLER)],
      [386, codeY(28, R_HANDLER)],
      [386, logY(8)],
      [DEMO_X, logY(8)],
    ],
  },
  frame(t) {
    const call = 0.9;
    const guard = call + PULSE;
    const handler = guard + 1.0;
    const reply = handler + 0.9;
    const middleware = (i: number) => i >= R_MW && i <= R_MW + 3;
    const handlerLines = (i: number) => i >= R_HANDLER && i <= R_HANDLER + 5;
    const route = codeLines(ROUTE_VIEW, t, {
      hot: (i) =>
        (t >= guard && t < handler && middleware(i)) ||
        (t >= handler && t < reply + 0.6 && handlerLines(i)),
      marks: { [R_MW]: [1, guard], [R_HANDLER]: [2, handler] },
    });
    // The client log is formatted like the code beside it: one JSON-RPC exchange, indented.
    const req = "tools/call list_projects";
    const sent = 0.2 + req.length / 40;
    const rows: [number, string][] = [
      [
        0,
        `<span class="bf-dim">→ </span><span class="bf-hi">${esc(typed(req, t, 0.2, 40))}</span>`,
      ],
      [sent, hl("{")],
      [sent, hl('  "status": "active"')],
      [sent, hl("}")],
      [sent, ""],
      [guard + 0.2, `<span class="bf-dim">✓ </span>requireProjectAccess`],
      [handler + 0.1, `<span class="bf-dim">✓ </span>handler`],
      [reply + PULSE, ""],
      [reply + PULSE, `<span class="bf-dim">← </span>200`],
      [reply + PULSE, hl("{")],
      [reply + PULSE, hl('  "projects": [')],
      [reply + PULSE, hl('    { "name": "Launch", "status": "active" }')],
      [reply + PULSE, hl("  ]")],
      [reply + PULSE, hl("}")],
    ];
    const log = rows
      .filter(([from]) => t >= from)
      .map(([from, html]) => (from > 0 && html ? line(fade(html, t, from)) : line(html)))
      .join("");
    return {
      slots: { route, client: log, "client:meta": "/api/mcp" },
      wires: { call: wire(t, 0.2, [[call]]), back: wire(t, 0.3, [[reply]]) },
      states: { client: hotAfter(t, [reply]) ? "hot" : undefined },
    };
  },
};

const WEBMCP_LINES: string[] = [
  "// src/components/projects-agent-tools.ts",
  '"use client";',
  "",
  'import { useEffect } from "react";',
  'import { defineWebMCPTool, registerWebMCPTool } from "@farm.js/webmcp/client";',
  'import { z } from "zod";',
  "",
  'const input = z.object({ status: z.enum(["active", "planned"]).optional() });',
  "const listProjects = defineWebMCPTool({",
  '  name: "list_projects",',
  '  description: "List the signed-in user\'s projects.",',
  "  inputSchema: z.toJSONSchema(input),",
  "  validate: input,",
  "  annotations: { readOnlyHint: true },",
  "  async execute({ status }, { signal }) {",
  '    const query = status ? `?status=${encodeURIComponent(status)}` : "";',
  "    const response = await fetch(`/api/projects${query}`, { signal });",
  "    if (!response.ok) throw new Error(`Project lookup failed: ${response.status}`);",
  "    return response.json();",
  "  },",
  "});",
  "",
  "export function ProjectsAgentTools() {",
  "  useEffect(() => registerWebMCPTool(listProjects), []);",
  "  return null;",
  "}",
];
const WEBMCP_VIEW: string[] = [
  "// src/components/projects-agent-tools.ts",
  '"use client";',
  "",
  "const listProjects = defineWebMCPTool({",
  '  name: "list_projects",',
  '  description: "List the user\'s projects.",',
  "  // + zod input schema and readOnlyHint",
  "  async execute({ status }, { signal }) {",
  "    // fetch /api/projects as the signed-in",
  "    // user; the server still checks access",
  "  },",
  "});",
  "",
  "export function ProjectsAgentTools() {",
  "  // the tool exists only while this is mounted",
  "  useEffect(() =>",
  "    registerWebMCPTool(listProjects), []);",
  "  return null;",
  "}",
];
const PROJECTS: [string, string][] = [
  ["Launch site", "active"],
  ["Docs refresh", "planned"],
  ["Billing", "active"],
];
const W_EXEC = at(WEBMCP_VIEW, "async execute");
const W_REG = at(WEBMCP_VIEW, "registerWebMCPTool(");
const W_H = codeY(0, WEBMCP_VIEW.length) - 10;
const PAGE_H = 170;
// The agent and the page sit in a row under the code, as in the post's original layout.
const W_ROW = 28 + W_H + 32;

const webmcpCode: FigureSpec = {
  duration: 7.6,
  stage: { w: 760, h: W_ROW + PAGE_H },
  source: WEBMCP_LINES.join("\n"),
  excerpt: true,
  label:
    "The component registers list_projects; the browser's agent calls it, execute fetches the projects, and the page shows the active ones",
  panels: [
    {
      id: "code",
      x: 0,
      y: 28,
      w: 760,
      h: W_H,
      code: true,
      title: "src/components/projects-agent-tools.ts",
    },
    { id: "agent", x: 0, y: W_ROW + 30, w: 200, h: 130, icon: "agent", label: "Browser agent" },
    { id: "page", x: 260, y: W_ROW, w: 500, h: PAGE_H, title: "/projects" },
  ],
  wires: {
    register: [
      [690, 28 + W_H],
      [690, W_ROW],
    ],
    execute: [
      [420, W_ROW],
      [420, 28 + W_H],
    ],
    call: [
      [200, W_ROW + 95],
      [260, W_ROW + 95],
    ],
  },
  frame(t) {
    const reg = 0.6;
    const call = 2.0;
    const run = call + PULSE + 0.15;
    const done = run + 1.1;
    const listed = done + PULSE + 0.2;
    const executeLines = (i: number) => i >= W_EXEC && i <= W_EXEC + 3;
    const code = codeLines(WEBMCP_VIEW, t, {
      hot: (i) =>
        (t >= reg - 0.2 && t < reg + 1.2 && (i === W_REG || i === W_REG - 1)) ||
        (t >= run && t < done + 0.3 && executeLines(i)),
      marks: { [W_REG]: [1, reg], [W_EXEC]: [2, run] },
    });
    const filtered = ease(prog(t, listed, 0.35));
    const rows = PROJECTS.map(([name, status]) => {
      const hit = status === "active";
      return `<span class="bf-row${hit && filtered > 0.5 ? " bf-hot" : ""}" style="opacity:${hit ? 1 : (1 - 0.7 * filtered).toFixed(3)}"><span class="bf-dot${hit && filtered > 0.5 ? " bf-dot--on" : ""}"></span>${name}<span class="bf-flag">${status}</span></span>`;
    }).join("");
    const agent =
      (t >= call - 0.4
        ? `<span class="bf-mini">${esc(typed('list_projects("active")', t, call - 0.4, 30))}</span>`
        : "") +
      (t >= listed + PULSE
        ? shown(`<span class="bf-mini bf-hi">2 projects</span>`, t, listed + PULSE)
        : "");
    return {
      slots: { code, page: rows, agent, "page:meta": t >= reg + PULSE ? "1 tool" : "" },
      wires: {
        register: wire(t, 0.2, [[reg]]),
        execute: wire(t, 0.3, [[run - PULSE + 0.1], [done, false]]),
        call: wire(t, 0.4, [[call], [listed, false]]),
      },
      states: {
        page: hotAfter(t, [reg]) ? "hot" : undefined,
        agent:
          (t >= call - 0.4 && t < call + 0.3) || (t >= listed + PULSE && t < listed + PULSE + 0.5)
            ? "hot"
            : "on",
      },
    };
  },
};

const EVE_LINES: string[] = [
  "// farm.config.ts — an Eve app",
  'import { defineConfig } from "@farm.js/core";',
  'import { eve } from "@farm.js/eve";',
  "",
  "export default defineConfig({",
  "  integrations: { agent: eve() },",
  "});",
];
const CF_LINES: string[] = [
  "// farm.config.ts — a Cloudflare Agents app",
  'import { defineConfig } from "@farm.js/core";',
  'import { cfAgent } from "@farm.js/cf-agent";',
  "",
  "export default defineConfig({",
  "  integrations: { agent: cfAgent() },",
  '  deploy: { preset: "cloudflare-module" },',
  "});",
];
const A_LINE = at(CF_LINES, "agent:");
const A_H = 250;

const agentsCode: FigureSpec = {
  duration: 8.8,
  stage: { w: 760, h: 28 + A_H },
  source: `${EVE_LINES.join("\n")}\n\n${CF_LINES.join("\n")}`,
  label:
    "The Eve config runs the chat on Eve; switching to the Cloudflare Agents config runs the same chat on Cloudflare, each answering through a tool",
  panels: [
    { id: "config", x: 0, y: 28, w: HALF, h: A_H, code: true, title: "farm.config.ts" },
    { id: "chat", x: DEMO_X, y: 28, w: HALF, h: A_H, title: "localhost:3000" },
  ],
  wires: {
    run: [
      [HALF, codeY(28, A_LINE)],
      [DEMO_X, codeY(28, A_LINE)],
    ],
    loop: [
      [180, 28],
      [180, 10],
      [DEMO_X + 180, 10],
      [DEMO_X + 180, 28],
    ],
  },
  frame(t) {
    const swap = 4.0;
    const onCf = t >= swap;
    const glitching = t >= swap - 0.35 && t < swap;
    const lines = onCf ? CF_LINES : EVE_LINES;
    const deployLine = at(CF_LINES, "deploy:");
    const noise = (l: string, k: number) =>
      [...l]
        .map((c, j) =>
          c !== " " && (j * 7 + k + Math.floor(t * 24)) % 5 === 0 ? "#*/01_"[(j + k) % 6] : c,
        )
        .join("");
    const shownLines = glitching
      ? EVE_LINES.map((l, i) => (i === 0 || i === 2 || i === A_LINE ? noise(l, i) : l))
      : lines;
    const config = codeLines(shownLines, t, {
      hot: (i) => i === A_LINE || (onCf && i === deployLine && t < swap + 1.4),
      marks: onCf ? { [A_LINE]: [2, swap + 0.3] } : { [A_LINE]: [1, 0.5] },
      typed: onCf ? { [deployLine]: [swap + 0.15, 45] } : undefined,
    });
    const one = bubbles(
      t,
      0.9,
      "Why is checkout failing?",
      ["inspect_route", "500 · no STRIPE_SECRET_KEY"],
      "The Stripe key isn't set. Add it to .env.",
    );
    const two = bubbles(
      t,
      swap + 0.9,
      "Does state survive a deploy?",
      ["this.sql", "142 rows"],
      "Yes. It's a Durable Object with SQLite storage.",
    );
    const chat = onCf
      ? `<span class="bf-note">Now on Cloudflare</span>${two.html}`
      : `<span class="bf-stack" style="opacity:${(1 - prog(t, swap - 0.3, 0.3)).toFixed(3)}">${one.html}</span>`;
    return {
      slots: {
        config,
        chat: `<span class="bf-stack">${chat}</span>`,
        "chat:meta": onCf ? "cfAgent()" : "eve()",
      },
      wires: {
        run: wire(t, 0.2, [[0.6], [swap + 0.35]]),
        loop: wire(t, 0.3, [
          [one.toolAt, false],
          [two.toolAt, false],
        ]),
      },
    };
  },
};

/* ---------- landing: the app's origin routes to each agent runtime ---------- */

const runtimes: FigureSpec = {
  duration: 4.4,
  stage: { w: 448, h: 280 },
  label:
    "Farm connects the app's origin to Eve on Vercel at /eve and to Cloudflare Agents on Workers at /agents",
  panels: [
    { id: "app", x: 0, y: 95, w: 132, h: 90, icon: "farm", label: "Your app", sub: "same origin" },
    { id: "eve", x: 288, y: 18, w: 160, h: 96, icon: "eve", label: "Eve", sub: "Vercel" },
    {
      id: "cf",
      x: 288,
      y: 166,
      w: 160,
      h: 96,
      icon: "cloudflare",
      label: "Cloudflare Agents",
      sub: "Workers",
    },
  ],
  wires: {
    eve: [
      [132, 140],
      [210, 140],
      [210, 66],
      [288, 66],
    ],
    cf: [
      [132, 140],
      [210, 140],
      [210, 214],
      [288, 214],
    ],
  },
  frame(t) {
    const toEve = 0.5;
    const toCf = 2.3;
    const route = (path: string, active: boolean) =>
      `<span class="bf-mini${active ? " bf-hi" : " bf-dim"}">${path}</span>`;
    const eveActive = t >= toEve && t < toEve + 2 * PULSE + 0.4;
    const cfActive = t >= toCf && t < toCf + 2 * PULSE + 0.4;
    return {
      slots: { eve: route("/eve/*", eveActive), cf: route("/agents/*", cfActive) },
      wires: {
        eve: wire(t, 0.1, [[toEve], [toEve + PULSE + 0.2, false]]),
        cf: wire(t, 0.2, [[toCf], [toCf + PULSE + 0.2, false]]),
      },
      states: {
        eve: hotAfter(t, [toEve]) ? "hot" : undefined,
        cf: hotAfter(t, [toCf]) ? "hot" : undefined,
        app: hotAfter(t, [toEve + PULSE + 0.2, toCf + PULSE + 0.2]) ? "hot" : undefined,
      },
    };
  },
};

/* ---------- landing: Viby, a vibe coding product built on Farm ---------- */

const VIBY_TOOLS: [string, string, string, string][] = [
  ["↳", "READ", "pricing.tsx", ""],
  ["✎", "WRITE", "pricing.tsx", "+84"],
  ["$", "SHELL", "farm build", "✓"],
];
const VIBY_VERSIONS: [string, string][] = [
  ["v1", "scaffold"],
  ["v2", "hero + nav"],
  ["v3", "pricing page"],
];
// Preview wireframe blocks as [left %, top %, width %, height %]; the fourth is the chosen plan.
const VIBY_BLOCKS: [number, number, number, number][] = [
  [0, 0, 100, 10],
  [0, 17, 60, 18],
  [0, 43, 31, 57],
  [34.5, 43, 31, 57],
  [69, 43, 31, 57],
];
const vrow = (html: string, cls = "") =>
  `<span class="bf-vrow${cls ? ` ${cls}` : ""}">${html}</span>`;

const viby: FigureSpec = {
  duration: 5.2,
  stage: { w: 440, h: 300 },
  label:
    "Viby takes a prompt in a durable chat, its tools read, write, and build the workspace, the result is saved as an immutable version, and the sandbox preview is ready",
  panels: [
    { id: "chat", x: 0, y: 0, w: 205, h: 128, title: "Chat" },
    { id: "versions", x: 235, y: 0, w: 205, h: 128, title: "Versions" },
    { id: "workspace", x: 0, y: 158, w: 205, h: 142, title: "Workspace" },
    { id: "preview", x: 235, y: 158, w: 205, h: 142, title: "Preview" },
  ],
  wires: {
    ask: [
      [102, 128],
      [102, 158],
    ],
    save: [
      [205, 240],
      [220, 240],
      [220, 143],
      [300, 143],
      [300, 128],
    ],
    ship: [
      [380, 128],
      [380, 158],
    ],
  },
  frame(t) {
    const ask = "Build a pricing page";
    const a0 = 0.35;
    const aDone = a0 + ask.length / 30;
    const p1 = aDone + 0.3;
    const p2 = p1 + 0.3 + VIBY_TOOLS.length * 0.18 + 0.05;
    const v3 = p2 + 0.35;
    const p3 = v3 + 0.15;
    const ready = p3 + 0.75;
    const chat =
      `<span class="bf-note">You</span>` +
      `<span class="bf-hi bf-vtext">${esc(typed(ask, t, a0, 30))}${t >= a0 - 0.2 && t < aDone + 0.2 ? caret : ""}</span>` +
      (t > aDone + 0.25
        ? `<span class="bf-note bf-vgap">Viby</span><span class="bf-vtext">${
            t < ready
              ? `Generating${".".repeat(1 + (Math.floor(t * 6) % 3))}`
              : "Done. Saved as v3."
          }</span>`
        : "");
    const workspace = VIBY_TOOLS.map(([icon, kind, file, result], i) => {
      const at = p1 + 0.3 + i * 0.18;
      if (t < at) return "";
      return vrow(
        `<span class="bf-dim">${icon}</span><span class="bf-dim">${kind}</span><span class="bf-hi">${esc(file)}</span><span class="bf-r">${result}</span>`,
        t < at + 0.25 ? "bf-von" : "",
      ).replace("<span ", `<span style="opacity:${ease(prog(t, at, 0.2)).toFixed(3)}" `);
    }).join("");
    const versions = VIBY_VERSIONS.map(([v, name], i) => {
      if (i === 2 && t < v3) return "";
      const row = vrow(
        `<span class="bf-dim">${v}</span><span${i === 2 ? ' class="bf-hi"' : ""}>${name}</span><span class="bf-r">⌁</span>`,
        i === 2 && t < v3 + 0.5 ? "bf-von" : "",
      );
      return i === 2
        ? row.replace("<span ", `<span style="opacity:${ease(prog(t, v3, 0.25)).toFixed(3)}" `)
        : row;
    }).join("");
    const preview = `<span class="bf-vprev">${VIBY_BLOCKS.map(([x, y, w, h], i) => {
      const k = ease(prog(t, p3 + 0.35 + i * 0.1, 0.3));
      return `<span class="bf-vblock${i === 3 ? " bf-vblock--on" : ""}" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%;opacity:${k.toFixed(3)}"></span>`;
    }).join("")}</span>`;
    return {
      slots: {
        chat,
        "chat:meta": "durable",
        workspace,
        "workspace:meta": "tools",
        versions,
        "versions:meta": "immutable",
        preview,
        "preview:meta": t >= ready ? "ready ✓" : "sandbox",
      },
      wires: {
        ask: wire(t, 0.2, [[aDone + 0.3]]),
        save: wire(t, 0.3, [[p2]]),
        ship: wire(t, 0.4, [[p3]]),
      },
      states: {
        chat: t >= a0 && t < aDone + 0.3 ? "hot" : undefined,
        preview: t >= ready && t < ready + 0.6 ? "hot" : undefined,
      },
    };
  },
};

/* ---------- agents page: one visual system for every illustration ----------
 * Pills (icon tile, kicker, title, status) and list cards (header + rows) only; one step rhythm;
 * active items brighten their border slightly (agents.css), never fill. */

const BEAT = 0.8; // one step per beat across every agents-page figure
const HOLD = 2.6; // rest on the finished state before the loop restarts

/** A step's status: waiting dot, spinning ring, or a check circle. */
const step = (t: number, start: number, done: number) =>
  t >= done
    ? '<span class="bf-st bf-st--ok">✓</span>'
    : t >= start
      ? '<span class="bf-st bf-st--run"></span>'
      : '<span class="bf-st"></span>';
const busy = (t: number, start: number, done: number) =>
  t >= start && t < done ? "hot" : undefined;

/** Path-only line icons for rows inside a slot (slot HTML allows span, svg, and path). */
const glyph = (...paths: string[]) =>
  `<span class="bf-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths
    .map((d) => `<path d="${d}"/>`)
    .join("")}</svg></span>`;
const G = {
  bot: glyph(
    "M12 8V4H8",
    "M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z",
    "M2 14h2",
    "M20 14h2",
    "M15 13v2",
    "M9 13v2",
  ),
  server: glyph(
    "M4 2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z",
    "M4 14h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z",
    "M6 6h.01",
    "M6 18h.01",
  ),
  file: glyph(
    "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z",
    "M14 2v4a2 2 0 0 0 2 2h4",
    "M16 13H8",
    "M16 17H8",
  ),
  search: glyph("M11 3a8 8 0 1 0 0 16a8 8 0 1 0 0-16z", "m21 21-4.3-4.3"),
  model: glyph("M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"),
  swap: glyph("m16 3 4 4-4 4", "M20 7H4", "m8 21-4-4 4-4", "M4 17h16"),
};
type GlyphKey = keyof typeof G;

/** One list row: icon tile, name over detail, optional right-hand meta, status. */
const row = (icon: GlyphKey, name: string, sub: string, meta: string, status: string, cls = "") =>
  `<span class="bf-item${cls ? ` ${cls}` : ""}">${G[icon]}<span class="bf-item-text"><span class="bf-item-name">${name}</span><span class="bf-item-sub">${sub}</span></span>${meta ? `<span class="bf-item-meta">${meta}</span>` : ""}<span class="bf-item-state">${status}</span></span>`;

// Hero, wide screens: the original diagram (your app -> Farm.js -> agents, MCP, your site).
const FORK: [string, IconKey, string, string, number][] = [
  ["agents", "agent", "Agents", "Eve, Cloudflare", 0],
  ["mcp", "tool", "MCP", "Tools you choose", 230],
  ["site", "page", "Your site", "Markdown, WebMCP", 460],
];
/** The runtimes Farm.js integrates today, shown as their marks (the same ones as the launch film). */
const AGENT_BADGES: [IconKey, string][] = [
  ["eve", "Eve"],
  ["cloudflare", "Cloudflare"],
];
const forkFrame = (t: number): FigureFrame => {
  const reached = BEAT;
  const routed = reached + PULSE + BEAT;
  const fan = FORK.map((_, i) => routed + i * 0.35);
  const slots: Record<string, string> = { app: "", farm: "" };
  const states: Record<string, PanelState | undefined> = {
    app: busy(t, 0.2, reached),
    farm: busy(t, reached + PULSE, routed),
  };
  const wires: Record<string, WireFrame> = { in: wire(t, 0.1, [[reached]]) };
  FORK.forEach(([id], i) => {
    slots[id] = "";
    states[id] = busy(t, fan[i] + PULSE, fan[i] + PULSE + BEAT);
    wires[id] = wire(t, 0.2 + i * 0.1, [[fan[i]]]);
  });
  return { slots, wires, states };
};
const forkDuration = BEAT + PULSE + BEAT + 2 * 0.35 + PULSE + BEAT + HOLD;

const agentsFlow: FigureSpec = {
  duration: forkDuration,
  stage: { w: 660, h: 250 },
  label:
    "Your app sends every request through Farm.js, which routes it on the same origin to your agents, your MCP tools, and your agent-readable site",
  panels: [
    {
      id: "app",
      x: 230,
      y: 0,
      w: 200,
      h: 48,
      flow: true,
      icon: "browser",
      kicker: "Your app",
      label: "your-app.com",
    },
    {
      id: "farm",
      x: 210,
      y: 96,
      w: 240,
      h: 56,
      flow: true,
      icon: "farm",
      kicker: "Farm.js",
      label: "Routes it all",
    },
    ...FORK.map(([id, icon, kicker, label, x]) => ({
      id,
      x,
      y: 200,
      w: 200,
      h: 50,
      flow: true,
      icon,
      kicker,
      label,
      badges: id === "agents" ? AGENT_BADGES : undefined,
    })),
  ],
  wires: {
    in: [
      [330, 48],
      [330, 96],
    ],
    agents: [
      [330, 152],
      [330, 176],
      [100, 176],
      [100, 200],
    ],
    mcp: [
      [330, 152],
      [330, 200],
    ],
    site: [
      [330, 152],
      [330, 176],
      [560, 176],
      [560, 200],
    ],
  },
  frame: forkFrame,
};

// Hero, narrow screens: the same diagram stacked so the type stays legible on a phone.
const agentsFlowStacked: FigureSpec = {
  duration: forkDuration,
  stage: { w: 400, h: 368 },
  label: agentsFlow.label,
  panels: [
    {
      id: "app",
      x: 50,
      y: 0,
      w: 300,
      h: 48,
      flow: true,
      icon: "browser",
      kicker: "Your app",
      label: "your-app.com",
    },
    {
      id: "farm",
      x: 50,
      y: 84,
      w: 300,
      h: 56,
      flow: true,
      icon: "farm",
      kicker: "Farm.js",
      label: "Routes it all",
    },
    ...FORK.map(([id, icon, kicker, label], i) => ({
      id,
      x: 90,
      y: 176 + i * 66,
      w: 310,
      h: 50,
      flow: true,
      icon,
      kicker,
      label,
      badges: id === "agents" ? AGENT_BADGES : undefined,
    })),
  ],
  wires: {
    in: [
      [200, 48],
      [200, 84],
    ],
    ...Object.fromEntries(
      FORK.map(([id], i) => [
        id,
        [
          [70, 140],
          [70, 201 + i * 66],
          [90, 201 + i * 66],
        ],
      ]),
    ),
  },
  frame: forkFrame,
};

// 06.2 cards: the same size, the same parts, the same rhythm.
const CARD = { w: 520, h: 240 };

const DEPLOYED: [GlyphKey, string, string, string][] = [
  ["bot", "support-agent", "Eve on Vercel", "42 ms"],
  ["bot", "billing-agent", "Cloudflare Worker", "31 ms"],
  ["server", "mcp-server", "3 tools", "18 ms"],
  ["bot", "docs-agent", "Eve on Vercel", "57 ms"],
];
const agentsDeploy: FigureSpec = {
  duration: 1 + 3 * BEAT + HOLD,
  stage: CARD,
  label:
    "Your deployed agents and MCP server in one list with latency and status; a new agent finishes deploying and goes live",
  panels: [{ id: "list", x: 0, y: 0, ...CARD, title: "Deployments" }],
  wires: {},
  frame(t) {
    const start = 1;
    const live = start + 3 * BEAT;
    const rows = DEPLOYED.map(([icon, name, where, ms], i) => {
      const coming = i === 3 && t < live;
      const status = coming
        ? '<span class="bf-st bf-st--run"></span>'
        : '<span class="bf-st bf-st--live"></span>';
      return row(
        icon,
        name,
        where,
        coming ? "Deploying" : ms,
        status,
        i === 3 && t >= start && t < live ? "bf-von" : "",
      );
    }).join("");
    return {
      slots: { list: rows, "list:meta": t >= live ? "4 live" : "3 live" },
      wires: {},
      states: {},
    };
  },
};

// Clients connect to one gateway tool; Farm.js fans each call out to the MCP servers behind it.
const MCP_CLIENTS: [string, IconKey, string][] = [
  ["chat", "chat", "Chat app"],
  ["ide", "browser", "IDE agent"],
  ["own", "agent", "Your agent"],
];
const MCP_SERVERS: [string, string][] = [
  ["api", "Your API"],
  ["docs", "Docs search"],
  ["tickets", "Tickets"],
];
const LANE = (i: number) => 20 + i * 78; // top of each client / server pill
const agentsConnect: FigureSpec = {
  duration: 0.6 + 2 * 0.3 + PULSE + BEAT + 2 * 0.3 + PULSE + BEAT + HOLD,
  stage: CARD,
  label:
    "Three compatible clients connect to one gateway tool, which orchestrates the MCP servers behind it on each client's behalf",
  panels: [
    ...MCP_CLIENTS.map(([id, icon, label], i) => ({
      id,
      x: 0,
      y: LANE(i),
      w: 150,
      h: 44,
      flow: true,
      icon,
      kicker: "Client",
      label,
    })),
    {
      id: "gateway",
      x: 185,
      y: 86,
      w: 150,
      h: 68,
      flow: true,
      icon: "tool" as IconKey,
      kicker: "Gateway",
      label: "One tool",
    },
    ...MCP_SERVERS.map(([id, label], i) => ({
      id,
      x: 370,
      y: LANE(i),
      w: 150,
      h: 44,
      flow: true,
      icon: "page" as IconKey,
      kicker: "MCP server",
      label,
    })),
  ],
  wires: {
    ...Object.fromEntries(
      MCP_CLIENTS.map(([id], i): [string, [number, number][]] => [
        id,
        i === 1
          ? [
              [150, 120],
              [185, 120],
            ]
          : [
              [150, LANE(i) + 22],
              [167, LANE(i) + 22],
              [167, 120],
              [185, 120],
            ],
      ]),
    ),
    ...Object.fromEntries(
      MCP_SERVERS.map(([id], i): [string, [number, number][]] => [
        id,
        i === 1
          ? [
              [335, 120],
              [370, 120],
            ]
          : [
              [335, 120],
              [352, 120],
              [352, LANE(i) + 22],
              [370, LANE(i) + 22],
            ],
      ]),
    ),
  },
  frame(t) {
    const sent = MCP_CLIENTS.map((_, i) => 0.6 + i * 0.3);
    const gatewayStart = sent[2] + PULSE;
    const fanned = MCP_SERVERS.map((_, i) => gatewayStart + BEAT + i * 0.3);
    const answered = fanned.map((at) => at + PULSE + BEAT * 0.75);
    const gatewayDone = answered[2];
    const slots: Record<string, string> = {
      gateway: step(t, gatewayStart, gatewayDone),
    };
    const states: Record<string, PanelState | undefined> = {
      gateway: busy(t, gatewayStart, gatewayDone),
    };
    const wires: Record<string, WireFrame> = {};
    MCP_CLIENTS.forEach(([id], i) => {
      slots[id] = step(t, sent[i] - BEAT * 0.5, gatewayDone);
      wires[id] = wire(t, 0.1 + i * 0.05, [[sent[i]]]);
    });
    MCP_SERVERS.forEach(([id], i) => {
      slots[id] = step(t, fanned[i] + PULSE, answered[i]);
      states[id] = busy(t, fanned[i] + PULSE, answered[i]);
      wires[id] = wire(t, 0.25 + i * 0.05, [[fanned[i]]]);
    });
    return { slots, wires, states };
  },
};

const agentsSite: FigureSpec = {
  duration: 0.6 + PULSE + BEAT + PULSE + 4 * 0.3 + HOLD,
  stage: CARD,
  label:
    "An agent asks your site for /pricing as Markdown and receives the same content a person reads",
  panels: [
    {
      id: "agent",
      x: 0,
      y: 0,
      w: 230,
      h: 48,
      flow: true,
      icon: "agent",
      kicker: "Agent",
      label: "GET /pricing",
    },
    {
      id: "site",
      x: 290,
      y: 0,
      w: 230,
      h: 48,
      flow: true,
      icon: "page",
      kicker: "Your site",
      label: "text/markdown",
    },
    { id: "doc", x: 0, y: 96, w: 520, h: 144, title: "pricing.md" },
  ],
  wires: {
    req: [
      [230, 24],
      [290, 24],
    ],
    res: [
      [405, 48],
      [405, 96],
    ],
  },
  frame(t) {
    const asked = 0.6;
    const served = asked + PULSE + BEAT;
    const arrived = served + PULSE;
    const doc = [
      '<span class="bf-hi"># Pricing</span>',
      "- Hobby: free",
      "- Pro: $20 / month",
      "- Team: $50 / month",
    ]
      .map(
        (html, i) =>
          `<span class="bf-line" style="opacity:${ease(prog(t, arrived + i * 0.3, 0.3)).toFixed(3)}">${html}</span>`,
      )
      .join("");
    return {
      slots: {
        agent: step(t, 0.2, arrived),
        site: step(t, asked + PULSE, served),
        doc,
        "doc:meta": t >= arrived ? "200 OK" : "",
      },
      wires: {
        req: wire(t, 0.1, [[asked]]),
        res: wire(t, 0.2, [[served]]),
      },
      states: {
        agent: busy(t, 0.2, asked),
        site: busy(t, asked + PULSE, served),
      },
    };
  },
};

const TRACE: [GlyphKey, string, string, string, number][] = [
  ["swap", "request", "POST /eve", "streaming", 120],
  ["model", "model", "plan the reply", "2 tool calls", 640],
  ["search", "search_docs", 'q: "refunds"', "3 matches", 140],
  ["file", "list_projects", 'status: "active"', "2 rows", 90],
];
const agentsObserve: FigureSpec = {
  duration: 0.4 + TRACE.length * BEAT + HOLD,
  stage: CARD,
  label:
    "One agent run traced end to end: the request, the model, and each tool call with its result and duration",
  panels: [{ id: "run", x: 0, y: 0, ...CARD, title: "Run · support" }],
  wires: {},
  frame(t) {
    let done = 0;
    const rows = TRACE.map(([icon, name, args, result, ms], i) => {
      const start = 0.4 + i * BEAT;
      const end = start + BEAT * 0.75;
      const finished = t >= end;
      if (finished) done++;
      return row(
        icon,
        name,
        esc(finished ? `${args} → ${result}` : args),
        finished ? `${ms} ms` : "",
        step(t, start, end),
        t >= start && !finished ? "bf-von" : t < start ? "bf-item--wait" : "",
      );
    }).join("");
    return {
      slots: { run: rows, "run:meta": `${done} / ${TRACE.length}` },
      wires: {},
      states: {},
    };
  },
};

/* ---------- landing: Markdown mirrors and native rendering, in the agents-page visual system ---------- */

// One route answers a browser with HTML and an agent with Markdown, like the launch film's
// "readable by agents" scene.
const MIRROR_MD: [string, string][] = [
  ["bf-dim", "GET /pricing.md"],
  ["bf-hi", "# Pricing"],
  ["", "- Hobby: free"],
  ["", "- Pro: $20 / month"],
  ["", "- Team: $50 / month"],
];
const landingMarkdown: FigureSpec = {
  duration: 0.9 + PULSE + BEAT + PULSE + MIRROR_MD.length * 0.3 + HOLD,
  stage: { w: 440, h: 300 },
  label:
    "One route, /pricing, answers a browser with the HTML page and an agent with the same page as Markdown",
  panels: [
    {
      id: "route",
      x: 120,
      y: 0,
      w: 200,
      h: 48,
      flow: true,
      icon: "page",
      kicker: "One route",
      label: "/pricing",
    },
    { id: "browser", x: 0, y: 88, w: 205, h: 212, title: "Browser" },
    { id: "agent", x: 235, y: 88, w: 205, h: 212, title: "Agent" },
  ],
  wires: {
    html: [
      [190, 48],
      [190, 68],
      [102, 68],
      [102, 88],
    ],
    md: [
      [250, 48],
      [250, 68],
      [337, 68],
      [337, 88],
    ],
  },
  frame(t) {
    const html = 0.9;
    const md = html + BEAT;
    const page = html + PULSE;
    const mdAt = md + PULSE;
    const blocks = VIBY_BLOCKS.map(([x, y, w, h], i) => {
      const k = ease(prog(t, page + i * 0.12, 0.3));
      return `<span class="bf-vblock${i === 3 ? " bf-vblock--on" : ""}" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%;opacity:${k.toFixed(3)}"></span>`;
    }).join("");
    const lines = MIRROR_MD.map(
      ([cls, text], i) =>
        `<span class="bf-line${cls ? ` ${cls}` : ""}" style="opacity:${ease(prog(t, mdAt + i * 0.3, 0.3)).toFixed(3)}">${esc(text)}</span>`,
    ).join("");
    return {
      slots: {
        route: step(t, 0.3, html),
        browser: `<span class="bf-vprev">${blocks}</span>`,
        "browser:meta": t >= page ? "text/html" : "",
        agent: lines,
        "agent:meta": t >= mdAt ? "text/markdown" : "",
      },
      wires: {
        html: wire(t, 0.1, [[html]]),
        md: wire(t, 0.2, [[md]]),
      },
      states: {
        route: busy(t, 0.3, html),
        browser: busy(t, page, page + 0.6),
        agent: busy(t, mdAt, mdAt + MIRROR_MD.length * 0.3),
      },
    };
  },
};

// Native rendering, as a tool-call run: each eligibility check runs, then the region goes to Strata.
const BOUNDARY_CHECKS: [GlyphKey, string, string, string][] = [
  ["search", "Host-only tree", "no client boundary inside", "pass"],
  ["file", "Client code", "hooks and browser APIs", "none"],
  ["swap", "Events or refs", "handlers and refs", "none"],
  ["model", "Size gate", "large enough to pay off", "pass"],
  ["server", "Render", "Strata, Rust-native", "native"],
];
const landingStrata: FigureSpec = {
  duration: 0.4 + BOUNDARY_CHECKS.length * BEAT + HOLD,
  stage: { w: 440, h: 300 },
  label:
    "Farm scans a large Server Component region; once every check passes, it renders the region with Strata's Rust-native renderer",
  panels: [{ id: "scan", x: 0, y: 0, w: 440, h: 300, title: "Boundary scan · <article>" }],
  wires: {},
  frame(t) {
    let done = 0;
    const rows = BOUNDARY_CHECKS.map(([icon, name, sub, result], i) => {
      const start = 0.4 + i * BEAT;
      const end = start + BEAT * 0.75;
      const finished = t >= end;
      if (finished) done++;
      const last = i === BOUNDARY_CHECKS.length - 1;
      return row(
        icon,
        name,
        esc(sub),
        finished ? result : "",
        step(t, start, end),
        t >= start && (!finished || last) ? "bf-von" : t < start ? "bf-item--wait" : "",
      );
    }).join("");
    return {
      slots: { scan: rows, "scan:meta": `${done} / ${BOUNDARY_CHECKS.length}` },
      wires: {},
      states: {},
    };
  },
};

/* ---------- phone layouts: the same panels and connectors in one column (post figures only) ---------- */
// Stages are 360 units wide, so type renders near its desktop size on a phone instead of shrinking.

integration.narrow = {
  stage: { w: 360, h: 642 },
  panels: [
    { id: "term", title: "Terminal", x: 0, y: 28, w: 340, h: 230, code: true },
    { id: "env", title: "Environment", x: 0, y: 282, w: 340, h: 82 },
    { id: "files", title: "Files", x: 0, y: 392, w: 340, h: 250 },
  ],
  wires: {
    run: [
      [340, 120],
      [352, 120],
      [352, 517],
      [340, 517],
    ],
    env: [
      [170, 258],
      [170, 282],
    ],
  },
};

preview.narrow = {
  stage: { w: 360, h: 380 },
  panels: [
    { id: "local", x: 95, y: 0, w: 170, h: 90, icon: "farm", label: "localhost:3000" },
    { id: "relay", x: 0, y: 130, w: 360, h: 100, icon: "relay", label: "Public URL" },
    { id: "phone", x: 0, y: 280, w: 110, h: 100, icon: "phone", label: "Phone" },
    { id: "mate", x: 125, y: 280, w: 110, h: 100, icon: "browser", label: "Teammate" },
    { id: "hook", x: 250, y: 280, w: 110, h: 100, icon: "stripe", label: "Webhook" },
  ],
  wires: {
    tunnel: [
      [180, 90],
      [180, 130],
    ],
    phone: [
      [180, 230],
      [180, 255],
      [55, 255],
      [55, 280],
    ],
    mate: [
      [180, 230],
      [180, 280],
    ],
    hook: [
      [180, 230],
      [180, 255],
      [305, 255],
      [305, 280],
    ],
  },
};

const R_CLIENT_Y = 28 + R_H + 40;
mcpCode.narrow = {
  stage: { w: 360, h: R_CLIENT_Y + 320 },
  panels: [
    { id: "route", x: 0, y: 28, w: 360, h: R_H, code: true, title: "route.ts" },
    { id: "client", x: 0, y: R_CLIENT_Y, w: 360, h: 320, title: "MCP client" },
  ],
  wires: {
    call: [
      [60, R_CLIENT_Y],
      [60, 28 + R_H],
    ],
    back: [
      [300, 28 + R_H],
      [300, R_CLIENT_Y],
    ],
  },
};

const W_PAGE_Y = 28 + W_H + 32;
const W_AGENT_Y = W_PAGE_Y + PAGE_H + 36;
webmcpCode.narrow = {
  stage: { w: 360, h: W_AGENT_Y + 120 },
  panels: [
    { id: "code", x: 0, y: 28, w: 360, h: W_H, code: true, title: "projects-agent-tools.ts" },
    { id: "page", x: 0, y: W_PAGE_Y, w: 360, h: PAGE_H, title: "/projects" },
    { id: "agent", x: 90, y: W_AGENT_Y, w: 180, h: 120, icon: "agent", label: "Browser agent" },
  ],
  wires: {
    register: [
      [300, 28 + W_H],
      [300, W_PAGE_Y],
    ],
    execute: [
      [100, W_PAGE_Y],
      [100, 28 + W_H],
    ],
    call: [
      [180, W_AGENT_Y],
      [180, W_PAGE_Y + PAGE_H],
    ],
  },
};

agentsCode.narrow = {
  stage: { w: 360, h: 28 + 200 + 36 + A_H },
  panels: [
    { id: "config", x: 0, y: 28, w: 360, h: 200, code: true, title: "farm.config.ts" },
    { id: "chat", x: 0, y: 28 + 200 + 36, w: 360, h: A_H, title: "localhost:3000" },
  ],
  wires: {
    run: [
      [180, 228],
      [180, 264],
    ],
  },
};

export const FIGURES: Record<FigureKind, FigureSpec> = {
  integration,
  agents,
  webmcp,
  preview,
  runtimes,
  "mcp-code": mcpCode,
  "webmcp-code": webmcpCode,
  "agents-code": agentsCode,
  viby,
  "agents-flow": agentsFlow,
  "agents-flow-stacked": agentsFlowStacked,
  "agents-deploy": agentsDeploy,
  "agents-connect": agentsConnect,
  "agents-site": agentsSite,
  "agents-observe": agentsObserve,
  "landing-markdown": landingMarkdown,
  "landing-strata": landingStrata,
};

/** SVG path with rounded elbows through the given stage points. */
export function roundPath(points: [number, number][], radius = 12): string {
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const la = Math.hypot(x1 - x0, y1 - y0);
    const lb = Math.hypot(x2 - x1, y2 - y1);
    const a = Math.min(radius, la / 2);
    const b = Math.min(radius, lb / 2);
    d += ` L${x1 - ((x1 - x0) / la) * a} ${y1 - ((y1 - y0) / la) * a}`;
    d += ` Q${x1} ${y1} ${x1 + ((x2 - x1) / lb) * b} ${y1 + ((y2 - y1) / lb) * b}`;
  }
  const [lx, ly] = points[points.length - 1];
  return `${d} L${lx} ${ly}`;
}
