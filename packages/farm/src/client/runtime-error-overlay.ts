"use client";

import {
  originalPositionFor,
  sourceContentFor,
  TraceMap,
  type SourceMapInput,
} from "@jridgewell/trace-mapping";
import { DEFAULT_ERROR_STYLES } from "../components/error-styles";
import { FARM_VERSION } from "../version";
import { isChunkLoadError } from "./chunk-recovery";

export interface FarmRuntimeErrorLocation {
  href: string;
  pathname: string;
  search: string;
  hash: string;
}

export interface FarmRuntimeErrorOverlayContext {
  phase: string;
  location: FarmRuntimeErrorLocation;
  sourceEvent?: Event;
}

export interface FarmRuntimeErrorOverlayOptions {
  window: Window;
  farmVersion?: string;
  reload?: () => void;
  fetch?: typeof fetch;
}

export interface FarmRuntimeErrorOverlay {
  show(error: unknown, context: FarmRuntimeErrorOverlayContext): void;
  dismiss(): void;
  destroy(): void;
}

interface NormalizedRuntimeError {
  name: string;
  message: string;
  stack?: string;
}

interface BrowserSourceLocation {
  url: string;
  displayPath: string;
  line: number;
  column: number;
  stackLine?: string;
}

interface BrowserSourceLine {
  number?: number;
  content: string;
  highlight?: boolean;
}

interface BrowserSourceFrame {
  path: string;
  line?: number;
  column?: number;
  lines: BrowserSourceLine[];
  unavailable?: boolean;
}

interface RuntimeErrorRecord {
  error: NormalizedRuntimeError;
  context: FarmRuntimeErrorOverlayContext;
  fingerprint: string;
  occurrences: number;
  sourceLocation?: BrowserSourceLocation;
  sourceFrame: BrowserSourceFrame;
}

const OVERLAY_STYLES = `
:host {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: block;
  width: 100%;
  height: 100%;
}

:host([hidden]) {
  display: none;
}

.farm-runtime-error__viewport {
  width: 100%;
  height: 100%;
  overflow: auto;
  overscroll-behavior: contain;
}

.farm-runtime-error__viewport .farm-default-error {
  min-height: 100%;
  padding: clamp(22px, 4vh, 36px) 24px;
}

.farm-runtime-error__viewport .farm-default-error__code {
  font-size: clamp(96px, 10vw, 120px);
  line-height: 0.92;
}

.farm-runtime-error__viewport .farm-default-error__eyebrow {
  margin-top: 22px;
  margin-bottom: 18px;
}

.farm-runtime-error__viewport .farm-default-error__summary {
  margin-bottom: 20px;
}

.farm-runtime-error__viewport .farm-default-error__row {
  min-height: 48px;
}

.farm-runtime-error__viewport .farm-default-error__details {
  padding-top: 16px;
  padding-bottom: 14px;
}

.farm-runtime-error__viewport .farm-default-error__details-header {
  margin-bottom: 8px;
}

.farm-runtime-error__viewport .farm-default-error__source-path {
  padding-top: 9px;
  padding-bottom: 9px;
}

.farm-runtime-error__viewport .farm-default-error__source-code {
  padding-top: 6px;
  padding-bottom: 6px;
}

.farm-runtime-error__viewport .farm-default-error__meta {
  margin-top: 10px;
}

.farm-runtime-error__viewport .farm-default-error__actions {
  margin-top: 20px;
}

.farm-runtime-error__occurrences {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  margin-right: auto;
  padding: 0 8px;
  border: 1px solid var(--farm-error-line);
  color: var(--farm-error-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.farm-runtime-error__occurrences[hidden],
.farm-runtime-error__action[hidden] {
  display: none;
}

.farm-runtime-error__copy {
  min-width: 166px;
}

.farm-runtime-error__viewport .farm-default-error__panel {
  border: 0;
  box-shadow: inset 0 0 0 0.5px var(--farm-error-line-strong);
}

.farm-runtime-error__github-icon {
  display: block;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  margin-right: 10px;
  color: currentColor;
}

.farm-runtime-error__message-value {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.farm-runtime-error__inline-code {
  padding: 2px 5px;
  border: 1px solid var(--farm-error-line-strong);
  background: var(--farm-error-source-line);
  color: var(--farm-error-source-marker);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.94em;
  font-weight: 600;
  line-height: inherit;
  overflow-wrap: anywhere;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

@media (max-width: 620px) {
  .farm-runtime-error__occurrences {
    margin-right: 0;
  }

  .farm-runtime-error__viewport .farm-default-error__content,
  .farm-runtime-error__viewport .farm-default-error__panel,
  .farm-runtime-error__viewport .farm-default-error__details,
  .farm-runtime-error__viewport .farm-default-error__source,
  .farm-runtime-error__viewport .farm-default-error__actions {
    min-width: 0;
    max-width: 100%;
  }

  .farm-runtime-error__viewport .farm-default-error__actions {
    width: 100%;
  }

  .farm-runtime-error__viewport .farm-default-error__action {
    min-width: 0;
  }

  .farm-runtime-error__viewport .farm-default-error__code {
    font-size: 80px;
  }
}

@media (max-height: 760px) {
  .farm-runtime-error__viewport .farm-default-error {
    place-items: start center;
    padding-top: 12px;
    padding-bottom: 12px;
  }

  .farm-runtime-error__viewport .farm-default-error__code {
    font-size: 88px;
  }

  .farm-runtime-error__viewport .farm-default-error__eyebrow {
    margin-top: 14px;
    margin-bottom: 12px;
  }

  .farm-runtime-error__viewport .farm-default-error__summary {
    margin-bottom: 14px;
  }

  .farm-runtime-error__viewport .farm-default-error__row {
    min-height: 42px;
  }

  .farm-runtime-error__viewport .farm-default-error__details {
    padding-top: 12px;
    padding-bottom: 10px;
  }

  .farm-runtime-error__viewport .farm-default-error__actions {
    margin-top: 10px;
  }
}
`;

