"use client";

import "@fontsource-variable/geist-mono/wght.css";
import type { HintsOverlayOpen, HintsOverlayPosition } from "./config.js";
import type { HintCategory, HintIssue, HintMetric, HintsSnapshot } from "./types.js";

export interface HintsOverlay {
  update(snapshot: HintsSnapshot): void;
  destroy(): void;
}

const CATEGORIES: Array<{ id: "all" | HintCategory; label: string }> = [
  { id: "all", label: "All" },
  { id: "accessibility", label: "A11y" },
  { id: "performance", label: "Perf" },
  { id: "html", label: "HTML" },
  { id: "third-party", label: "3rd party" },
];

export function createHintsOverlay(input: {
  window: Window;
  position: HintsOverlayPosition;
  open: HintsOverlayOpen;
  onRescan(): void;
}): HintsOverlay {
  const { document } = input.window;
  const host = document.createElement("farm-hints");
  host.dataset.farmHints = "";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `${template()}<style>${styles}</style>`;
  let destroyed = false;
  const attach = () => {
    if (!destroyed && !host.isConnected) document.body.append(host);
  };
  const fontLoad = document.fonts?.load('620 10px "Geist Mono Variable"');
  if (fontLoad) void fontLoad.then(attach, attach);
  else attach();

  const root = required<HTMLElement>(shadow, ".root");
  const panel = required<HTMLElement>(shadow, ".panel");
  const launcher = required<HTMLButtonElement>(shadow, ".launcher");
  const counts = Array.from(shadow.querySelectorAll<HTMLElement>("[data-count]"));
  const route = required<HTMLElement>(shadow, "[data-route]");
  const scanState = required<HTMLElement>(shadow, "[data-scan-state]");
  const metricList = required<HTMLElement>(shadow, "[data-metrics]");
  const filterList = required<HTMLElement>(shadow, "[data-filters]");
  const issueList = required<HTMLElement>(shadow, "[data-issues]");
  const empty = required<HTMLElement>(shadow, "[data-empty]");
  const highlight = required<HTMLElement>(shadow, ".highlight");
  root.dataset.position = input.position;

  let current: HintsSnapshot = {
    pathname: input.window.location.pathname,
    scanning: true,
    issues: [],
    metrics: [],
  };
  let filter: "all" | HintCategory = "all";
  let expandedIssue: string | undefined;
  let expanded = input.open === "always";
  let autoOpened = input.open !== "issues";
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;

  renderFilters();
  setExpanded(expanded);

  shadow.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    const action = target?.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "toggle") {
      setExpanded(!expanded);
      return;
    }
    if (action === "rescan") {
      input.onRescan();
      return;
    }
    const filterButton = target?.closest<HTMLButtonElement>("[data-filter]");
    if (filterButton?.dataset.filter) {
      filter = filterButton.dataset.filter as typeof filter;
      expandedIssue = undefined;
      renderFilters();
      renderIssues();
      return;
    }
    const issueButton = target?.closest<HTMLButtonElement>("[data-issue]");
    if (issueButton?.dataset.issue) {
      expandedIssue =
        expandedIssue === issueButton.dataset.issue ? undefined : issueButton.dataset.issue;
      renderIssues();
      const issue = current.issues.find((candidate) => candidate.id === issueButton.dataset.issue);
      if (issue?.selector) highlightTarget(issue.selector);
    }
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && expanded) {
      setExpanded(false);
      launcher.focus();
    }
  };
  input.window.addEventListener("keydown", onKeyDown);

  function update(snapshot: HintsSnapshot): void {
    current = snapshot;
    if (!autoOpened && !snapshot.scanning) {
      autoOpened = true;
      if (snapshot.issues.length > 0) setExpanded(true);
    }
    for (const count of counts) count.textContent = String(snapshot.issues.length);
    launcher.dataset.clean = String(!snapshot.scanning && snapshot.issues.length === 0);
    route.textContent = snapshot.pathname || "/";
    route.title = snapshot.pathname || "/";
    scanState.textContent = snapshot.scanning ? "Scanning" : "Current route";
    renderMetrics(snapshot.metrics);
    renderFilters();
    renderIssues();
  }

  function setExpanded(value: boolean): void {
    expanded = value;
    panel.hidden = !value;
    launcher.hidden = value;
    root.dataset.expanded = String(value);
    if (value)
      required<HTMLButtonElement>(shadow, "[data-action=toggle]").focus({ preventScroll: true });
  }

  function renderFilters(): void {
    filterList.replaceChildren();
    for (const category of CATEGORIES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "filter";
      button.dataset.filter = category.id;
      button.dataset.active = String(filter === category.id);
      button.textContent = category.label;
      button.setAttribute("aria-pressed", String(filter === category.id));
      const categoryCount =
        category.id === "all"
          ? current.issues.length
          : current.issues.filter((issue) => issue.category === category.id).length;
      button.setAttribute("aria-label", `${category.label}, ${categoryCount} findings`);
      const number = document.createElement("span");
      number.textContent = String(categoryCount);
      button.append(number);
      filterList.append(button);
    }
  }

  function renderMetrics(metrics: HintMetric[]): void {
    metricList.replaceChildren();
    metricList.hidden = metrics.length === 0;
    for (const metric of metrics) {
      const item = document.createElement("div");
      item.className = "metric";
      item.dataset.status = metric.status;
      const label = document.createElement("span");
      label.className = "metric-label";
      label.textContent = metric.id;
      const value = document.createElement("strong");
      value.textContent = formatMetric(metric);
      item.append(label, value);
      metricList.append(item);
    }
  }

  function renderIssues(): void {
    issueList.replaceChildren();
    const visible =
      filter === "all"
        ? current.issues
        : current.issues.filter((issue) => issue.category === filter);
    empty.hidden = current.scanning || visible.length > 0;
    empty.textContent =
      current.issues.length === 0 ? "No hints on this route." : "No hints in this group.";

    if (current.scanning && current.issues.length === 0) {
      const loading = document.createElement("div");
      loading.className = "loading";
      loading.innerHTML = "<i></i><i></i><i></i>";
      loading.setAttribute("aria-label", "Scanning page");
      issueList.append(loading);
      return;
    }

    const groups = groupIssues(visible);
    for (const [category, issues] of groups) {
      const section = document.createElement("section");
      const heading = document.createElement("div");
      heading.className = "group-heading";
      const label = document.createElement("span");
      label.textContent = categoryLabel(category);
      const groupCount = document.createElement("span");
      groupCount.textContent = String(issues.length).padStart(2, "0");
      heading.append(label, groupCount);
      section.append(heading);

      for (const issue of issues) section.append(renderIssue(issue));
      issueList.append(section);
    }
  }

  function renderIssue(issue: HintIssue): HTMLElement {
    const wrapper = document.createElement("article");
    wrapper.className = "issue";
    wrapper.dataset.severity = issue.severity;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.issue = issue.id;
    button.className = "issue-button";
    button.setAttribute("aria-expanded", String(expandedIssue === issue.id));
    const marker = document.createElement("span");
    marker.className = "severity-dot";
    marker.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    copy.className = "issue-copy";
    const title = document.createElement("strong");
    title.textContent = issue.title;
    const meta = document.createElement("span");
    meta.className = "issue-meta";
    meta.textContent = `${severityLabel(issue.severity)} · ${categoryLabel(issue.category)}`;
    copy.append(title, meta);
    const caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = "+";
    caret.setAttribute("aria-hidden", "true");
    button.append(marker, copy, caret);
    wrapper.append(button);

    if (expandedIssue === issue.id) {
      const details = document.createElement("div");
      details.className = "issue-details";
      const detail = document.createElement("p");
      detail.textContent = issue.detail;
      details.append(detail);
      if (issue.selector) {
        const selector = document.createElement("code");
        selector.textContent = issue.selector;
        details.append(selector);
      }
      if (issue.snippet) {
        const snippet = document.createElement("pre");
        snippet.textContent = issue.snippet;
        details.append(snippet);
      }
      if (issue.helpUrl) {
        const link = document.createElement("a");
        link.href = issue.helpUrl;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = "Read guidance ↗";
        details.append(link);
      }
      wrapper.append(details);
    }
    return wrapper;
  }

  function highlightTarget(selector: string): void {
    let target: Element | null = null;
    try {
      target = document.querySelector(selector);
    } catch {
      return;
    }
    if (!target || target === host || host.contains(target)) return;
    target.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = target.getBoundingClientRect();
    highlight.style.setProperty("--x", `${rect.left}px`);
    highlight.style.setProperty("--y", `${rect.top}px`);
    highlight.style.setProperty("--w", `${rect.width}px`);
    highlight.style.setProperty("--h", `${rect.height}px`);
    highlight.dataset.visible = "true";
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      highlight.dataset.visible = "false";
    }, 1_600);
  }

  return {
    update,
    destroy() {
      destroyed = true;
      if (highlightTimer) clearTimeout(highlightTimer);
      input.window.removeEventListener("keydown", onKeyDown);
      host.remove();
    },
  };
}

