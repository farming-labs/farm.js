type RouteMapEntry = {
  pattern: string;
  modulePath: string;
};

type RouteManagerLike = {
  getRoutes(): Map<string, RouteMapEntry>;
  getLayouts(): Map<string, RouteMapEntry>;
  getLoadings(): Map<string, RouteMapEntry>;
  getErrors(): Map<string, RouteMapEntry>;
};

type APIRouteManagerLike = {
  getRoutes(): Map<
    string,
    {
      path: string;
      filePath: string;
      methods: string[];
    }
  >;
};

type MiddlewareManagerLike = {
  getMiddlewares(): Array<{
    path: string;
    filePath: string;
    handlers: unknown[];
    source?: "config" | "file";
  }>;
};

export type FarmDevtoolsSnapshot = {
  generatedAt: string;
  project: {
    root: string;
    srcDir: string;
  };
  counts: {
    pages: number;
    layouts: number;
    loadingBoundaries: number;
    errorBoundaries: number;
    apiRoutes: number;
    middleware: number;
    integrations: number;
  };
  routes: Array<{
    kind: "page" | "layout" | "loading" | "error";
    pattern: string;
    filePath: string;
  }>;
  apiRoutes: Array<{
    path: string;
    methods: string[];
    filePath: string;
  }>;
  middleware: Array<{
    path: string;
    source: "config" | "file";
    filePath: string;
    handlerCount: number;
  }>;
  integrations: string[];
  docs: {
    enabled: boolean;
    entry?: string;
  };
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function toProjectPath(root: string, filePath: string): string {
  const normalizedRoot = normalizePath(root).replace(/\/$/, "");
  const normalizedFile = normalizePath(filePath);
  if (normalizedFile.startsWith(normalizedRoot + "/")) {
    return normalizedFile.slice(normalizedRoot.length + 1);
  }
  return normalizedFile;
}

function sortByPath<T extends { path?: string; pattern?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    (a.path || a.pattern || "").localeCompare(b.path || b.pattern || ""),
  );
}

function collectRoutes(
  root: string,
  kind: FarmDevtoolsSnapshot["routes"][number]["kind"],
  routes: Map<string, RouteMapEntry>,
): FarmDevtoolsSnapshot["routes"] {
  return Array.from(routes.values()).map((route) => ({
    kind,
    pattern: route.pattern,
    filePath: toProjectPath(root, route.modulePath),
  }));
}

function collectIntegrationKeys(integrations: unknown): string[] {
  if (!integrations || typeof integrations !== "object") return [];
  if (Array.isArray(integrations)) {
    return integrations.map((_, index) => `integration-${index + 1}`);
  }
  return Object.keys(integrations).sort();
}