const OVERLAY_MARKUP = `
<div class="farm-runtime-error__viewport" data-farm-runtime-error-viewport>
  <main class="farm-default-error" data-farm-runtime-error role="alertdialog" aria-modal="true" aria-labelledby="farm-runtime-error-title" aria-describedby="farm-runtime-error-description">
    <div class="farm-default-error__content">
      <p class="farm-default-error__code" aria-hidden="true">500</p>
      <p class="farm-default-error__eyebrow">Client runtime error</p>
      <header class="farm-default-error__summary">
        <h1 id="farm-runtime-error-title" class="farm-default-error__title">Application failed in the browser</h1>
      </header>
      <section class="farm-default-error__panel" aria-label="Error information">
        <div class="farm-default-error__row">
          <span class="farm-default-error__label">Error type</span>
          <span class="farm-default-error__value" data-farm-runtime-error-type></span>
        </div>
        <div class="farm-default-error__row">
          <span class="farm-default-error__label">Error message</span>
          <span id="farm-runtime-error-description" class="farm-default-error__value farm-runtime-error__message-value" data-farm-runtime-error-message></span>
        </div>
        <div class="farm-default-error__row">
          <span class="farm-default-error__label">Location</span>
          <span class="farm-default-error__value" data-farm-runtime-error-location></span>
        </div>
        <section class="farm-default-error__details" aria-labelledby="farm-runtime-error-details-title">
          <div class="farm-default-error__details-header">
            <h2 id="farm-runtime-error-details-title" class="farm-default-error__details-title">Details</h2>
            <span class="farm-runtime-error__occurrences" data-farm-runtime-error-occurrences hidden></span>
            <button class="farm-default-error__copy farm-runtime-error__copy" type="button" data-farm-runtime-error-copy>
              <span data-farm-runtime-error-copy-label>Copy debug report</span>
              <span class="farm-default-error__sr-only" aria-live="polite" data-farm-runtime-error-copy-status></span>
            </button>
          </div>
          <div data-farm-runtime-error-source></div>
          <p class="farm-default-error__meta" data-farm-runtime-error-meta></p>
        </section>
      </section>
      <div class="farm-default-error__actions">
        <a class="farm-default-error__action farm-default-error__action--primary farm-runtime-error__action" data-farm-runtime-error-issue target="_blank" rel="noopener noreferrer"><svg class="farm-runtime-error__github-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.29-5.27-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.47.11-3.05 0 0 .96-.31 3.16 1.18A10.95 10.95 0 0 1 12 6.1c.98 0 1.95.13 2.87.39 2.2-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.4-2.71 5.38-5.29 5.67.42.36.79 1.07.79 2.16v3.27c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" /></svg><span>Open GitHub issue</span></a>
        <button class="farm-default-error__action farm-runtime-error__action" type="button" data-farm-runtime-error-reload>Reload page</button>
        <button class="farm-default-error__action farm-runtime-error__action" type="button" data-farm-runtime-error-dismiss>Dismiss</button>
      </div>
    </div>
  </main>
</div>
`;

