import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";
import "./panel.css";
import type { FarmDevtoolsSnapshot } from "@farm.js/core";
import type { InspectedModule, ModuleDetails } from "./types.js";
import { DEVTOOLS_PATH } from "./types.js";
import { codeBlock, escapeHtml as esc, heading, property } from "./ui.js";
import { icon } from "./icons.js";

export function startPanel(root: HTMLElement) {
  const window = root.ownerDocument.defaultView!;
  const document = root.ownerDocument;
  const views = [
    ["overview", "Overview", "overview"],
    ["routes", "Routes", "route"],
    ["api", "API", "api"],
    ["systems", "Systems", "layers"],
    ["runtime", "Runtime", "runtime"],
    ...(root.dataset.inspect === "true" ? [["inspect", "Inspect", "search"]] : []),
    ["diagnostics", "Diagnostics", "activity"],
    ["raw", "Snapshot", "terminal"],
  ];
  let view = views.some(([key]) => key === window.location.hash.slice(1))
    ? window.location.hash.slice(1)
    : "overview";
  let snapshot: FarmDevtoolsSnapshot | undefined;
  let selectedRoute = 0;
  let selectedApi = 0;
  let selectedModule = "";
  let modules: InspectedModule[] = [];
  let refreshSequence = 0;
  let moduleSequence = 0;
  let disposed = false;
  let controller: AbortController | undefined;
  let moduleController: AbortController | undefined;
  const copyValues = new Map<string, string>();
  let theme = "system";
  try {
    const saved = window.localStorage.getItem("farm:devtools:theme");
    if (saved === "light" || saved === "dark") theme = saved;
  } catch {
    /* Storage can be blocked. */
  }
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => theme === "dark" || (theme === "system" && systemTheme.matches);
  const applyTheme = () => {
    root.dataset.theme = theme;
    root.style.colorScheme = theme === "light" || theme === "dark" ? theme : "light dark";
    const button = root.querySelector<HTMLButtonElement>("[data-theme-toggle]");
    if (button) {
      const label = isDark() ? "Switch to light theme" : "Switch to dark theme";
      button.innerHTML = icon(isDark() ? "sun" : "moon");
      button.setAttribute("aria-label", label);
      button.title = label;
    }
  };
  applyTheme();
  root.innerHTML = `<header class="fd-header"><img class="fd-logo" src="${DEVTOOLS_PATH}/assets/logo.svg" alt="Farm.js logo"><span class="fd-brand">FARM.JS</span><span class="fd-muted">/</span><span>DevTools</span><div class="fd-header-actions"><button type="button" class="fd-icon-button" data-refresh aria-label="Refresh DevTools">${icon("refresh")}</button><button type="button" class="fd-icon-button" data-theme-toggle aria-label="Switch theme"></button><button type="button" class="fd-icon-button" data-close aria-label="Close DevTools">${icon("close")}</button></div></header><div class="fd-error" role="alert" data-error hidden></div><div class="fd-body"><nav class="fd-sidebar" aria-label="DevTools navigation"><div class="fd-label fd-group-label">WORKSPACE</div>${views.map(([key, label, image]) => `<button type="button" class="fd-nav-button" data-view="${key}">${icon(image as Parameters<typeof icon>[0])}<span class="fd-button-label">${label}</span><span class="fd-count" data-count="${key}"></span></button>`).join("")}</nav><main class="fd-main" data-main></main></div><footer class="fd-footer"><span class="fd-footer-label">Development only</span><div class="fd-footer-status"><span data-status role="status">Loading workspace…</span><span data-feedback role="status"></span></div><span class="fd-footer-label">Esc to close</span></footer>`;
  const main = root.querySelector<HTMLElement>("[data-main]")!;
  const status = root.querySelector<HTMLElement>("[data-status]")!;
  const feedback = root.querySelector<HTMLElement>("[data-feedback]")!;
  const errorBox = root.querySelector<HTMLElement>("[data-error]")!;
  const empty = (text: string) => `<div class="fd-empty">${esc(text)}</div>`;
  const inlineCode = (text: string) => `<code>${esc(text)}</code>`;
  const runtime = (value: FarmDevtoolsSnapshot["apiRoutes"][number]["runtime"] | undefined) =>
    value
      ? `${value.runtime}${value.regions?.length ? " · " + value.regions.join(", ") : ""}${value.maxDuration ? " · " + value.maxDuration + "s" : ""}`
      : "Inherited";
  const close = () => {
    if (window.parent !== window)
      window.parent.postMessage({ type: "farm:devtools:close" }, window.location.origin);
    else window.location.assign("/");
  };
  function navigate(next: string) {
    if (!views.some(([key]) => key === next)) return;
    view = next;
    window.history.replaceState(null, "", `#${view}`);
    render();
  }
  async function get<T>(path: string, signal: AbortSignal): Promise<T> {
    const response = await window.fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(
        typeof body?.error === "string"
          ? body.error
          : `DevTools request failed (${response.status}).`,
      );
    }
    return response.json() as Promise<T>;
  }
  async function refresh() {
    const sequence = ++refreshSequence;
    controller?.abort();
    controller = new AbortController();
    root.setAttribute("aria-busy", "true");
    status.textContent = "Refreshing workspace…";
    errorBox.hidden = true;
    if (!snapshot) main.innerHTML = empty("Loading the current Farm workspace…");
    try {
      const next = await get<FarmDevtoolsSnapshot>(`${DEVTOOLS_PATH}.json`, controller.signal);
      if (disposed || sequence !== refreshSequence) return;
      if (!next.project || !next.counts || !Array.isArray(next.routes))
        throw new Error(
          "Unexpected DevTools snapshot. Check that core and the plugin are up to date.",
        );
      snapshot = next;
      selectedRoute = Math.min(selectedRoute, Math.max(0, next.routes.length - 1));
      selectedApi = Math.min(selectedApi, Math.max(0, next.apiRoutes.length - 1));
      status.textContent = `${next.project.name} · Updated ${new Date(next.generatedAt).toLocaleTimeString()}`;
      render();
    } catch (error) {
      if (disposed || sequence !== refreshSequence) return;
      errorBox.textContent = (error as Error).message;
      errorBox.hidden = false;
      status.textContent = snapshot ? "Showing the last snapshot" : "Workspace unavailable";
      if (!snapshot) main.innerHTML = empty("Use Refresh to reconnect to the development server.");
    } finally {
      if (sequence === refreshSequence) root.removeAttribute("aria-busy");
    }
  }
  function diagnosticRows() {
    return (
      snapshot!.diagnostics
        .map(
          (item) =>
            `<article class="fd-diagnostic"><span class="${item.severity === "error" ? "fd-danger" : "fd-amber"}">${icon(item.severity === "error" ? "activity" : "shield")}</span><div><div class="fd-label">${esc(item.code)} · ${esc(item.severity)}</div><h3>${esc(item.title)}</h3><p>${esc(item.message)}</p>${item.action ? `<p>${esc(item.action)}</p>` : ""}</div></article>`,
        )
        .join("") ||
      `<div class="fd-diagnostic"><span class="fd-green">${icon("shield")}</span><div><h3>Framework checks passed</h3><p>No runtime configuration diagnostics in this snapshot.</p></div></div>`
    );
  }
  function overview() {
    const data = snapshot!;
    main.innerHTML =
      heading("Overview", `${data.project.name} · ${data.project.srcDir}`, "Development") +
      `<div class="fd-stats">${[
        ["PAGES", data.counts.pages],
        ["API ROUTES", data.counts.apiRoutes],
        ["INTEGRATIONS", data.counts.integrations],
      ]
        .map(
          ([name, value]) =>
            `<div class="fd-stat"><span class="fd-label">${name}</span><span class="fd-stat-value">${value}</span></div>`,
        )
        .join(
          "",
        )}</div><section class="fd-section"><div class="fd-section-heading"><h3>Application routes</h3><button type="button" class="fd-link-button" data-go="routes"><span class="fd-button-label">View all routes</span>${icon("external")}</button></div><div class="fd-route-preview">${
        data.routes
          .map((route, index) => ({ route, index }))
          .filter(({ route }) => route.kind === "page")
          .slice(0, 5)
          .map(
            ({ route, index }) =>
              `<button type="button" class="fd-preview-row" data-route="${index}">${inlineCode(route.pattern)}<span class="fd-preview-meta">${esc(runtime(route.runtime))}</span>${icon("chevron")}</button>`,
          )
          .join("") || empty("No page routes discovered.")
      }</div></section><section class="fd-section"><div class="fd-section-heading"><h3>Diagnostics</h3><button type="button" class="fd-link-button" data-go="diagnostics"><span class="fd-button-label">${data.counts.diagnostics} notices</span>${icon("external")}</button></div>${diagnosticRows()}</section>`;
    main.querySelectorAll<HTMLButtonElement>("[data-route]").forEach(
      (button) =>
        (button.onclick = () => {
          selectedRoute = Number(button.dataset.route);
          navigate("routes");
        }),
    );
  }
  function browser(api: boolean) {
    const data = snapshot!;
    main.innerHTML =
      heading(
        api ? "API" : "Routes",
        api
          ? "Registered methods and effective server runtime controls."
          : "Pages, layouts, loading states, and error boundaries.",
      ) +
      `<div class="fd-filter-row"><label class="fd-search">${icon("search")}<input type="search" aria-label="${api ? "Filter APIs" : "Filter routes"}" placeholder="Filter by path, ${api ? "method" : "kind"}, or source…" data-filter><kbd>/</kbd></label></div><div class="fd-browser"><div class="fd-list" data-list></div><section class="fd-detail" data-detail aria-label="Selected ${api ? "API" : "route"}"></section></div>`;
    const rows = api
      ? data.apiRoutes.map((route, index) => ({
          index,
          path: route.path,
          kind: route.methods.join(" / "),
          file: route.filePath,
        }))
      : data.routes.map((route, index) => ({
          index,
          path: route.pattern,
          kind: route.kind,
          file: route.filePath,
        }));
    const filter = main.querySelector<HTMLInputElement>("[data-filter]")!;
    const list = main.querySelector<HTMLElement>("[data-list]")!;
    function details() {
      const index = api ? selectedApi : selectedRoute;
      const row = rows[index];
      const target = main.querySelector<HTMLElement>("[data-detail]")!;
      if (!row) {
        target.innerHTML = empty("Nothing selected.");
        return;
      }
      const item = api ? data.apiRoutes[index] : data.routes[index];
      target.innerHTML = `<div class="fd-detail-title">${icon(api ? "api" : "route")}${inlineCode(row.path)}</div><dl class="fd-properties">${property("Source", row.file)}${property(api ? "Methods" : "Kind", row.kind)}${property("Runtime", runtime(item.runtime))}${property("Regions", item.runtime?.regions?.join(", ") || "Not overridden")}${property("Max duration", item.runtime?.maxDuration ? `${item.runtime.maxDuration}s` : "Not overridden")}</dl><div class="fd-detail-sub"><button class="fd-link-button" type="button" data-copy="route-source">${icon("copy")}<span class="fd-button-label">Copy source path</span></button></div>${api ? '<p class="fd-subtitle">Read-only metadata. Inspecting an endpoint does not send a request.</p>' : ""}`;
      copyValues.set("route-source", row.file);
      list
        .querySelectorAll<HTMLButtonElement>("button")
        .forEach((button) =>
          button.setAttribute("aria-pressed", String(Number(button.dataset.select) === index)),
        );
    }
    function filterRows() {
      const query = filter.value.toLowerCase();
      list.innerHTML =
        rows
          .filter((row) =>
            (row.path + " " + row.kind + " " + row.file).toLowerCase().includes(query),
          )
          .map(
            (row) =>
              `<button type="button" class="fd-list-button" data-select="${row.index}" aria-pressed="${row.index === (api ? selectedApi : selectedRoute)}">${inlineCode(row.path)}<span class="fd-preview-meta">${esc(row.kind)}</span></button>`,
          )
          .join("") || empty("No matches. Try another path, kind, or source.");
      list.querySelectorAll<HTMLButtonElement>("button").forEach(
        (button) =>
          (button.onclick = () => {
            if (api) selectedApi = Number(button.dataset.select);
            else selectedRoute = Number(button.dataset.select);
            details();
          }),
      );
    }
    filter.oninput = filterRows;
    filterRows();
    details();
  }
  function systems() {
    const data = snapshot!;
    main.innerHTML =
      heading("Systems", "Configured integrations, middleware, and storage.") +
      `<section class="fd-section fd-flush-top"><div class="fd-section-heading"><h3>Integrations</h3><span class="fd-label">${data.integrations.length} REGISTERED</span></div>${data.integrations.map((item) => `<details><summary>${esc(item.key)} <span class="fd-muted">/ ${esc(item.type)}</span></summary><dl class="fd-properties">${property("Category", item.category)}${property("Runtime", item.serverRuntime ? "Server" : "Platform")}${property("Middleware", String(item.middlewareCount))}${property("Providers", String(item.providerCount))}${property("Schema models", String(item.schemaModelCount))}</dl>${item.routes.map((route) => `<div class="fd-tree-item">${inlineCode(route.methods.join(" / ") + " " + route.path)}</div>`).join("")}</details>`).join("") || empty("No integrations configured.")}</section><section class="fd-section"><h3>Request middleware</h3>${data.middleware.map((item) => `<div class="fd-system-row">${icon("shield")}<div>${inlineCode(item.path)}<p>${esc(item.filePath || item.source)}</p></div><span class="fd-tag">${item.handlerCount} handlers</span></div>`).join("") || empty("No request middleware configured.")}</section><section class="fd-section"><h3>KV mounts</h3>${data.storage.map((item) => `<div class="fd-system-row">${icon("database")}<div>${inlineCode(item.mount)}<p>${esc(item.driver)}</p></div><span class="fd-tag">${item.default ? "Default" : "Configured"}</span></div>`).join("") || empty("No storage mounts.")}</section>`;
  }
  function renderRuntime() {
    const data = snapshot!;
    main.innerHTML =
      heading("Runtime", "Resolved deployment, schedules, layers, and environment.", "Read only") +
      `<section class="fd-section fd-flush-top"><div class="fd-runtime-grid"><dl class="fd-properties">${property("Target", data.deployment.target)}${property("Nitro preset", data.deployment.preset)}${property("Output", data.deployment.outputDir || "Default")}</dl><dl class="fd-properties">${property("Project", data.project.name)}${property("Source", data.project.srcDir)}${property("Base path", data.project.basePath || "/")}</dl></div></section><section class="fd-section"><div class="fd-section-heading"><h3>Environment</h3><span class="fd-label">KEY NAMES ONLY</span></div><dl class="fd-properties">${property("Server", data.environment.server.join(", ") || "None declared")}${property("Public", data.environment.public.join(", ") || "None declared")}</dl><p class="fd-subtitle">Values and credentials are never included.</p></section><section class="fd-section"><h3>Schedules</h3>${data.cron.map((job) => `<div class="fd-system-row">${icon("clock")}<div>${inlineCode(job.name)}<p>${esc(job.path)}</p></div><span class="fd-mono">${esc(job.schedule.join(" / "))} UTC</span></div>`).join("") || empty("No cron schedules configured.")}<details><summary>Workflows (${data.workflows.length})</summary>${data.workflows.map((item) => `<div class="fd-tree-item">${inlineCode(item.id)} ${inlineCode(item.routePath)}</div>`).join("") || empty("No workflows discovered.")}</details><details><summary>Layers (${data.layers.length})</summary>${data.layers.map((item) => `<div class="fd-tree-item">${inlineCode(item.name)} ${inlineCode(item.source)}</div>`).join("") || empty("No layers configured.")}</details><details><summary>Framework features</summary><dl class="fd-properties">${Object.entries(
        data.features,
      )
        .map(([key, value]) => property(key, value ? "On" : "Off"))
        .join("")}</dl></details></section>`;
  }
  async function inspect() {
    const sequence = ++moduleSequence;
    moduleController?.abort();
    moduleController = new AbortController();
    const signal = moduleController.signal;
    main.innerHTML =
      heading("Inspect", "Browser source and the JavaScript Vite actually served.", "Read only") +
      `<div class="fd-inspect-toolbar"><label class="fd-label" for="module-select">MODULE</label><select id="module-select" disabled><option>Loading browser modules…</option></select></div><div data-inspected>${empty("Loading module graph…")}</div>`;
    const target = main.querySelector<HTMLElement>("[data-inspected]")!;
    const select = main.querySelector<HTMLSelectElement>("select")!;
    try {
      const result = await get<{ modules: InspectedModule[]; limited: boolean }>(
        `${DEVTOOLS_PATH}/modules.json`,
        signal,
      );
      if (disposed || sequence !== moduleSequence || view !== "inspect") return;
      modules = result.modules;
      if (!modules.length) {
        select.replaceChildren(new Option("No browser modules yet", ""));
        target.innerHTML = empty(
          "Visit an app page, then refresh DevTools. Only transformed browser modules inside this project are listed.",
        );
        return;
      }
      select.replaceChildren(
        ...modules.map(
          (item) =>
            new Option(
              item.path +
                (item.url.includes("?") ? " " + item.url.slice(item.url.indexOf("?")) : ""),
              item.id,
            ),
        ),
      );
      select.disabled = false;
      if (!modules.some((item) => item.id === selectedModule)) selectedModule = modules[0].id;
      select.value = selectedModule;
      select.onchange = () => {
        selectedModule = select.value;
        void loadModule(selectedModule);
      };
      if (result.limited) feedback.textContent = "Inspect lists the first 500 browser modules.";
      await loadModule(selectedModule);
    } catch (error) {
      if (disposed || sequence !== moduleSequence || view !== "inspect") return;
      target.innerHTML = empty((error as Error).message);
      select.replaceChildren(new Option("Module graph unavailable", ""));
    }
  }
  async function loadModule(id: string) {
    const sequence = ++moduleSequence;
    moduleController?.abort();
    moduleController = new AbortController();
    const target = main.querySelector<HTMLElement>("[data-inspected]")!;
    target.innerHTML = empty("Reading module…");
    try {
      const detail = await get<ModuleDetails>(
        `${DEVTOOLS_PATH}/module.json?id=${encodeURIComponent(id)}`,
        moduleController.signal,
      );
      if (disposed || sequence !== moduleSequence || view !== "inspect") return;
      copyValues.set("module-source", detail.source);
      copyValues.set("module-output", detail.transformed);
      target.innerHTML = `<div class="fd-pipeline"><span class="fd-label">SOURCE → VITE OUTPUT</span><p class="fd-subtitle">Current file on disk and the latest cached browser transform. Refresh the app after edits.</p></div><div class="fd-comparison">${codeBlock(detail.source, "Source", "module-source")}${codeBlock(detail.transformed, "Served JavaScript", "module-output")}</div><section class="fd-section"><details><summary>Imports (${detail.imports.length})</summary>${detail.imports.map((item) => `<div class="fd-tree-item">${inlineCode(item)}</div>`).join("") || empty("No imports.")}</details><details><summary>Importers (${detail.importers.length})</summary>${detail.importers.map((item) => `<div class="fd-tree-item">${inlineCode(item)}</div>`).join("") || empty("No importers.")}</details></section>`;
    } catch (error) {
      if (disposed || sequence !== moduleSequence || view !== "inspect") return;
      target.innerHTML = empty((error as Error).message);
    }
  }
  function render() {
    if (!snapshot) return;
    moduleController?.abort();
    ++moduleSequence;
    copyValues.clear();
    feedback.textContent = "";
    root.querySelectorAll<HTMLElement>("[data-view]").forEach((button) => {
      if (button.dataset.view === view) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    const counts: Record<string, number> = {
      routes: snapshot.routes.length,
      api: snapshot.apiRoutes.length,
      diagnostics: snapshot.diagnostics.length,
    };
    root
      .querySelectorAll<HTMLElement>("[data-count]")
      .forEach(
        (item) =>
          (item.textContent =
            counts[item.dataset.count!] === undefined ? "" : String(counts[item.dataset.count!])),
      );
    switch (view) {
      case "overview":
        overview();
        break;
      case "routes":
        browser(false);
        break;
      case "api":
        browser(true);
        break;
      case "systems":
        systems();
        break;
      case "runtime":
        renderRuntime();
        break;
      case "diagnostics":
        main.innerHTML =
          heading("Diagnostics", "The same runtime checks used by farm doctor.") +
          `<section class="fd-section fd-flush-top">${diagnosticRows()}</section>`;
        break;
      case "raw": {
        const source = JSON.stringify(snapshot, null, 2);
        copyValues.set("snapshot", source);
        main.innerHTML =
          heading("Snapshot", "Machine-readable workspace data. Environment values are excluded.") +
          codeBlock(source, "Runtime JSON", "snapshot");
        break;
      }
      case "inspect":
        void inspect();
        break;
    }
    main
      .querySelectorAll<HTMLButtonElement>("[data-go]")
      .forEach((button) => (button.onclick = () => navigate(button.dataset.go!)));
  }
  const onClick = async (event: Event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-copy]");
    if (!button) return;
    const source = copyValues.get(button.dataset.copy!);
    if (source === undefined) return;
    try {
      await window.navigator.clipboard.writeText(source);
      feedback.textContent = "Copied to clipboard";
    } catch {
      feedback.textContent = "Copy was blocked. Select the code and copy it manually.";
    }
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (
      event.key === "/" &&
      !["INPUT", "SELECT", "TEXTAREA"].includes((event.target as Element).tagName)
    ) {
      const filter = main.querySelector<HTMLInputElement>("[data-filter]");
      if (filter) {
        event.preventDefault();
        filter.focus();
        return;
      }
    }
    if (event.key === "Tab") {
      const controls = [
        ...root.querySelectorAll<HTMLElement>("button,input,select,summary,a[href]"),
      ].filter((item) => !item.hasAttribute("disabled") && item.getClientRects().length);
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault();
        controls[0]?.focus();
      }
    }
    if (window.parent !== window)
      window.parent.postMessage(
        {
          type: "farm:devtools:keydown",
          event: {
            key: event.key,
            code: event.code,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
            repeat: event.repeat,
          },
        },
        window.location.origin,
      );
  };
  root
    .querySelectorAll<HTMLButtonElement>("[data-view]")
    .forEach((button) => (button.onclick = () => navigate(button.dataset.view!)));
  root.querySelector<HTMLButtonElement>("[data-close]")!.onclick = close;
  root.querySelector<HTMLButtonElement>("[data-refresh]")!.onclick = () => void refresh();
  root.querySelector<HTMLButtonElement>("[data-theme-toggle]")!.onclick = () => {
    theme = isDark() ? "light" : "dark";
    applyTheme();
    try {
      window.localStorage.setItem("farm:devtools:theme", theme);
    } catch {
      /* Optional persistence. */
    }
    feedback.textContent = theme + " theme";
  };
  applyTheme();
  systemTheme.addEventListener("change", applyTheme);
  root.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeydown);
  root.querySelector<HTMLButtonElement>("[data-close]")!.focus();
  void refresh();
  return {
    dispose() {
      disposed = true;
      controller?.abort();
      moduleController?.abort();
      root.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeydown);
      systemTheme.removeEventListener("change", applyTheme);
    },
  };
}

const root = document.getElementById("farm-devtools");
if (root) startPanel(root);