export function createFarmDevtoolsSnapshot(input: {
  root: string;
  srcDir: string;
  routeManager: RouteManagerLike;
  apiRouteManager: APIRouteManagerLike;
  middlewareManager: MiddlewareManagerLike;
  integrations?: unknown;
  docs?: {
    enabled?: boolean;
    entry?: string;
  } | null;
}): FarmDevtoolsSnapshot {
  const pageRoutes = collectRoutes(input.root, "page", input.routeManager.getRoutes());
  const layoutRoutes = collectRoutes(input.root, "layout", input.routeManager.getLayouts());
  const loadingRoutes = collectRoutes(input.root, "loading", input.routeManager.getLoadings());
  const errorRoutes = collectRoutes(input.root, "error", input.routeManager.getErrors());
  const apiRoutes = sortByPath(
    Array.from(input.apiRouteManager.getRoutes().values()).map((route) => ({
      path: route.path,
      methods: [...route.methods].sort(),
      filePath: toProjectPath(input.root, route.filePath),
    })),
  );
  const middleware = sortByPath(
    input.middlewareManager.getMiddlewares().map((entry) => ({
      path: entry.path,
      source: entry.source || "file",
      filePath: toProjectPath(input.root, entry.filePath),
      handlerCount: entry.handlers.length,
    })),
  );
  const integrations = collectIntegrationKeys(input.integrations);

  return {
    generatedAt: new Date().toISOString(),
    project: {
      root: input.root,
      srcDir: input.srcDir,
    },
    counts: {
      pages: pageRoutes.length,
      layouts: layoutRoutes.length,
      loadingBoundaries: loadingRoutes.length,
      errorBoundaries: errorRoutes.length,
      apiRoutes: apiRoutes.length,
      middleware: middleware.length,
      integrations: integrations.length,
    },
    routes: sortByPath([...pageRoutes, ...layoutRoutes, ...loadingRoutes, ...errorRoutes]),
    apiRoutes,
    middleware,
    integrations,
    docs: {
      enabled: Boolean(input.docs?.enabled),
      entry: input.docs?.entry,
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMetric(label: string, value: number): string {
  return `<section class="metric"><span>${escapeHtml(label)}</span><strong>${value}</strong></section>`;
}

function renderEmpty(message: string): string {
  return `<p class="empty">${escapeHtml(message)}</p>`;
}

function renderRoutes(snapshot: FarmDevtoolsSnapshot): string {
  if (snapshot.routes.length === 0) return renderEmpty("No page routes discovered yet.");
  return `<table><thead><tr><th>Kind</th><th>Pattern</th><th>File</th></tr></thead><tbody>${snapshot.routes
    .map(
      (route) =>
        `<tr><td><span class="pill">${route.kind}</span></td><td><code>${escapeHtml(route.pattern)}</code></td><td>${escapeHtml(route.filePath)}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

function renderApiRoutes(snapshot: FarmDevtoolsSnapshot): string {
  if (snapshot.apiRoutes.length === 0) return renderEmpty("No API routes discovered yet.");
  return `<table><thead><tr><th>Path</th><th>Methods</th><th>File</th></tr></thead><tbody>${snapshot.apiRoutes
    .map(
      (route) =>
        `<tr><td><code>${escapeHtml(route.path)}</code></td><td>${route.methods.map((method) => `<span class="pill">${escapeHtml(method)}</span>`).join(" ")}</td><td>${escapeHtml(route.filePath)}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

function renderMiddleware(snapshot: FarmDevtoolsSnapshot): string {
  if (snapshot.middleware.length === 0) return renderEmpty("No middleware files discovered yet.");
  return `<table><thead><tr><th>Path</th><th>Source</th><th>Handlers</th><th>File</th></tr></thead><tbody>${snapshot.middleware
    .map(
      (entry) =>
        `<tr><td><code>${escapeHtml(entry.path)}</code></td><td><span class="pill">${entry.source}</span></td><td>${entry.handlerCount}</td><td>${escapeHtml(entry.filePath)}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

function renderIntegrations(snapshot: FarmDevtoolsSnapshot): string {
  if (snapshot.integrations.length === 0) return renderEmpty("No integrations configured.");
  return `<div class="chips">${snapshot.integrations
    .map((key) => `<span class="chip">${escapeHtml(key)}</span>`)
    .join("")}</div>`;
}

export function renderFarmDevtoolsHtml(snapshot: FarmDevtoolsSnapshot): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Farm Devtools</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #050505; color: #f5f5f5; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #050505; }
    .shell { max-width: 1180px; margin: 0 auto; padding: 32px 20px 56px; }
    header { display: flex; align-items: end; justify-content: space-between; gap: 24px; padding-bottom: 20px; border-bottom: 1px solid #262626; }
    h1 { margin: 0; font-size: clamp(32px, 6vw, 72px); line-height: 0.9; letter-spacing: 0; }
    .eyebrow, .muted, th { color: #8c8c8c; }
    .eyebrow { margin: 0 0 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 12px; text-transform: uppercase; }
    .muted { margin: 8px 0 0; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    a { color: inherit; }
    .button { display: inline-flex; align-items: center; height: 36px; padding: 0 12px; border: 1px solid #333; background: #111; text-decoration: none; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 12px; text-transform: uppercase; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 22px 0; }
    .metric { border: 1px solid #262626; padding: 14px; background: #0a0a0a; }
    .metric span { display: block; color: #8c8c8c; font-size: 12px; }
    .metric strong { display: block; margin-top: 8px; font-size: 28px; }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; }
    section.panel { border: 1px solid #262626; background: #080808; }
    .panel h2 { margin: 0; padding: 14px 16px; border-bottom: 1px solid #262626; font-size: 15px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 11px 16px; border-bottom: 1px solid #1b1b1b; text-align: left; vertical-align: top; font-size: 13px; }
    tr:last-child td { border-bottom: 0; }
    code, .pill, .chip { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
    code { color: #f4f4f4; }
    .pill { display: inline-flex; align-items: center; min-height: 20px; padding: 1px 6px; border: 1px solid #333; color: #bdbdbd; font-size: 11px; text-transform: uppercase; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 16px; }
    .chip { border: 1px solid #333; padding: 7px 9px; color: #d8d8d8; font-size: 12px; }
    .empty { margin: 0; padding: 16px; color: #8c8c8c; }
    @media (min-width: 920px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .panel.routes { grid-column: 1 / -1; } }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div>
        <p class="eyebrow">Farm.js Devtools</p>
        <h1>Project Runtime</h1>
        <p class="muted">${escapeHtml(snapshot.project.srcDir)}/app inspected at ${escapeHtml(snapshot.generatedAt)}</p>
      </div>
      <nav class="actions" aria-label="Devtools actions">
        <a class="button" href="/__farm/devtools.json">JSON</a>
        <a class="button" href="/">App</a>
      </nav>
    </header>
    <div class="metrics">
      ${renderMetric("Pages", snapshot.counts.pages)}
      ${renderMetric("Layouts", snapshot.counts.layouts)}
      ${renderMetric("API", snapshot.counts.apiRoutes)}
      ${renderMetric("Middleware", snapshot.counts.middleware)}
      ${renderMetric("Integrations", snapshot.counts.integrations)}
      ${renderMetric("Docs", snapshot.docs.enabled ? 1 : 0)}
    </div>
    <div class="grid">
      <section class="panel routes"><h2>Routes</h2>${renderRoutes(snapshot)}</section>
      <section class="panel"><h2>API Routes</h2>${renderApiRoutes(snapshot)}</section>
      <section class="panel"><h2>Middleware</h2>${renderMiddleware(snapshot)}</section>
      <section class="panel"><h2>Integrations</h2>${renderIntegrations(snapshot)}</section>
      <section class="panel"><h2>Docs</h2><p class="empty">${snapshot.docs.enabled ? `Enabled at ${escapeHtml(snapshot.docs.entry || "/docs")}` : "Disabled"}</p></section>
    </div>
  </main>
</body>
</html>`;
}
