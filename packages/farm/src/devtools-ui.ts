import type { FarmDevtoolsDiagnostic, FarmDevtoolsRuntime, FarmDevtoolsSnapshot } from "./devtools";

type IconName =
  | "activity"
  | "api"
  | "app"
  | "blocks"
  | "book"
  | "clock"
  | "copy"
  | "database"
  | "external"
  | "layers"
  | "overview"
  | "refresh"
  | "route"
  | "runtime"
  | "search"
  | "shield"
  | "terminal";

const ICON_PATHS: Record<IconName, string> = {
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  api: '<path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"/>',
  app: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  blocks:
    '<rect width="7" height="7" x="3" y="3"/><rect width="7" height="7" x="14" y="3"/><rect width="7" height="7" x="14" y="14"/><rect width="7" height="7" x="3" y="14"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  copy: '<rect width="14" height="14" x="8" y="8"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  database:
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
  external:
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  layers:
    '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 12.5-9.17 4.17a2 2 0 0 1-1.66 0L2 12.5"/><path d="m22 17.5-9.17 4.17a2 2 0 0 1-1.66 0L2 17.5"/>',
  overview:
    '<rect width="7" height="9" x="3" y="3"/><rect width="7" height="5" x="14" y="3"/><rect width="7" height="9" x="14" y="12"/><rect width="7" height="5" x="3" y="16"/>',
  refresh:
    '<path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/>',
  route:
    '<circle cx="6" cy="19" r="3"/><path d="M9 19h5.5a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7H18"/><circle cx="18" cy="5" r="3"/>',
  runtime:
    '<rect width="20" height="14" x="2" y="3"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3z"/><path d="m9 12 2 2 4-4"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
};