class DefaultFarmRuntimeErrorOverlay implements FarmRuntimeErrorOverlay {
  private readonly options: FarmRuntimeErrorOverlayOptions;
  private readonly document: Document;
  private readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly dismissedFingerprints = new Set<string>();
  private readonly themeObserver: MutationObserver;
  private readonly colorSchemeQuery?: MediaQueryList;
  private current?: RuntimeErrorRecord;
  private previousFocus?: Element | null;
  private renderSequence = 0;
  private copyResetTimer?: number;
  private destroyed = false;

  constructor(options: FarmRuntimeErrorOverlayOptions) {
    this.options = options;
    this.document = options.window.document;
    this.host = this.document.createElement("div");
    this.host.dataset.farmRuntimeErrorOverlay = "";
    this.host.hidden = true;
    this.shadow = this.host.attachShadow({ mode: "open" });
    this.shadow.innerHTML = `<style>${DEFAULT_ERROR_STYLES}${OVERLAY_STYLES}</style>${OVERLAY_MARKUP}`;

    this.getElement<HTMLButtonElement>("[data-farm-runtime-error-reload]").addEventListener(
      "click",
      this.handleReload,
    );
    this.getElement<HTMLButtonElement>("[data-farm-runtime-error-dismiss]").addEventListener(
      "click",
      this.handleDismiss,
    );
    this.getElement<HTMLButtonElement>("[data-farm-runtime-error-copy]").addEventListener(
      "click",
      this.handleCopy,
    );
    this.shadow.addEventListener("keydown", this.handleKeyDown);

    this.themeObserver = new MutationObserver(this.updateTheme);
    this.themeObserver.observe(this.document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-color-scheme", "style"],
    });
    if (this.document.body) {
      this.themeObserver.observe(this.document.body, {
        attributes: true,
        attributeFilter: ["class", "data-theme", "data-color-scheme", "style"],
      });
    }