function groupIssues(issues: HintIssue[]): Map<HintCategory, HintIssue[]> {
  const groups = new Map<HintCategory, HintIssue[]>();
  for (const issue of issues) {
    const group = groups.get(issue.category) ?? [];
    group.push(issue);
    groups.set(issue.category, group);
  }
  return groups;
}

function formatMetric(metric: HintMetric): string {
  if (metric.unit === "score") return metric.value.toFixed(3);
  return `${Math.round(metric.value)} ms`;
}

function categoryLabel(category: HintCategory): string {
  return {
    accessibility: "Accessibility",
    performance: "Performance",
    html: "HTML",
    "third-party": "Third party",
  }[category];
}

function severityLabel(severity: HintIssue["severity"]): string {
  return severity === "info" ? "Note" : severity;
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Farm Hints overlay is missing ${selector}`);
  return element;
}

function template(): string {
  return `<div class="root">
    <button class="launcher" type="button" data-action="toggle" aria-label="Open Farm Hints">
      <span class="launcher-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="launcher-label">Hints</span>
      <span class="launcher-count" data-count aria-live="polite">0</span>
    </button>
    <aside class="panel" role="region" aria-label="Farm Hints" hidden>
      <header class="header">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
          <div><span class="eyebrow">Farm.js</span><strong>Hints</strong></div>
        </div>
        <div class="header-actions">
          <button type="button" data-action="rescan" aria-label="Scan this route again" title="Scan again">↻</button>
          <button type="button" data-action="toggle" aria-label="Collapse Farm Hints" title="Collapse">−</button>
        </div>
      </header>
      <div class="route-row">
        <span data-scan-state>Scanning</span>
        <code data-route>/</code>
        <strong data-count>0</strong>
      </div>
      <div class="metrics" data-metrics hidden></div>
      <nav class="filters" data-filters aria-label="Hint categories"></nav>
      <div class="issue-list" data-issues></div>
      <div class="empty" data-empty hidden></div>
      <footer><span>Development only</span><span>Esc to close</span></footer>
    </aside>
    <div class="highlight" data-visible="false" aria-hidden="true"></div>
  </div>`;
}

const styles = String.raw`
  :host { all: initial; color-scheme: light dark; }
  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button, a { -webkit-tap-highlight-color: transparent; }
  button { font: inherit; }
  .root {
    --bg: #fbfbfa;
    --surface: #f3f3f0;
    --surface-strong: #e8e8e3;
    --line: #d9d9d3;
    --text: #1b1b19;
    --muted: #74746d;
    --critical: #c33e35;
    --serious: #d55d32;
    --warning: #bd7b16;
    --info: #4074bd;
    --good: #35855a;
    position: fixed;
    inset: auto 18px 18px auto;
    z-index: 2147483646;
    color: var(--text);
    font: 13px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    text-rendering: geometricPrecision;
  }
  .root[data-position="bottom-left"] { right: auto; left: 18px; }
  .panel {
    width: min(390px, calc(100vw - 24px));
    max-height: min(690px, calc(100vh - 36px));
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: color-mix(in srgb, var(--bg) 96%, transparent);
    box-shadow: 0 22px 70px rgb(0 0 0 / 18%), 0 2px 8px rgb(0 0 0 / 8%);
    backdrop-filter: blur(18px);
  }
  .launcher {
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 42px;
    padding: 0 7px 0 12px;
    border: 1px solid var(--line);
    border-radius: 999px;
    color: var(--text);
    background: var(--bg);
    box-shadow: 0 10px 32px rgb(0 0 0 / 16%);
    cursor: pointer;
  }
  .launcher:hover { background: var(--surface); }
  .launcher-mark, .brand-mark { display: grid; gap: 2px; width: 13px; }
  .launcher-mark i, .brand-mark i { display: block; height: 2px; background: currentColor; }
  .launcher-mark i:nth-child(2), .brand-mark i:nth-child(2) { width: 9px; }
  .launcher-mark i:nth-child(3), .brand-mark i:nth-child(3) { width: 5px; }
  .launcher-label, .launcher-count, .eyebrow, .route-row span, .route-row strong,
  .filter, .metric-label, .issue-meta, .group-heading, footer {
    font-family: "Geist Mono Variable", "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variation-settings: "wght" 620;
    letter-spacing: 0;
    text-transform: uppercase;
  }
  .launcher-label { font-size: 11px; }
  .launcher-count {
    display: grid;
    place-items: center;
    min-width: 28px;
    height: 28px;
    padding: 0 7px;
    border-radius: 999px;
    color: white;
    background: var(--serious);
    font-size: 11px;
  }
  .launcher[data-clean="true"] .launcher-count { background: var(--good); }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 66px;
    padding: 0 14px 0 17px;
    border-bottom: 1px solid var(--line);
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-mark { color: var(--serious); }
  .brand > div { display: grid; gap: 1px; }
  .brand strong { font-size: 15px; letter-spacing: -0.015em; }
  .eyebrow { color: var(--muted); font-size: 9px; }
  .header-actions { display: flex; gap: 4px; }
  .header-actions button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 8px;
    color: var(--muted);
    background: transparent;
    font-size: 18px;
    cursor: pointer;
  }
  .header-actions button:hover { color: var(--text); background: var(--surface); }
  button:focus-visible, a:focus-visible { outline: 2px solid var(--info); outline-offset: 2px; }
  .route-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
    background: var(--surface);
  }
  .route-row span, .route-row strong { color: var(--muted); font-size: 9px; }
  .route-row strong { color: var(--text); }
  .route-row code { overflow: hidden; color: var(--text); font: 11px/1.3 "Geist Mono Variable", ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; }
  .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(68px, 1fr)); border-bottom: 1px solid var(--line); }
  .metric { display: grid; gap: 2px; padding: 10px 12px; border-right: 1px solid var(--line); }
  .metric:last-child { border-right: 0; }
  .metric-label { color: var(--muted); font-size: 9px; }
  .metric strong { font-size: 11px; font-weight: 630; }
  .metric[data-status="needs-improvement"] strong { color: var(--warning); }
  .metric[data-status="poor"] strong { color: var(--serious); }
  .metric[data-status="good"] strong { color: var(--good); }
  .filters { display: flex; gap: 5px; padding: 10px 12px; overflow-x: auto; border-bottom: 1px solid var(--line); scrollbar-width: none; }
  .filters::-webkit-scrollbar { display: none; }
  .filter {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 6px;
    height: 29px;
    padding: 0 9px;
    border: 1px solid transparent;
    border-radius: 7px;
    color: var(--muted);
    background: transparent;
    font-size: 9px;
    cursor: pointer;
  }
  .filter span { color: inherit; opacity: .7; }
  .filter:hover { background: var(--surface); }
  .filter[data-active="true"] { border-color: var(--line); color: var(--text); background: var(--surface); }
  .issue-list { max-height: min(410px, calc(100vh - 290px)); overflow-y: auto; overscroll-behavior: contain; }
  .group-heading {
    display: flex;
    justify-content: space-between;
    padding: 13px 16px 7px;
    color: var(--muted);
    font-size: 9px;
  }
  .issue { border-top: 1px solid var(--line); }
  .group-heading + .issue { border-top: 0; }
  .issue-button {
    display: grid;
    grid-template-columns: 8px minmax(0, 1fr) auto;
    align-items: start;
    gap: 11px;
    width: 100%;
    padding: 13px 16px;
    border: 0;
    color: var(--text);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .issue-button:hover { background: var(--surface); }
  .severity-dot { width: 7px; height: 7px; margin-top: 6px; border-radius: 50%; background: var(--warning); box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning) 12%, transparent); }
  .issue[data-severity="critical"] .severity-dot { background: var(--critical); box-shadow: 0 0 0 3px color-mix(in srgb, var(--critical) 12%, transparent); }
  .issue[data-severity="serious"] .severity-dot { background: var(--serious); box-shadow: 0 0 0 3px color-mix(in srgb, var(--serious) 12%, transparent); }
  .issue[data-severity="info"] .severity-dot { background: var(--info); box-shadow: 0 0 0 3px color-mix(in srgb, var(--info) 12%, transparent); }
  .issue-copy { display: grid; min-width: 0; gap: 3px; }
  .issue-copy strong { font-size: 12px; line-height: 1.4; font-weight: 620; letter-spacing: -0.005em; }
  .issue-meta { color: var(--muted); font-size: 8px; }
  .caret { color: var(--muted); font: 16px/1 ui-monospace, monospace; transition: transform 150ms ease; }
  .issue-button[aria-expanded="true"] .caret { transform: rotate(45deg); }
  .issue-details { padding: 0 16px 15px 35px; }
  .issue-details p { margin: 0 0 10px; color: var(--muted); font-size: 11px; line-height: 1.55; }
  .issue-details code, .issue-details pre {
    display: block;
    max-width: 100%;
    margin: 7px 0 0;
    padding: 8px 9px;
    overflow: auto;
    border-radius: 6px;
    color: var(--text);
    background: var(--surface);
    font: 9px/1.5 "Geist Mono Variable", ui-monospace, monospace;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .issue-details a { display: inline-block; margin-top: 10px; color: var(--info); font-size: 11px; font-weight: 600; text-decoration: none; }
  .issue-details a:hover { text-decoration: underline; text-underline-offset: 3px; }
  .empty { padding: 34px 18px; color: var(--muted); text-align: center; font-size: 12px; }
  .loading { display: flex; justify-content: center; gap: 5px; padding: 38px 0; }
  .loading i { width: 5px; height: 5px; border-radius: 50%; background: var(--muted); animation: pulse 900ms ease-in-out infinite alternate; }
  .loading i:nth-child(2) { animation-delay: 150ms; }
  .loading i:nth-child(3) { animation-delay: 300ms; }
  footer { display: flex; justify-content: space-between; padding: 10px 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 8px; }
  .highlight {
    position: fixed;
    top: var(--y);
    left: var(--x);
    width: var(--w);
    height: var(--h);
    border: 2px solid var(--serious);
    border-radius: 4px;
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--serious) 18%, transparent);
    pointer-events: none;
    opacity: 0;
    transform: scale(.98);
    transition: opacity 120ms ease, transform 120ms ease;
  }
  .highlight[data-visible="true"] { opacity: 1; transform: scale(1); }
  @keyframes pulse { to { opacity: .22; transform: translateY(-2px); } }
  @media (prefers-color-scheme: dark) {
    .root {
      --bg: #181817;
      --surface: #222220;
      --surface-strong: #2c2c29;
      --line: #353531;
      --text: #f0f0eb;
      --muted: #999991;
      --critical: #f16f66;
      --serious: #ee805c;
      --warning: #dda34a;
      --info: #78a8ed;
      --good: #64b889;
    }
  }
  @media (max-width: 520px) {
    .root, .root[data-position="bottom-left"] { right: 8px; bottom: 8px; left: 8px; }
    .panel { width: 100%; max-height: calc(100vh - 16px); }
    .launcher { margin-left: auto; }
    .root[data-position="bottom-left"] .launcher { margin-right: auto; margin-left: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
  }
`;