function icon(name: IconName, className = ""): string {
  return `<svg class="icon ${className}" data-lucide="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: unknown): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function renderBadge(value: string, tone = "neutral"): string {
  return `<span class="badge badge-${tone}">${escapeHtml(value)}</span>`;
}

function renderRuntime(runtime: FarmDevtoolsRuntime | undefined): string {
  if (!runtime) return '<span class="muted">Inherited</span>';
  const details = [
    runtime.regions?.length ? runtime.regions.join(", ") : null,
    runtime.maxDuration ? `${runtime.maxDuration}s` : null,
  ].filter(Boolean);
  return `<span class="runtime-value">${renderBadge(runtime.runtime, runtime.runtime)}${
    details.length ? `<small>${escapeHtml(details.join(" / "))}</small>` : ""
  }</span>`;
}

function renderEmpty(title: string, detail: string): string {
  return `<div class="empty-state">
    ${icon("activity")}
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(detail)}</span>
  </div>`;
}

function renderFilter(id: string, placeholder: string): string {
  return `<label class="filter-control">
    ${icon("search")}
    <span class="sr-only">${escapeHtml(placeholder)}</span>
    <input type="search" placeholder="${escapeAttribute(placeholder)}" data-filter="${escapeAttribute(id)}" autocomplete="off">
    <kbd>/</kbd>
  </label>`;
}

function renderDiagnostics(diagnostics: FarmDevtoolsDiagnostic[]): string {
  if (diagnostics.length === 0) {
    return `<div class="diagnostic diagnostic-ready">
      <span class="diagnostic-mark">${icon("shield")}</span>
      <div><strong>Framework checks passed</strong><p>Routes and configured systems are internally consistent.</p></div>
      ${renderBadge("ready", "ready")}
    </div>`;
  }

  return diagnostics
    .map(
      (diagnostic) => `<article class="diagnostic diagnostic-${diagnostic.severity}">
        <span class="diagnostic-mark">${icon(
          diagnostic.severity === "error" ? "activity" : "shield",
        )}</span>
        <div>
          <span class="diagnostic-code">${escapeHtml(diagnostic.code)}</span>
          <strong>${escapeHtml(diagnostic.title)}</strong>
          <p>${escapeHtml(diagnostic.message)}</p>
          ${diagnostic.action ? `<small>${escapeHtml(diagnostic.action)}</small>` : ""}
        </div>
        ${renderBadge(diagnostic.severity, diagnostic.severity)}
      </article>`,
    )
    .join("");
}

function renderSystemRows(snapshot: FarmDevtoolsSnapshot): string {
  const rows = [
    ["Integrations", snapshot.counts.integrations, "Configured product adapters", "blocks"],
    ["Storage", snapshot.counts.storageMounts, "Root driver and named mounts", "database"],
    ["Cron", snapshot.counts.cronJobs, "Portable scheduled API routes", "clock"],
    ["Workflows", snapshot.counts.workflows, "Discovered workflow modules", "activity"],
    ["Docs", snapshot.docs.enabled ? "On" : "Off", snapshot.docs.entry || "No docs route", "book"],
  ] as const;

  return rows
    .map(
      ([label, value, detail, rowIcon]) => `<div class="system-row">
        <span class="system-icon">${icon(rowIcon)}</span>
        <div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small></div>
        <span class="system-value">${escapeHtml(value)}</span>
      </div>`,
    )
    .join("");
}

function renderIntegrations(snapshot: FarmDevtoolsSnapshot): string {
  if (snapshot.integrations.length === 0) {
    return renderEmpty(
      "No integrations configured",
      "Register product systems through farm.config.ts when the app needs them.",
    );
  }

  return `<div class="table-scroll"><table>
    <thead><tr><th>Registry key</th><th>Adapter</th><th>Routes</th><th>Runtime surface</th></tr></thead>
    <tbody>${snapshot.integrations
      .map(
        (integration) => `<tr>
          <td><code>${escapeHtml(integration.key)}</code><small class="cell-detail">${escapeHtml(
            integration.category,
          )}</small></td>
          <td>${escapeHtml(integration.type)}</td>
          <td>${
            integration.routes.length
              ? integration.routes
                  .map(
                    (route) =>
                      `<span class="route-operation"><code>${escapeHtml(
                        route.path,
                      )}</code><small>${escapeHtml(route.methods.join(", "))}</small></span>`,
                  )
                  .join("")
              : '<span class="muted">No HTTP routes</span>'
          }</td>
          <td><span class="runtime-facts">${renderBadge(
            integration.serverRuntime ? "server" : "platform",
          )}<span>${integration.middlewareCount} middleware</span><span>${
            integration.providerCount
          } providers</span><span>${integration.schemaModelCount} models</span></span></td>
        </tr>`,
      )
      .join("")}</tbody>
  </table></div>`;
}

function renderMiddleware(snapshot: FarmDevtoolsSnapshot): string {
  if (snapshot.middleware.length === 0) {
    return renderEmpty("No middleware configured", "Requests currently enter routes directly.");
  }
  return `<div class="table-scroll"><table>
    <thead><tr><th>Path</th><th>Source</th><th>Handlers</th><th>File</th></tr></thead>
    <tbody>${snapshot.middleware
      .map(
        (entry) =>
          `<tr><td><code>${escapeHtml(entry.path)}</code></td><td>${renderBadge(
            entry.source,
          )}</td><td>${entry.handlerCount}</td><td class="file-cell">${escapeHtml(
            entry.filePath,
          )}</td></tr>`,
      )
      .join("")}</tbody>
  </table></div>`;
}

function renderStorage(snapshot: FarmDevtoolsSnapshot): string {
  return `<div class="table-scroll"><table>
    <thead><tr><th>Mount</th><th>Driver</th><th>State</th></tr></thead>
    <tbody>${snapshot.storage
      .map(
        (entry) =>
          `<tr><td><code>${escapeHtml(entry.mount)}</code></td><td>${escapeHtml(
            entry.driver,
          )}</td><td>${renderBadge(entry.default ? "default" : "configured")}</td></tr>`,
      )
      .join("")}</tbody>
  </table></div>`;
}

function renderCron(snapshot: FarmDevtoolsSnapshot): string {
  if (snapshot.cron.length === 0) {
    return renderEmpty(
      "No cron routes configured",
      "Add named schedules under cron in farm.config.ts.",
    );
  }
  return `<div class="table-scroll"><table>
    <thead><tr><th>Name</th><th>Schedule (UTC)</th><th>Target</th></tr></thead>
    <tbody>${snapshot.cron
      .map(
        (job) =>
          `<tr><td><code>${escapeHtml(job.name)}</code></td><td>${job.schedule
            .map((schedule) => `<code class="schedule">${escapeHtml(schedule)}</code>`)
            .join("")}</td><td><code>${escapeHtml(job.path)}</code></td></tr>`,
      )
      .join("")}</tbody>
  </table></div>`;
}

function renderWorkflows(snapshot: FarmDevtoolsSnapshot): string {
  if (snapshot.workflows.length === 0) {
    return renderEmpty(
      "No workflows discovered",
      "Workflow directories are enabled but currently empty.",
    );
  }
  return `<div class="table-scroll"><table>
    <thead><tr><th>Workflow</th><th>Schedule</th><th>Endpoint</th><th>Source</th></tr></thead>
    <tbody>${snapshot.workflows
      .map(
        (workflow) =>
          `<tr><td><code>${escapeHtml(workflow.id)}</code></td><td>${
            workflow.schedule.length
              ? workflow.schedule.map((schedule) => `<code>${escapeHtml(schedule)}</code>`).join("")
              : '<span class="muted">Manual</span>'
          }</td><td><code>${escapeHtml(workflow.routePath)}</code></td><td class="file-cell">${escapeHtml(
            workflow.filePath,
          )}</td></tr>`,
      )
      .join("")}</tbody>
  </table></div>`;
}

function renderFeatureMatrix(snapshot: FarmDevtoolsSnapshot): string {
  const features = [
    ["OpenAPI", snapshot.features.openapi],
    ["Markdown", snapshot.features.markdown],
    ["Server components", snapshot.features.serverComponents],
    ["Server actions", snapshot.features.serverActions],
    ["Observability", snapshot.features.observability],
  ] as const;
  return `<div class="feature-matrix">${features
    .map(
      ([label, enabled]) =>
        `<div><span>${escapeHtml(label)}</span>${renderBadge(
          enabled ? "enabled" : "disabled",
          enabled ? "ready" : "neutral",
        )}</div>`,
    )
    .join("")}</div>`;
}

function renderEnvironment(snapshot: FarmDevtoolsSnapshot): string {
  const renderKeys = (keys: string[]) =>
    keys.length
      ? `<div class="key-list">${keys.map((key) => `<code>${escapeHtml(key)}</code>`).join("")}</div>`
      : '<span class="muted">No validated keys</span>';
  return `<div class="environment-grid">
    <div><span class="mini-label">Server keys</span>${renderKeys(snapshot.environment.server)}</div>
    <div><span class="mini-label">Public keys</span>${renderKeys(snapshot.environment.public)}</div>
  </div>`;
}

function renderLayers(snapshot: FarmDevtoolsSnapshot): string {
  if (snapshot.layers.length === 0) {
    return renderEmpty(
      "No layers extended",
      "This project owns its complete route and config surface.",
    );
  }
  return `<div class="layer-list">${snapshot.layers
    .map(
      (layer) =>
        `<div><span>${icon("layers")}<strong>${escapeHtml(
          layer.name,
        )}</strong></span><code>${escapeHtml(layer.source)}</code><small>${escapeHtml(
          layer.srcDir,
        )}</small></div>`,
    )
    .join("")}</div>`;
}

type InspectorEntry = {
  id: string;
  label: string;
  description: string;
  icon: IconName;
  value?: string | number;
  searchValue?: string;
  detailMeta?: string;
  content: string;
};

function renderPropertyList(entries: Array<[label: string, value: string]>): string {
  return `<dl class="property-list">${entries
    .map(
      ([label, value]) =>
        `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`,
    )
    .join("")}</dl>`;
}

function renderDetailIntro(
  label: string,
  title: string,
  description: string,
  detailIcon: IconName,
): string {
  return `<div class="detail-intro">
    <span class="detail-icon">${icon(detailIcon)}</span>
    <div><span class="mini-label">${escapeHtml(label)}</span><h2>${escapeHtml(
      title,
    )}</h2><p>${escapeHtml(description)}</p></div>
  </div>`;
}

function renderInspector(
  scope: string,
  title: string,
  entries: InspectorEntry[],
  filterPlaceholder?: string,
): string {
  if (entries.length === 0) {
    return `<div class="single-pane">
      <header class="pane-header"><strong>${escapeHtml(title)}</strong><span>0 items</span></header>
      ${renderEmpty(`No ${title.toLowerCase()} found`, "Farm has no runtime data for this surface yet.")}
    </div>`;
  }

  return `<div class="split-view" data-inspector="${escapeAttribute(scope)}">
    <section class="pane pane-list">
      <header class="pane-header"><strong>${escapeHtml(title)}</strong><span>${entries.length} ${
        entries.length === 1 ? "item" : "items"
      }</span></header>
      ${
        filterPlaceholder
          ? `<div class="pane-tools">${renderFilter(scope, filterPlaceholder)}</div>`
          : ""
      }
      <div class="pane-scroll inspector-list" data-filter-rows="${escapeAttribute(scope)}">
        ${entries
          .map(
            (entry, index) => `<button type="button" class="inspector-row" data-detail-trigger="${escapeAttribute(
              scope,
            )}" data-detail-id="${escapeAttribute(entry.id)}" data-search-value="${escapeAttribute(
              entry.searchValue || `${entry.label} ${entry.description}`,
            )}" aria-selected="${index === 0 ? "true" : "false"}">
              <span class="inspector-row-icon">${icon(entry.icon)}</span>
              <span class="inspector-row-copy"><strong>${escapeHtml(
                entry.label,
              )}</strong><small>${escapeHtml(entry.description)}</small></span>
              ${entry.value === undefined ? "" : `<span class="inspector-row-value">${escapeHtml(entry.value)}</span>`}
            </button>`,
          )
          .join("")}
        <div class="filtered-empty" data-filter-empty="${escapeAttribute(
          scope,
        )}" hidden>No items match this filter.</div>
      </div>
    </section>
    <section class="pane pane-detail">
      ${entries
        .map(
          (entry, index) => `<article class="detail-panel" data-detail-panel="${escapeAttribute(
            scope,
          )}" data-detail-id="${escapeAttribute(entry.id)}"${index === 0 ? "" : " hidden"}>
            <header class="pane-header"><strong>${escapeHtml(entry.label)}</strong><span>${escapeHtml(
              entry.detailMeta || entry.description,
            )}</span></header>
            <div class="detail-scroll">${entry.content}</div>
          </article>`,
        )
        .join("")}
    </section>
  </div>`;
}

function renderJson(value: unknown): string {
  return `<pre class="json-viewer"><code>${escapeHtml(JSON.stringify(value, null, 2))}</code></pre>`;
}

function renderOverviewInspector(
  snapshot: FarmDevtoolsSnapshot,
  healthLabel: string,
  generatedTime: string,
): string {
  const scheduledCount = snapshot.counts.cronJobs + snapshot.counts.workflows;
  return renderInspector("overview", "Project", [
    {
      id: "diagnostics",
      label: "Diagnostics",
      description: "Actionable framework checks",
      icon: "shield",
      value: snapshot.counts.diagnostics,
      detailMeta: healthLabel,
      content: `${renderDetailIntro(
        "Project health",
        healthLabel,
        snapshot.diagnostics.length
          ? "Farm found configuration details that deserve attention before production."
          : "Routes and configured systems are internally consistent.",
        "shield",
      )}<div class="detail-section">${renderDiagnostics(snapshot.diagnostics)}</div>`,
    },
    {
      id: "project",
      label: snapshot.project.name,
      description: snapshot.project.root,
      icon: "app",
      value: snapshot.project.srcDir,
      detailMeta: "Active project",
      content: `${renderDetailIntro(
        "Active project",
        snapshot.project.name,
        "The application currently resolved by the Farm development server.",
        "app",
      )}${renderPropertyList([
        ["Root", `<code>${escapeHtml(snapshot.project.root)}</code>`],
        ["Source directory", `<code>${escapeHtml(snapshot.project.srcDir)}</code>`],
        ["Base path", `<code>${escapeHtml(snapshot.project.basePath)}</code>`],
        ["Deployment ID", `<code>${escapeHtml(snapshot.project.deploymentId)}</code>`],
        ["Snapshot", `<span class="mono">${escapeHtml(generatedTime)}</span>`],
      ])}`,
    },
    {
      id: "routes",
      label: "Route surface",
      description: "Pages, boundaries, and typed endpoints",
      icon: "route",
      value: snapshot.counts.pages + snapshot.counts.apiRoutes,
      detailMeta: `${snapshot.counts.pages} pages / ${snapshot.counts.apiRoutes} API`,
      content: `${renderDetailIntro(
        "Application routing",
        `${snapshot.counts.pages + snapshot.counts.apiRoutes} registered routes`,
        "Farm resolves page boundaries and server endpoints from the same application tree.",
        "route",
      )}${renderPropertyList([
        ["Pages", `<strong>${snapshot.counts.pages}</strong>`],
        ["Layouts", `<strong>${snapshot.counts.layouts}</strong>`],
        ["Loading boundaries", `<strong>${snapshot.counts.loadingBoundaries}</strong>`],
        ["Error boundaries", `<strong>${snapshot.counts.errorBoundaries}</strong>`],
        ["API routes", `<strong>${snapshot.counts.apiRoutes}</strong>`],
      ])}`,
    },
    {
      id: "systems",
      label: "Connected systems",
      description: "Integrations, storage, and request layers",
      icon: "blocks",
      value: snapshot.counts.integrations,
      detailMeta: "Configured surfaces",
      content: `${renderDetailIntro(
        "System map",
        "Application services",
        "Product integrations and framework services visible to the running application.",
        "blocks",
      )}<div class="detail-section">${renderSystemRows(snapshot)}</div>`,
    },
    {
      id: "deployment",
      label: "Runtime",
      description: `${snapshot.deployment.target} / ${snapshot.deployment.preset}`,
      icon: "runtime",
      value: scheduledCount,
      detailMeta: "Deployment controls",
      content: `${renderDetailIntro(
        "Deployment runtime",
        snapshot.deployment.target,
        "The resolved deployment adapter, output contract, and enabled framework surfaces.",
        "runtime",
      )}${renderPropertyList([
        ["Target", `<code>${escapeHtml(snapshot.deployment.target)}</code>`],
        ["Nitro preset", `<code>${escapeHtml(snapshot.deployment.preset)}</code>`],
        [
          "Output",
          `<code>${escapeHtml(snapshot.deployment.outputDir || "Framework default")}</code>`,
        ],
        ["Scheduled work", `<strong>${scheduledCount}</strong>`],
      ])}<div class="detail-section">${renderFeatureMatrix(snapshot)}</div>`,
    },
  ]);
}

function renderRoutesInspector(snapshot: FarmDevtoolsSnapshot): string {
  return renderInspector(
    "routes",
    "Routes",
    snapshot.routes.map((route, index) => ({
      id: `route-${index}`,
      label: route.pattern,
      description: route.filePath,
      icon: "route",
      value: route.kind,
      searchValue: `${route.kind} ${route.pattern} ${route.filePath} ${
        route.runtime?.runtime || "inherited"
      }`,
      detailMeta: route.kind,
      content: `${renderDetailIntro(
        `${route.kind} route`,
        route.pattern,
        route.filePath,
        "route",
      )}${renderPropertyList([
        ["Kind", renderBadge(route.kind, route.kind)],
        ["Pattern", `<code>${escapeHtml(route.pattern)}</code>`],
        ["Runtime", renderRuntime(route.runtime)],
        ["Source", `<code>${escapeHtml(route.filePath)}</code>`],
      ])}`,
    })),
    "Filter routes or files",
  );
}

function renderApiInspector(snapshot: FarmDevtoolsSnapshot): string {
  return renderInspector(
    "api",
    "API routes",
    snapshot.apiRoutes.map((route, index) => ({
      id: `api-${index}`,
      label: route.path,
      description: route.filePath,
      icon: "api",
      value: route.methods.length,
      searchValue: `${route.path} ${route.methods.join(" ")} ${route.filePath} ${
        route.runtime.runtime
      }`,
      detailMeta: route.methods.join(" / "),
      content: `${renderDetailIntro(
        "Server endpoint",
        route.path,
        route.filePath,
        "api",
      )}${renderPropertyList([
        [
          "Methods",
          `<span class="method-list">${route.methods
            .map((method) => renderBadge(method, "method"))
            .join("")}</span>`,
        ],
        ["Runtime", renderRuntime(route.runtime)],
        ["Source", `<code>${escapeHtml(route.filePath)}</code>`],
      ])}`,
    })),
    "Filter endpoints or methods",
  );
}

function renderSystemsInspector(snapshot: FarmDevtoolsSnapshot): string {
  return renderInspector("systems", "Systems", [
    {
      id: "integrations",
      label: "Integrations",
      description: "Configured product adapters",
      icon: "blocks",
      value: snapshot.integrations.length,
      content: renderIntegrations(snapshot),
    },
    {
      id: "middleware",
      label: "Middleware",
      description: "Request layers and source modules",
      icon: "shield",
      value: snapshot.middleware.length,
      content: renderMiddleware(snapshot),
    },
    {
      id: "storage",
      label: "Storage mounts",
      description: "Root driver and named namespaces",
      icon: "database",
      value: snapshot.storage.length,
      content: renderStorage(snapshot),
    },
    {
      id: "docs",
      label: "Documentation",
      description: snapshot.docs.entry || "No docs route",
      icon: "book",
      value: snapshot.docs.enabled ? "on" : "off",
      content: `${renderDetailIntro(
        "Documentation",
        snapshot.docs.enabled ? "Docs enabled" : "Docs disabled",
        "Farm can serve application documentation from the same development runtime.",
        "book",
      )}${renderPropertyList([
        ["State", renderBadge(snapshot.docs.enabled ? "enabled" : "disabled")],
        ["Entry", `<code>${escapeHtml(snapshot.docs.entry || "Not configured")}</code>`],
      ])}`,
    },
  ]);
}

function renderRuntimeInspector(snapshot: FarmDevtoolsSnapshot): string {
  return renderInspector("runtime", "Runtime", [
    {
      id: "deployment",
      label: "Deployment",
      description: `${snapshot.deployment.target} / ${snapshot.deployment.preset}`,
      icon: "runtime",
      content: `${renderDetailIntro(
        "Deployment target",
        snapshot.deployment.target,
        "Resolved platform adapter and build output for this application.",
        "runtime",
      )}${renderPropertyList([
        ["Target", `<code>${escapeHtml(snapshot.deployment.target)}</code>`],
        ["Nitro preset", `<code>${escapeHtml(snapshot.deployment.preset)}</code>`],
        [
          "Output directory",
          `<code>${escapeHtml(snapshot.deployment.outputDir || "Framework default")}</code>`,
        ],
      ])}`,
    },
    {
      id: "cron",
      label: "Cron routes",
      description: "Portable scheduled API routes",
      icon: "clock",
      value: snapshot.cron.length,
      content: renderCron(snapshot),
    },
    {
      id: "workflows",
      label: "Workflows",
      description: "Discovered workflow modules",
      icon: "activity",
      value: snapshot.workflows.length,
      content: renderWorkflows(snapshot),
    },
    {
      id: "features",
      label: "Framework features",
      description: "Resolved configuration switches",
      icon: "blocks",
      content: renderFeatureMatrix(snapshot),
    },
    {
      id: "environment",
      label: "Environment",
      description: "Validated key names only",
      icon: "shield",
      value: snapshot.environment.server.length + snapshot.environment.public.length,
      content: renderEnvironment(snapshot),
    },
    {
      id: "layers",
      label: "Layers",
      description: "Extended source roots",
      icon: "layers",
      value: snapshot.layers.length,
      content: renderLayers(snapshot),
    },
  ]);
}

function renderRawInspector(snapshot: FarmDevtoolsSnapshot): string {
  return renderInspector("raw", "Raw snapshot", [
    {
      id: "snapshot",
      label: "Snapshot",
      description: "Complete serialized runtime state",
      icon: "terminal",
      content: renderJson(snapshot),
    },
    {
      id: "routes",
      label: "Routes",
      description: "Pages and route boundaries",
      icon: "route",
      value: snapshot.routes.length,
      content: renderJson(snapshot.routes),
    },
    {
      id: "api",
      label: "API",
      description: "Typed server endpoints",
      icon: "api",
      value: snapshot.apiRoutes.length,
      content: renderJson(snapshot.apiRoutes),
    },
    {
      id: "systems",
      label: "Systems",
      description: "Integrations, middleware, and storage",
      icon: "blocks",
      content: renderJson({
        integrations: snapshot.integrations,
        middleware: snapshot.middleware,
        storage: snapshot.storage,
      }),
    },
    {
      id: "diagnostics",
      label: "Diagnostics",
      description: "Framework health findings",
      icon: "shield",
      value: snapshot.diagnostics.length,
      content: renderJson(snapshot.diagnostics),
    },
  ]);
}

function renderNavigationItem(
  view: string,
  label: string,
  itemIcon: IconName,
  count?: number,
): string {
  return `<button type="button" class="nav-item" data-view-trigger="${view}" aria-selected="false">
    ${icon(itemIcon)}<span>${escapeHtml(label)}</span>${count === undefined ? "" : `<small>${count}</small>`}
  </button>`;
}

export function renderFarmDevtoolsHtml(snapshot: FarmDevtoolsSnapshot): string {
  const healthLabel =
    snapshot.health === "ready" ? "Ready" : snapshot.health === "error" ? "Error" : "Attention";
  const generatedTime = new Date(snapshot.generatedAt).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Farm Devtools - ${escapeHtml(snapshot.project.name)}</title>
  <style>
    :root {
      color-scheme: dark;
      --background: #000;
      --surface: #050505;
      --surface-raised: #090909;
      --foreground: #f5f5f5;
      --muted: #858585;
      --muted-strong: #a8a8a8;
      --line: rgb(255 255 255 / 0.12);
      --line-soft: rgb(255 255 255 / 0.065);
      --line-strong: rgb(255 255 255 / 0.22);
      --font-sans: "Geist Sans", Geist, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-mono: "Geist Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    }
    * { box-sizing: border-box; border-radius: 0 !important; }
    html { min-width: 320px; min-height: 100%; background: var(--background); }
    body { min-height: 100vh; min-height: 100dvh; margin: 0; overflow: hidden; background: #030303; color: var(--foreground); font-family: var(--font-sans); font-size: 14px; letter-spacing: 0; text-rendering: optimizeLegibility; }
    button, input { color: inherit; font: inherit; letter-spacing: 0; }
    button, a { -webkit-tap-highlight-color: transparent; }
    button { cursor: pointer; }
    a { color: inherit; }
    [hidden] { display: none !important; }
    code, kbd, .badge, .mono, .mini-label, .metric-label, .metric-detail, .section-index, .diagnostic-code, th, .statusbar, .eyebrow { font-family: var(--font-mono); letter-spacing: 0; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    .icon { width: 16px; height: 16px; flex: 0 0 auto; }
    .stage { display: grid; min-height: 100vh; min-height: 100dvh; place-items: center; padding: 20px; }
    .shell { display: flex; width: min(1280px, 100%); height: min(780px, calc(100dvh - 40px)); min-height: 560px; min-width: 0; flex-direction: column; overflow: hidden; border: 1px solid var(--line-strong); background: var(--background); box-shadow: 0 24px 80px rgb(0 0 0 / 0.72); }
    .topbar { z-index: 30; display: flex; min-height: 42px; flex: 0 0 auto; align-items: stretch; border-bottom: 1px solid var(--line); background: var(--background); }
    .brand { display: flex; min-width: 170px; align-items: center; gap: 8px; padding: 0 12px; border-right: 1px solid var(--line); text-decoration: none; font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; white-space: nowrap; }
    .brand-mark { display: grid; width: 18px; height: 18px; place-items: center; border: 1px solid var(--line-strong); color: #fff; font-family: var(--font-sans); font-size: 9px; font-weight: 650; }
    .brand-slash { color: #555; }
    .brand-product { color: var(--muted-strong); }
    .tabbar { display: flex; min-width: 0; flex: 1 1 auto; align-items: stretch; overflow-x: auto; scrollbar-width: none; }
    .tabbar::-webkit-scrollbar { display: none; }
    .nav-item { position: relative; display: flex; min-width: max-content; min-height: 41px; align-items: center; gap: 7px; padding: 0 11px; border: 0; background: transparent; color: var(--muted); font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; transition: background-color 140ms ease-out, color 140ms ease-out; }
    .nav-item::after { position: absolute; right: 10px; bottom: -1px; left: 10px; height: 1px; background: transparent; content: ""; }
    .nav-item:hover, .nav-item:focus-visible { background: rgb(255 255 255 / 0.035); color: var(--foreground); outline: none; }
    .nav-item[aria-selected="true"] { color: #fff; }
    .nav-item[aria-selected="true"]::after { background: #fff; }
    .nav-item .icon { width: 13px; height: 13px; }
    .nav-item small { color: #666; font-size: 9px; font-weight: 400; }
    .topbar-meta { display: flex; flex: 0 0 auto; margin-left: auto; border-left: 1px solid var(--line); }
    .topbar-status { display: flex; min-width: max-content; align-items: center; gap: 7px; padding: 0 11px; color: var(--muted-strong); font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; }
    .status-dot { width: 5px; height: 5px; background: #fff; box-shadow: 0 0 0 3px rgb(255 255 255 / 0.06); }
    .status-dot-attention { background: #909090; animation: status-pulse 1.8s ease-in-out infinite; }
    .status-dot-error { background: transparent; border: 1px solid #fff; }
    .topbar-actions { display: flex; }
    .action { display: inline-flex; width: 40px; min-height: 41px; align-items: center; justify-content: center; padding: 0; border: 0; border-left: 1px solid var(--line); background: transparent; color: var(--muted-strong); text-decoration: none; transition: background-color 140ms ease-out, color 140ms ease-out; }
    .action:hover, .action:focus-visible { background: #fff; color: #000; outline: none; }
    .action[data-copied="true"] { background: #fff; color: #000; }
    .workspace { min-height: 0; flex: 1 1 auto; }
    .eyebrow { display: block; color: var(--muted); font-size: 9px; font-weight: 400; text-transform: uppercase; }
    .content { height: 100%; min-width: 0; }
    .view { height: 100%; min-width: 0; overflow: hidden; }
    .split-view { display: grid; height: 100%; min-height: 0; grid-template-columns: clamp(230px, 28%, 300px) minmax(0, 1fr); }
    .pane { min-width: 0; min-height: 0; overflow: hidden; background: var(--background); }
    .pane-list { display: flex; flex-direction: column; border-right: 1px solid var(--line); }
    .pane-detail { position: relative; }
    .pane-header { display: flex; min-height: 38px; align-items: center; justify-content: space-between; gap: 12px; padding: 0 12px; border-bottom: 1px solid var(--line); background: var(--surface); }
    .pane-header strong { overflow: hidden; font-size: 11px; font-weight: 520; text-overflow: ellipsis; white-space: nowrap; }
    .pane-header span { overflow: hidden; color: var(--muted); font-family: var(--font-mono); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
    .pane-tools { border-bottom: 1px solid var(--line); }
    .pane-tools .filter-control { width: 100%; min-height: 36px; border: 0; }
    .pane-scroll, .detail-scroll { min-height: 0; overflow: auto; overscroll-behavior: contain; }
    .pane-scroll { flex: 1 1 auto; }
    .inspector-list { scrollbar-width: thin; scrollbar-color: var(--line-strong) transparent; }
    .inspector-row { position: relative; display: grid; width: 100%; min-height: 54px; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 9px; padding: 8px 11px; border: 0; border-bottom: 1px solid var(--line-soft); background: transparent; color: var(--muted); text-align: left; transition: background-color 120ms ease-out, color 120ms ease-out; }
    .inspector-row::before { position: absolute; inset: 0 auto 0 0; width: 1px; background: transparent; content: ""; }
    .inspector-row:hover, .inspector-row:focus-visible { background: rgb(255 255 255 / 0.035); color: var(--foreground); outline: none; }
    .inspector-row[aria-selected="true"] { background: rgb(255 255 255 / 0.075); color: #fff; }
    .inspector-row[aria-selected="true"]::before { background: #fff; }
    .inspector-row-icon { display: grid; color: var(--muted-strong); place-items: center; }
    .inspector-row-icon .icon { width: 14px; height: 14px; }
    .inspector-row-copy { min-width: 0; }
    .inspector-row-copy strong, .inspector-row-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .inspector-row-copy strong { color: inherit; font-size: 11px; font-weight: 520; }
    .inspector-row-copy small { margin-top: 3px; color: var(--muted); font-family: var(--font-mono); font-size: 9px; }
    .inspector-row-value { color: var(--muted-strong); font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; }
    .detail-panel { display: flex; height: 100%; min-height: 0; flex-direction: column; }
    .detail-scroll { flex: 1 1 auto; }
    .detail-intro { display: grid; min-height: 132px; grid-template-columns: 34px minmax(0, 1fr); align-items: start; gap: 14px; padding: 22px; border-bottom: 1px solid var(--line); }
    .detail-icon { display: grid; width: 32px; height: 32px; border: 1px solid var(--line); color: var(--muted-strong); place-items: center; }
    .detail-icon .icon { width: 15px; height: 15px; }
    .detail-intro .mini-label { margin: 1px 0 8px; }
    .detail-intro h2 { margin: 0; overflow-wrap: anywhere; font-size: 20px; font-weight: 530; line-height: 1.2; }
    .detail-intro p { max-width: 680px; margin: 8px 0 0; color: var(--muted); font-size: 11px; line-height: 1.55; }
    .detail-section { border-top: 1px solid var(--line); }
    .detail-intro + .detail-section { border-top: 0; }
    .property-list { margin: 0; }
    .property-list > div { display: grid; min-height: 48px; grid-template-columns: minmax(120px, 0.32fr) minmax(0, 1fr); align-items: center; gap: 18px; padding: 9px 16px; border-bottom: 1px solid var(--line-soft); }
    .property-list dt { color: var(--muted); font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; }
    .property-list dd { min-width: 0; margin: 0; overflow-wrap: anywhere; color: var(--muted-strong); font-size: 11px; }
    .property-list dd > code { color: var(--foreground); font-size: 10px; }
    .single-pane { height: 100%; min-height: 0; }
    .json-viewer { min-height: 100%; margin: 0; padding: 16px; overflow: auto; background: #000; color: var(--muted-strong); font-family: var(--font-mono); font-size: 10px; line-height: 1.65; tab-size: 2; white-space: pre-wrap; word-break: break-word; }
    .diagnostic { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: start; gap: 12px; min-height: 88px; padding: 16px 18px; border-bottom: 1px solid var(--line-soft); }
    .diagnostic:last-child { border-bottom: 0; }
    .diagnostic-mark { display: grid; width: 28px; height: 28px; place-items: center; border: 1px solid var(--line); color: var(--muted-strong); }
    .diagnostic-code { display: block; margin-bottom: 5px; color: var(--muted); font-size: 9px; }
    .diagnostic strong { display: block; font-size: 12px; font-weight: 540; }
    .diagnostic p { margin: 5px 0 0; color: var(--muted-strong); font-size: 11px; line-height: 1.5; }
    .diagnostic small { display: block; margin-top: 6px; color: var(--muted); font-size: 10px; line-height: 1.5; }
    .diagnostic-warning { box-shadow: inset 1px 0 var(--line-strong); }
    .system-row { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; min-height: 64px; align-items: center; gap: 10px; padding: 11px 16px; border-bottom: 1px solid var(--line-soft); }
    .system-row:last-child { border-bottom: 0; }
    .system-icon { display: grid; width: 28px; height: 28px; place-items: center; color: var(--muted-strong); }
    .system-row strong, .system-row small { display: block; }
    .system-row strong { font-size: 12px; font-weight: 520; }
    .system-row small { margin-top: 3px; overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
    .system-value { font-family: var(--font-mono); font-size: 11px; }
    .filter-control { display: flex; width: min(280px, 34vw); min-height: 34px; align-items: center; gap: 8px; padding: 0 9px; border: 1px solid var(--line); background: #000; color: var(--muted); }
    .filter-control:focus-within { border-color: var(--line-strong); color: #fff; }
    .filter-control input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--foreground); font-family: var(--font-mono); font-size: 10px; }
    .filter-control input::placeholder { color: #666; }
    .filter-control kbd { padding: 1px 5px; border: 1px solid var(--line); color: var(--muted); font-size: 9px; }
    .table-scroll { width: 100%; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; table-layout: auto; }
    th { height: 36px; padding: 0 16px; border-bottom: 1px solid var(--line); background: #030303; color: var(--muted); font-size: 9px; font-weight: 400; text-align: left; text-transform: uppercase; white-space: nowrap; }
    td { min-height: 48px; padding: 12px 16px; border-bottom: 1px solid var(--line-soft); color: var(--muted-strong); font-size: 11px; line-height: 1.55; vertical-align: top; }
    tr:last-child td { border-bottom: 0; }
    tbody tr { transition: background-color 120ms ease-out; }
    tbody tr:hover { background: rgb(255 255 255 / 0.035); }
    td code { color: var(--foreground); font-size: 10px; white-space: nowrap; }
    .file-cell { max-width: 420px; overflow: hidden; font-family: var(--font-mono); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
    .badge { display: inline-flex; min-height: 20px; align-items: center; padding: 1px 6px; border: 1px solid var(--line); color: var(--muted-strong); font-size: 9px; font-weight: 400; text-transform: uppercase; white-space: nowrap; }
    .badge-ready, .badge-page, .badge-node { border-color: var(--line-strong); color: #fff; }
    .badge-warning, .badge-attention, .badge-edge { border-style: dashed; color: #fff; }
    .badge-error { background: #fff; color: #000; }
    .badge-method { min-width: 36px; justify-content: center; border-color: var(--line-soft); color: #d0d0d0; }
    .method-list, .runtime-value, .runtime-facts { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
    .runtime-value small, .runtime-facts span { color: var(--muted); font-family: var(--font-mono); font-size: 9px; }
    .cell-detail { display: block; margin-top: 4px; color: var(--muted); font-family: var(--font-mono); font-size: 9px; }
    .route-operation { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .route-operation + .route-operation { margin-top: 5px; }
    .route-operation small { color: var(--muted); font-family: var(--font-mono); font-size: 9px; white-space: nowrap; }
    .schedule { display: block; }
    .schedule + .schedule { margin-top: 4px; }
    .muted { color: var(--muted); }
    .empty-state { display: grid; min-height: 156px; place-items: center; align-content: center; gap: 7px; padding: 24px; color: var(--muted); text-align: center; }
    .empty-state strong { color: var(--muted-strong); font-size: 12px; font-weight: 520; }
    .empty-state span { max-width: 420px; font-size: 10px; line-height: 1.5; }
    .filtered-empty { padding: 24px; color: var(--muted); font-family: var(--font-mono); font-size: 10px; text-align: center; }
    .feature-matrix > div { display: flex; min-height: 45px; align-items: center; justify-content: space-between; gap: 16px; padding: 9px 16px; border-bottom: 1px solid var(--line-soft); }
    .feature-matrix > div:last-child { border-bottom: 0; }
    .feature-matrix span:first-child { font-size: 11px; }
    .environment-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .environment-grid > div { min-height: 128px; padding: 16px; }
    .environment-grid > div + div { border-left: 1px solid var(--line); }
    .mini-label { display: block; margin-bottom: 12px; color: var(--muted); font-size: 9px; text-transform: uppercase; }
    .key-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .key-list code { padding: 4px 6px; border: 1px solid var(--line-soft); color: var(--muted-strong); font-size: 9px; }
    .layer-list > div { display: grid; grid-template-columns: minmax(120px, 0.7fr) minmax(0, 1fr) auto; min-height: 52px; align-items: center; gap: 14px; padding: 10px 16px; border-bottom: 1px solid var(--line-soft); }
    .layer-list > div:last-child { border-bottom: 0; }
    .layer-list span { display: flex; align-items: center; gap: 8px; }
    .layer-list strong { font-size: 11px; font-weight: 520; }
    .layer-list code, .layer-list small { color: var(--muted); font-size: 9px; }
    .statusbar { display: flex; min-height: 29px; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 16px; padding: 0 10px; border-top: 1px solid var(--line); background: var(--surface); color: var(--muted); font-size: 9px; text-transform: uppercase; }
    .statusbar span { display: flex; align-items: center; gap: 7px; }
    @keyframes status-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
    @media (max-width: 1100px) {
      .topbar-status { display: none; }
    }
    @media (max-width: 840px) {
      .stage { display: block; padding: 0; }
      .shell { width: 100%; height: 100dvh; min-height: 0; border: 0; }
      .topbar { flex-wrap: wrap; }
      .brand { min-width: auto; height: 40px; border-right: 0; }
      .brand-product, .brand-slash { display: none; }
      .tabbar { order: 3; width: 100%; flex-basis: 100%; border-top: 1px solid var(--line); }
      .topbar-meta { height: 40px; }
      .nav-item { min-height: 39px; }
      .split-view { grid-template-columns: 1fr; grid-template-rows: minmax(150px, 34%) minmax(0, 1fr); }
      .pane-list { border-right: 0; border-bottom: 1px solid var(--line); }
      .filter-control { width: 100%; }
    }
    @media (max-width: 560px) {
      .detail-intro { min-height: 112px; padding: 16px; }
      .detail-intro h2 { font-size: 17px; }
      .property-list > div { grid-template-columns: minmax(98px, 0.38fr) minmax(0, 1fr); gap: 12px; padding-inline: 12px; }
      .environment-grid { grid-template-columns: 1fr; }
      .environment-grid > div + div { border-top: 1px solid var(--line); border-left: 0; }
      .statusbar span:last-child { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
    }
  </style>
</head>
<body>
  <div class="stage">
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="/__farm/devtools" aria-label="Farm.js Devtools overview">
          <span class="brand-mark">F</span><span>Farm.js</span><span class="brand-slash">/</span><span class="brand-product">Devtools</span>
        </a>
        <nav class="tabbar" aria-label="Devtools views">
          ${renderNavigationItem("overview", "Overview", "overview")}
          ${renderNavigationItem("routes", "Routes", "route", snapshot.routes.length)}
          ${renderNavigationItem("api", "API", "api", snapshot.counts.apiRoutes)}
          ${renderNavigationItem("systems", "Systems", "blocks", snapshot.counts.integrations)}
          ${renderNavigationItem(
            "runtime",
            "Runtime",
            "runtime",
            snapshot.counts.cronJobs + snapshot.counts.workflows,
          )}
          ${renderNavigationItem("raw", "Raw", "terminal")}
        </nav>
        <div class="topbar-meta">
          <div class="topbar-status"><span class="status-dot status-dot-${snapshot.health}"></span>${escapeHtml(
            healthLabel,
          )} / ${escapeHtml(snapshot.project.name)}</div>
          <nav class="topbar-actions" aria-label="Devtools actions">
            <button type="button" class="action" data-copy-snapshot title="Copy runtime snapshot">${icon(
              "copy",
            )}<span class="sr-only" data-copy-label>Copy JSON</span></button>
            <button type="button" class="action" data-refresh title="Refresh snapshot">${icon(
              "refresh",
            )}<span class="sr-only">Refresh</span></button>
            <a class="action" href="/__farm/devtools.json" target="_blank" rel="noreferrer" title="Open raw JSON snapshot">${icon(
              "terminal",
            )}<span class="sr-only">JSON</span></a>
            <a class="action" href="/" title="Open application">${icon(
              "app",
            )}<span class="sr-only">App</span></a>
          </nav>
        </div>
      </header>
      <div class="workspace">
        <main class="content">
          <section class="view" data-view-panel="overview">${renderOverviewInspector(
            snapshot,
            healthLabel,
            generatedTime,
          )}</section>
          <section class="view" data-view-panel="routes" hidden>${renderRoutesInspector(
            snapshot,
          )}</section>
          <section class="view" data-view-panel="api" hidden>${renderApiInspector(
            snapshot,
          )}</section>
          <section class="view" data-view-panel="systems" hidden>${renderSystemsInspector(
            snapshot,
          )}</section>
          <section class="view" data-view-panel="runtime" hidden>${renderRuntimeInspector(
            snapshot,
          )}</section>
          <section class="view" data-view-panel="raw" hidden>${renderRawInspector(snapshot)}</section>
        </main>
      </div>
      <footer class="statusbar"><span>${icon("terminal")}Local development only</span><span>Snapshot ${escapeHtml(
        generatedTime,
      )} / ${escapeHtml(snapshot.project.srcDir)}/app</span></footer>
    </div>
  </div>
  <script>
    (() => {
      const validViews = new Set(["overview", "routes", "api", "systems", "runtime", "raw"]);
      const triggers = Array.from(document.querySelectorAll("[data-view-trigger]"));
      const panels = Array.from(document.querySelectorAll("[data-view-panel]"));
      const selectView = (view, updateHash = true) => {
        const nextView = validViews.has(view) ? view : "overview";
        triggers.forEach((trigger) => {
          trigger.setAttribute("aria-selected", String(trigger.dataset.viewTrigger === nextView));
        });
        panels.forEach((panel) => {
          panel.hidden = panel.dataset.viewPanel !== nextView;
        });
        if (updateHash) {
          history.replaceState(null, "", nextView === "overview" ? location.pathname : "#" + nextView);
          const activePanel = panels.find((panel) => panel.dataset.viewPanel === nextView);
          if (activePanel) activePanel.scrollTop = 0;
        }
      };
      triggers.forEach((trigger) => trigger.addEventListener("click", () => selectView(trigger.dataset.viewTrigger)));
      window.addEventListener("hashchange", () => selectView(location.hash.slice(1), false));
      selectView(location.hash.slice(1), false);

      document.querySelectorAll("[data-detail-trigger]").forEach((trigger) => {
        trigger.addEventListener("click", () => {
          const scope = trigger.dataset.detailTrigger;
          const id = trigger.dataset.detailId;
          document.querySelectorAll('[data-detail-trigger="' + scope + '"]').forEach((row) => {
            row.setAttribute("aria-selected", String(row.dataset.detailId === id));
          });
          document.querySelectorAll('[data-detail-panel="' + scope + '"]').forEach((panel) => {
            panel.hidden = panel.dataset.detailId !== id;
          });
        });
      });

      document.querySelectorAll("[data-filter]").forEach((input) => {
        input.addEventListener("input", () => {
          const id = input.dataset.filter;
          const query = input.value.trim().toLowerCase();
          const rows = Array.from(document.querySelectorAll('[data-filter-rows="' + id + '"] [data-search-value]'));
          let visible = 0;
          rows.forEach((row) => {
            const matches = !query || (row.dataset.searchValue || "").toLowerCase().includes(query);
            row.hidden = !matches;
            if (matches) visible += 1;
          });
          const selected = rows.find((row) => row.getAttribute("aria-selected") === "true");
          if (selected?.hidden) rows.find((row) => !row.hidden)?.click();
          const empty = document.querySelector('[data-filter-empty="' + id + '"]');
          if (empty) empty.hidden = visible !== 0;
        });
      });

      document.addEventListener("keydown", (event) => {
        if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
        const panel = document.querySelector("[data-view-panel]:not([hidden])");
        const input = panel?.querySelector("[data-filter]");
        if (input) {
          event.preventDefault();
          input.focus();
        }
      });

      document.querySelector("[data-refresh]")?.addEventListener("click", () => location.reload());
      document.querySelector("[data-copy-snapshot]")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        const label = button.querySelector("[data-copy-label]");
        try {
          const response = await fetch("/__farm/devtools.json", { cache: "no-store" });
          const value = JSON.stringify(await response.json(), null, 2);
          if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
          else {
            const textarea = document.createElement("textarea");
            textarea.value = value;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            textarea.remove();
          }
          button.dataset.copied = "true";
          if (label) label.textContent = "Copied";
          setTimeout(() => {
            button.dataset.copied = "false";
            if (label) label.textContent = "Copy JSON";
          }, 1600);
        } catch {
          if (label) label.textContent = "Copy failed";
        }
      });
    })();
  </script>
</body>
</html>`;
}