    this.colorSchemeQuery = options.window.matchMedia?.("(prefers-color-scheme: dark)");
    this.colorSchemeQuery?.addEventListener?.("change", this.updateTheme);
    this.updateTheme();
  }

  show(errorLike: unknown, context: FarmRuntimeErrorOverlayContext): void {
    if (this.destroyed || isChunkLoadError(errorLike) || isChunkLoadError(context.sourceEvent)) {
      return;
    }

    const error = normalizeRuntimeError(errorLike);
    const sourceLocation = resolveBrowserSourceLocation(
      error,
      context.sourceEvent,
      this.options.window,
    );
    if (sourceLocation && isBrowserExtensionUrl(sourceLocation.url)) return;
    if (isRecoverableReactHydrationError(error, context, sourceLocation)) return;

    const fingerprint = createErrorFingerprint(error, context, sourceLocation);
    if (this.dismissedFingerprints.has(fingerprint)) return;

    if (this.current?.fingerprint === fingerprint) {
      this.current.occurrences += 1;
      this.renderOccurrences(this.current.occurrences);
      return;
    }

    const record: RuntimeErrorRecord = {
      error,
      context,
      fingerprint,
      occurrences: 1,
      sourceLocation,
      sourceFrame: createFallbackSourceFrame(error, sourceLocation),
    };
    this.current = record;
    const sequence = ++this.renderSequence;
    this.render(record);
    this.mount();

    if (sourceLocation) {
      void loadBrowserSourceFrame(sourceLocation, this.options)
        .then((sourceFrame) => {
          if (
            !sourceFrame ||
            this.destroyed ||
            sequence !== this.renderSequence ||
            this.current !== record
          ) {
            return;
          }
          record.sourceFrame = sourceFrame;
          this.renderSourceFrame(sourceFrame);
          this.renderIssueLink(record);
        })
        .catch(() => {});
    }
  }

  dismiss(): void {
    if (this.destroyed || this.host.hidden) return;
    if (this.current) this.dismissedFingerprints.add(this.current.fingerprint);
    this.host.hidden = true;
    this.renderSequence += 1;
    if (this.previousFocus instanceof HTMLElement && this.previousFocus.isConnected) {
      this.previousFocus.focus();
    }
    this.previousFocus = undefined;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderSequence += 1;
    this.themeObserver.disconnect();
    this.colorSchemeQuery?.removeEventListener?.("change", this.updateTheme);
    this.shadow.removeEventListener("keydown", this.handleKeyDown);
    if (this.copyResetTimer !== undefined) {
      this.options.window.clearTimeout(this.copyResetTimer);
    }
    this.host.remove();
    this.current = undefined;
  }

  private mount(): void {
    if (!this.host.isConnected) {
      (this.document.body || this.document.documentElement).appendChild(this.host);
    }
    const wasHidden = this.host.hidden;
    this.host.hidden = false;
    if (wasHidden) {
      this.previousFocus = this.document.activeElement;
      this.options.window.setTimeout(() => {
        if (!this.host.hidden && !this.destroyed) {
          this.getElement<HTMLAnchorElement>("[data-farm-runtime-error-issue]").focus({
            preventScroll: true,
          });
        }
      }, 0);
    }
  }

  private render(record: RuntimeErrorRecord): void {
    this.getElement("[data-farm-runtime-error-type]").textContent = formatErrorType(
      record.error,
      record.context.phase,
    );
    renderErrorMessage(
      this.getElement("[data-farm-runtime-error-message]"),
      record.error.message,
      this.document,
    );
    this.getElement("[data-farm-runtime-error-location]").textContent =
      `${record.context.location.pathname}${record.context.location.search}` || "/";
    this.getElement("[data-farm-runtime-error-meta]").textContent =
      `Farm.js v${this.options.farmVersion || FARM_VERSION} · development · browser`;
    this.renderIssueLink(record);
    this.renderOccurrences(record.occurrences);
    this.renderSourceFrame(record.sourceFrame);
    this.resetCopyStatus();
  }

  private renderOccurrences(occurrences: number): void {
    const badge = this.getElement<HTMLElement>("[data-farm-runtime-error-occurrences]");
    badge.hidden = occurrences < 2;
    badge.textContent = occurrences < 2 ? "" : `Repeated ×${occurrences}`;
  }

  private renderIssueLink(record: RuntimeErrorRecord): void {
    this.getElement<HTMLAnchorElement>("[data-farm-runtime-error-issue]").href =
      createGithubIssueUrl(record, this.options.window, this.options.farmVersion || FARM_VERSION);
  }

  private renderSourceFrame(sourceFrame: BrowserSourceFrame): void {
    const container = this.getElement<HTMLElement>("[data-farm-runtime-error-source]");
    container.replaceChildren();

    const source = this.document.createElement("div");
    source.className = "farm-default-error__source";

    const path = this.document.createElement("p");
    path.className = "farm-default-error__source-path";
    path.textContent = formatSourcePath(sourceFrame);
    source.appendChild(path);

    const pre = this.document.createElement("pre");
    pre.className = "farm-default-error__source-code";
    pre.tabIndex = 0;
    const code = this.document.createElement("code");
    for (const line of sourceFrame.lines) {
      const row = this.document.createElement("span");
      row.className = `farm-default-error__source-line${line.highlight ? " farm-default-error__source-line--active" : ""}`;

      const gutter = this.document.createElement("span");
      gutter.className = "farm-default-error__source-gutter";
      gutter.textContent = `${line.highlight ? ">" : " "} ${line.number ?? ""}`;

      const text = this.document.createElement("span");
      text.className = "farm-default-error__source-text";
      text.textContent = line.content || " ";

      row.append(gutter, text);
      code.appendChild(row);
    }
    pre.appendChild(code);
    source.appendChild(pre);
    container.appendChild(source);
  }

  private readonly handleReload = () => {
    (this.options.reload || (() => this.options.window.location.reload()))();
  };

  private readonly handleDismiss = () => {
    this.dismiss();
  };

  private readonly handleCopy = async () => {
    if (!this.current) return;
    const report = createFarmRuntimeErrorDebugReport(
      this.current,
      this.options.window,
      this.options.farmVersion || FARM_VERSION,
    );
    const label = this.getElement<HTMLElement>("[data-farm-runtime-error-copy-label]");
    const status = this.getElement<HTMLElement>("[data-farm-runtime-error-copy-status]");

    try {
      await copyText(report, this.options.window, this.document);
      label.textContent = "Copied";
      status.textContent = "Debug report copied";
      if (this.copyResetTimer !== undefined) {
        this.options.window.clearTimeout(this.copyResetTimer);
      }
      this.copyResetTimer = this.options.window.setTimeout(() => this.resetCopyStatus(), 1800);
    } catch {
      status.textContent = "Unable to copy the debug report";
    }
  };

  private readonly handleKeyDown = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === "Escape") {
      keyboardEvent.preventDefault();
      this.dismiss();
      return;
    }
    if (keyboardEvent.key !== "Tab") return;

    const controls = Array.from(
      this.shadow.querySelectorAll<HTMLElement>("a[href], button:not([hidden]):not([disabled])"),
    );
    if (controls.length === 0) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    const active = this.shadow.activeElement;

    if (keyboardEvent.shiftKey && active === first) {
      keyboardEvent.preventDefault();
      last.focus();
    } else if (!keyboardEvent.shiftKey && active === last) {
      keyboardEvent.preventDefault();
      first.focus();
    }
  };

  private readonly updateTheme = () => {
    this.getElement<HTMLElement>("[data-farm-runtime-error-viewport]").dataset.theme =
      resolveDocumentTheme(this.document, this.options.window);
  };

  private resetCopyStatus(): void {
    this.getElement("[data-farm-runtime-error-copy-label]").textContent = "Copy debug report";
    this.getElement("[data-farm-runtime-error-copy-status]").textContent = "";
  }

  private getElement<T extends Element = HTMLElement>(selector: string): T {
    const element = this.shadow.querySelector<T>(selector);
    if (!element) throw new Error(`Farm runtime error overlay is missing ${selector}`);
    return element;
  }
}

export function createFarmRuntimeErrorOverlay(
  options: FarmRuntimeErrorOverlayOptions,
): FarmRuntimeErrorOverlay {
  return new DefaultFarmRuntimeErrorOverlay(options);
}

function normalizeRuntimeError(errorLike: unknown): NormalizedRuntimeError {
  if (errorLike instanceof Error) {
    return {
      name: errorLike.name || "Error",
      message: errorLike.message || "An unknown browser error occurred.",
      stack: errorLike.stack,
    };
  }

  if (errorLike && typeof errorLike === "object") {
    const error = errorLike as Record<string, unknown>;
    const name = typeof error.name === "string" && error.name ? error.name : "Error";
    const message =
      typeof error.message === "string" && error.message
        ? error.message
        : typeof error.reason === "string" && error.reason
          ? error.reason
          : stringifyUnknown(errorLike);
    return {
      name,
      message: message || "An unknown browser error occurred.",
      stack: typeof error.stack === "string" ? error.stack : undefined,
    };
  }

  return {
    name: "Error",
    message: stringifyUnknown(errorLike) || "An unknown browser error occurred.",
  };
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolveBrowserSourceLocation(
  error: NormalizedRuntimeError,
  sourceEvent: Event | undefined,
  clientWindow: Window,
): BrowserSourceLocation | undefined {
  if (sourceEvent && "filename" in sourceEvent) {
    const event = sourceEvent as ErrorEvent;
    if (event.filename && event.lineno) {
      return createSourceLocation(event.filename, event.lineno, event.colno || 1, clientWindow);
    }
  }

  if (!error.stack) return undefined;
  for (const stackLine of error.stack.split("\n").slice(1)) {
    const match = stackLine
      .trim()
      .match(/\(?((?:[a-z][a-z\d+.-]*):\/\/[^)\s]+|\/[^)\s]+):(\d+):(\d+)\)?$/i);
    if (!match) continue;
    return {
      ...createSourceLocation(match[1], Number(match[2]), Number(match[3]), clientWindow),
      stackLine: stackLine.trim(),
    };
  }
  return undefined;
}

function createSourceLocation(
  url: string,
  line: number,
  column: number,
  clientWindow: Window,
): BrowserSourceLocation {
  let displayPath = url;
  try {
    const parsed = new URL(url, clientWindow.location.href);
    displayPath = parsed.origin === clientWindow.location.origin ? parsed.pathname : parsed.href;
  } catch {}

  return { url, displayPath, line, column };
}

function createFallbackSourceFrame(
  error: NormalizedRuntimeError,
  location?: BrowserSourceLocation,
): BrowserSourceFrame {
  const firstStackLine =
    location?.stackLine || error.stack?.split("\n").find((line) => line.trim().startsWith("at "));
  return {
    path: location?.displayPath || "Browser stack",
    line: location?.line,
    column: location?.column,
    unavailable: true,
    lines: [
      {
        number: location?.line,
        content: firstStackLine?.trim() || error.message,
        highlight: true,
      },
    ],
  };
}

async function loadBrowserSourceFrame(
  location: BrowserSourceLocation,
  options: FarmRuntimeErrorOverlayOptions,
): Promise<BrowserSourceFrame | undefined> {
  const request = options.fetch || options.window.fetch?.bind(options.window);
  if (!request) return undefined;

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(location.url, options.window.location.href);
  } catch {
    return undefined;
  }
  if (
    sourceUrl.origin !== options.window.location.origin ||
    (sourceUrl.protocol !== "http:" && sourceUrl.protocol !== "https:")
  ) {
    return undefined;
  }

  try {
    const response = await request(sourceUrl.href, {
      headers: { Accept: "text/plain, application/javascript" },
    });
    if (!response.ok) return undefined;
    const source = await response.text();
    if (source.length > 1_000_000) return undefined;

    const mappedFrame = await createMappedSourceFrame(
      source,
      sourceUrl,
      location,
      request,
      options.window,
    );
    if (mappedFrame) return mappedFrame;

    return createSourceFrame(source, location.displayPath, location.line, location.column);
  } catch {
    return undefined;
  }
}

async function createMappedSourceFrame(
  generatedSource: string,
  generatedUrl: URL,
  location: BrowserSourceLocation,
  request: typeof fetch,
  clientWindow: Window,
): Promise<BrowserSourceFrame | undefined> {
  const traceMap = await loadTraceMap(generatedSource, generatedUrl, request, clientWindow);
  if (!traceMap) return undefined;

  const original = originalPositionFor(traceMap, {
    line: location.line,
    column: Math.max(0, location.column - 1),
  });
  if (!original.source || original.line == null) return undefined;

  const originalSource = sourceContentFor(traceMap, original.source);
  if (originalSource == null) return undefined;

  const originalLines = originalSource.split(/\r?\n/);
  const generatedLine = generatedSource.split(/\r?\n/)[location.line - 1] || "";
  const line = refineOriginalLine(generatedLine, originalLines, original.line);
  const lineContent = originalLines[line - 1] || "";
  const trimmedGeneratedLine = generatedLine.trim();
  const column =
    line !== original.line && trimmedGeneratedLine && lineContent.includes(trimmedGeneratedLine)
      ? lineContent.indexOf(trimmedGeneratedLine) + 1
      : (original.column ?? 0) + 1;

  return createSourceFrame(
    originalSource,
    formatDisplaySourceUrl(original.source, clientWindow),
    line,
    column,
  );
}

async function loadTraceMap(
  generatedSource: string,
  generatedUrl: URL,
  request: typeof fetch,
  clientWindow: Window,
): Promise<TraceMap | undefined> {
  const matches = Array.from(generatedSource.matchAll(/\/\/[#@]\s*sourceMappingURL=([^\s]+)/g));
  const reference = matches[matches.length - 1]?.[1];
  if (!reference) return undefined;

  let sourceMapJson: string;
  if (reference.startsWith("data:")) {
    sourceMapJson = decodeSourceMapDataUrl(reference, clientWindow);
  } else {
    const sourceMapUrl = new URL(reference, generatedUrl);
    if (sourceMapUrl.origin !== clientWindow.location.origin) return undefined;
    const response = await request(sourceMapUrl.href, {
      headers: { Accept: "application/json, text/plain" },
    });
    if (!response.ok) return undefined;
    sourceMapJson = await response.text();
    if (sourceMapJson.length > 2_000_000) return undefined;
  }

  return new TraceMap(JSON.parse(sourceMapJson) as SourceMapInput, generatedUrl.href);
}

function decodeSourceMapDataUrl(value: string, clientWindow: Window): string {
  const separator = value.indexOf(",");
  if (separator < 0) throw new Error("Invalid inline source map");
  const metadata = value.slice(0, separator);
  const payload = value.slice(separator + 1);
  if (!metadata.includes(";base64")) return decodeURIComponent(payload);

  const binary = clientWindow.atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function refineOriginalLine(
  generatedLine: string,
  originalLines: string[],
  mappedLine: number,
): number {
  const normalizedGeneratedLine = normalizeSourceLine(generatedLine);
  if (normalizedGeneratedLine.length < 8) return mappedLine;

  let bestMatch = mappedLine;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < originalLines.length; index += 1) {
    if (normalizeSourceLine(originalLines[index]) !== normalizedGeneratedLine) continue;
    const line = index + 1;
    const distance = Math.abs(line - mappedLine);
    if (distance < bestDistance) {
      bestMatch = line;
      bestDistance = distance;
    }
  }
  return bestMatch;
}

function normalizeSourceLine(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function createSourceFrame(
  source: string,
  path: string,
  line: number,
  column: number,
): BrowserSourceFrame | undefined {
  const lines = source.split(/\r?\n/);
  if (line < 1 || line > lines.length) return undefined;
  const start = Math.max(1, line - 2);
  const end = Math.min(lines.length, line + 2);
  const frameLines: BrowserSourceLine[] = [];
  for (let number = start; number <= end; number += 1) {
    frameLines.push({
      number,
      content: lines[number - 1] || " ",
      highlight: number === line,
    });
  }

  return { path, line, column, lines: frameLines };
}

function formatDisplaySourceUrl(url: string, clientWindow: Window): string {
  try {
    const parsed = new URL(url, clientWindow.location.href);
    return parsed.origin === clientWindow.location.origin ? parsed.pathname : parsed.href;
  } catch {
    return url.replace(/[?#].*$/, "");
  }
}

function isBrowserExtensionUrl(url: string): boolean {
  try {
    return [
      "chrome-extension:",
      "moz-extension:",
      "safari-web-extension:",
      "ms-browser-extension:",
    ].includes(new URL(url).protocol);
  } catch {
    return /^(?:chrome|moz|safari-web|ms-browser)-extension:\/\//i.test(url);
  }
}

function isRecoverableReactHydrationError(
  error: NormalizedRuntimeError,
  context: FarmRuntimeErrorOverlayContext,
  location?: BrowserSourceLocation,
): boolean {
  if (context.phase !== "window") return false;

  const isKnownRecoverableMessage = [
    /^Hydration failed because the server rendered (?:text|HTML) didn't match the client\b/i,
    /^Text content does not match server-rendered HTML\b/i,
    /^There was an error while hydrating but React was able to recover\b/i,
  ].some((pattern) => pattern.test(error.message));
  if (!isKnownRecoverableMessage) return false;

  return /(?:react-dom(?:_client)?(?:\.development)?\.js|react-dom\/|throwOnHydrationMismatch|onRecoverableError)/i.test(
    `${location?.url || ""}\n${error.stack || ""}`,
  );
}

function renderErrorMessage(container: Element, message: string, document: Document): void {
  const fragments: Node[] = [];
  const codePattern = /`([^`\n]+)`|\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){2,}\b/g;
  let offset = 0;

  for (const match of message.matchAll(codePattern)) {
    const index = match.index ?? 0;
    if (index > offset) fragments.push(document.createTextNode(message.slice(offset, index)));

    const code = document.createElement("code");
    code.className = "farm-runtime-error__inline-code";
    code.textContent = match[1] || match[0];
    fragments.push(code);
    offset = index + match[0].length;
  }

  if (offset < message.length) fragments.push(document.createTextNode(message.slice(offset)));
  container.replaceChildren(...fragments);
}

function createErrorFingerprint(
  error: NormalizedRuntimeError,
  context: FarmRuntimeErrorOverlayContext,
  location?: BrowserSourceLocation,
): string {
  return [
    context.phase,
    context.location.pathname,
    error.name,
    error.message,
    location?.displayPath || "",
    location?.line || "",
    error.stack?.split("\n")[1]?.trim() || "",
  ].join("\u0000");
}

function formatPhase(phase: string): string {
  return phase
    .replace(/^plugin:/, "Plugin · ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatErrorType(error: NormalizedRuntimeError, phase: string): string {
  const category =
    phase === "hydration"
      ? "Hydration"
      : phase === "navigation"
        ? "Navigation"
        : phase === "setup" || phase.startsWith("plugin:")
          ? "Plugin"
          : phase === "performance"
            ? "Performance"
            : "Runtime";
  const name = error.name.trim() || "Error";
  return `${category} ${name}`;
}

function formatSourcePath(sourceFrame: BrowserSourceFrame): string {
  if (!sourceFrame.line) return sourceFrame.path;
  return `${sourceFrame.path}:${sourceFrame.line}:${sourceFrame.column || 1}${
    sourceFrame.unavailable ? " · source preview unavailable" : ""
  }`;
}

function resolveDocumentTheme(document: Document, clientWindow: Window): "light" | "dark" {
  for (const element of [document.documentElement, document.body]) {
    if (!element) continue;
    const explicit =
      element.getAttribute("data-theme") || element.getAttribute("data-color-scheme");
    if (explicit === "dark" || element.classList.contains("dark")) return "dark";
    if (explicit === "light" || element.classList.contains("light")) return "light";
  }

  const colorScheme = clientWindow.getComputedStyle?.(document.documentElement).colorScheme;
  if (colorScheme?.includes("dark") && !colorScheme.includes("light")) return "dark";
  return clientWindow.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function createFarmRuntimeErrorDebugReport(
  record: RuntimeErrorRecord,
  clientWindow: Window,
  farmVersion: string,
): string {
  const source = record.sourceFrame.lines
    .map(
      (line) =>
        `${line.highlight ? ">" : " "} ${line.number ? String(line.number).padStart(4, " ") : "    "} | ${line.content}`,
    )
    .join("\n");
  const viewport = `${clientWindow.innerWidth}×${clientWindow.innerHeight}`;

  return [
    "# Farm.js client runtime debug report",
    "",
    "## Error",
    `- Type: ${formatErrorType(record.error, record.context.phase)}`,
    `- Message: ${record.error.message}`,
    `- Phase: ${formatPhase(record.context.phase)}`,
    `- Page: ${record.context.location.href}`,
    `- Occurrences: ${record.occurrences}`,
    "",
    "## Browser runtime",
    `- Farm.js: ${farmVersion}`,
    `- User agent: ${clientWindow.navigator.userAgent}`,
    `- Viewport: ${viewport}`,
    `- Online: ${clientWindow.navigator.onLine === false ? "no" : "yes"}`,
    "",
    "## Source",
    `\`${formatSourcePath(record.sourceFrame)}\``,
    "",
    "```text",
    source,
    "```",
    "",
    "## Stack trace",
    "```text",
    record.error.stack || "Stack trace unavailable.",
    "```",
    "",
    "## Diagnostic request",
    "Identify the most likely root cause from the message, source frame, and stack trace. Explain the smallest safe fix and how to verify it.",
  ].join("\n");
}

function createGithubIssueUrl(
  record: RuntimeErrorRecord,
  clientWindow: Window,
  farmVersion: string,
): string {
  const source = record.sourceFrame.lines
    .map(
      (line) =>
        `${line.highlight ? ">" : " "} ${line.number ? String(line.number).padStart(4, " ") : "    "} | ${line.content}`,
    )
    .join("\n");
  const body = truncateText(
    [
      "## Runtime error report",
      "",
      "> This report was prefilled by the Farm.js development error overlay. Review it and remove sensitive information before submitting.",
      "",
      "### Error",
      `- Type: ${formatErrorType(record.error, record.context.phase)}`,
      `- Message: ${record.error.message}`,
      `- Phase: ${formatPhase(record.context.phase)}`,
      `- Page path: ${record.context.location.pathname}`,
      `- Occurrences: ${record.occurrences}`,
      `- Farm.js: ${farmVersion}`,
      `- Browser: ${clientWindow.navigator.userAgent}`,
      `- Viewport: ${clientWindow.innerWidth}×${clientWindow.innerHeight}`,
      `- Online: ${clientWindow.navigator.onLine === false ? "no" : "yes"}`,
      "",
      "### Source",
      `\`${formatSourcePath(record.sourceFrame)}\``,
      "",
      "```text",
      source,
      "```",
      "",
      "### Stack trace",
      "```text",
      record.error.stack || "Stack trace unavailable.",
      "```",
      "",
      "### Expected behavior",
      "Describe what you expected to happen and the steps needed to reproduce the failure.",
      "",
      "### Diagnostic request",
      "Identify the most likely root cause from the message, source frame, and stack trace. Explain the smallest safe fix and how to verify it.",
    ].join("\n"),
    6_000,
  );
  const issueUrl = new URL("https://github.com/farming-labs/farm.js/issues/new");
  issueUrl.searchParams.set("title", truncateText(`[runtime error] ${record.error.message}`, 120));
  issueUrl.searchParams.set("body", body);
  return issueUrl.href;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 24)}\n\n[report truncated]`;
}

async function copyText(value: string, clientWindow: Window, document: Document): Promise<void> {
  if (clientWindow.navigator.clipboard && clientWindow.isSecureContext) {
    await clientWindow.navigator.clipboard.writeText(value);
    return;
  }

  const area = document.createElement("textarea");
  area.value = value;
  area.readOnly = true;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("Copy command was rejected");
}
