import { DEFAULT_ERROR_STYLES } from "./error-styles";

export { DEFAULT_ERROR_STYLES } from "./error-styles";

const ERROR_STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Content Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  418: "I'm a Teapot",
  422: "Unprocessable Content",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  510: "Not Extended",
  511: "Network Authentication Required",
};

const ERROR_TITLES: Record<number, string> = {
  400: "The request could not be understood",
  401: "Authentication is required",
  403: "You do not have access to this page",
  404: "The requested page could not be found",
  405: "This request method is not supported",
  408: "The request took too long",
  409: "The request conflicts with the current state",
  410: "This resource is no longer available",
  413: "The request is too large",
  422: "The request could not be processed",
  429: "Too many requests were sent",
  500: "Application failed during server rendering",
  501: "This operation is not implemented",
  502: "An upstream service returned an invalid response",
  503: "The service is temporarily unavailable",
  504: "An upstream service took too long to respond",
};

const ERROR_PUBLIC_MESSAGES: Record<number, string> = {
  400: "Check the request and try again.",
  401: "Sign in and try this request again.",
  403: "Use an account with the required permissions or return home.",
  404: "Check the address or return to the home page.",
  405: "Use a supported request method and try again.",
  408: "Try the request again in a moment.",
  409: "Refresh the page, review the latest state, and try again.",
  410: "Return home to continue browsing.",
  413: "Reduce the request size and try again.",
  422: "Review the request data and try again.",
  429: "Wait a moment before trying again.",
  500: "An unexpected error prevented this page from rendering.",
  501: "This operation is not available yet.",
  502: "Try again after the upstream service recovers.",
  503: "Try again in a moment.",
  504: "Try again after the upstream service recovers.",
};

export interface DefaultErrorSourceLine {
  number: number;
  content: string;
  highlight?: boolean;
}

export interface DefaultErrorSourceFrame {
  file: string;
  line: number;
  column: number;
  lines: DefaultErrorSourceLine[];
}

export interface DefaultErrorPageOptions {
  statusCode?: number;
  statusText?: string;
  requestPath?: string;
  method?: string;
  message?: string;
  errorName?: string;
  stack?: string;
  sourceFrame?: DefaultErrorSourceFrame;
  development?: boolean;
  farmVersion?: string;
  nodeVersion?: string;
  mode?: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function serializeJsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function normalizeErrorStatus(status: unknown): number | undefined {
  const value = typeof status === "string" && status.trim() ? Number(status) : status;
  return typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599
    ? value
    : undefined;
}

export function resolveDefaultErrorStatus(error: unknown): number {
  if (error && typeof error === "object") {
    const candidate = error as { status?: unknown; statusCode?: unknown };
    return (
      normalizeErrorStatus(candidate.status) ?? normalizeErrorStatus(candidate.statusCode) ?? 500
    );
  }
  return 500;
}

export function getDefaultErrorStatusText(statusCode: number): string {
  return ERROR_STATUS_TEXT[statusCode] || (statusCode >= 500 ? "Server Error" : "Request Error");
}

export function getDefaultErrorTitle(statusCode: number): string {
  return (
    ERROR_TITLES[statusCode] ||
    (statusCode >= 500
      ? "The server could not complete the request"
      : "The request could not be completed")
  );
}

function getDefaultErrorPublicMessage(statusCode: number): string {
  return ERROR_PUBLIC_MESSAGES[statusCode] || "Try again or return to the home page.";
}

function createSourceFrameMarkup(sourceFrame?: DefaultErrorSourceFrame): string {
  if (!sourceFrame) {
    return `<p class="farm-default-error__details-empty">Source location is unavailable. Copy the debug report to inspect the filtered stack trace.</p>`;
  }

  const lines = sourceFrame.lines
    .map(
      (line) =>
        `<span class="farm-default-error__source-line${line.highlight ? " farm-default-error__source-line--active" : ""}"><span class="farm-default-error__source-gutter">${line.highlight ? "&gt;" : "&nbsp;"} ${line.number}</span><span class="farm-default-error__source-text">${escapeHtml(line.content || " ")}</span></span>`,
    )
    .join("\n");

  return `<div class="farm-default-error__source"><p class="farm-default-error__source-path">${escapeHtml(sourceFrame.file)}:${sourceFrame.line}:${sourceFrame.column}</p><pre class="farm-default-error__source-code" tabindex="0"><code>${lines}</code></pre></div>`;
}

function createDebugReport(
  options: Required<Pick<DefaultErrorPageOptions, "statusCode">> & DefaultErrorPageOptions,
): string {
  const statusText = options.statusText || getDefaultErrorStatusText(options.statusCode);
  const sourceFrame = options.sourceFrame;
  const source = sourceFrame
    ? [
        `\`${sourceFrame.file}:${sourceFrame.line}:${sourceFrame.column}\``,
        "",
        "```text",
        ...sourceFrame.lines.map(
          (line) =>
            `${line.highlight ? ">" : " "} ${String(line.number).padStart(4, " ")} | ${line.content}`,
        ),
        "```",
      ].join("\n")
    : "Source frame unavailable.";

  return [
    "# Farm.js debug report",
    "",
    "## Error",
    `- Status: ${options.statusCode} ${statusText}`,
    `- Name: ${options.errorName || "Error"}`,
    `- Message: ${options.message || getDefaultErrorPublicMessage(options.statusCode)}`,
    `- Request: ${(options.method || "GET").toUpperCase()} ${options.requestPath || "/"}`,
    "",
    "## Runtime",
    `- Farm.js: ${options.farmVersion || "unknown"}`,
    `- Node.js: ${options.nodeVersion || "unknown"}`,
    `- Mode: ${options.mode || "development"}`,
    "",
    "## Source",
    source,
    "",
    "## Filtered stack",
    "```text",
    options.stack || "Stack trace unavailable.",
    "```",
  ].join("\n");
}

const ERROR_PAGE_SCRIPT = `<script>(function(){var root=document.querySelector("[data-farm-default-error]");if(!root)return;var retry=root.querySelector("[data-farm-error-retry]");if(retry)retry.addEventListener("click",function(){window.location.reload()})})();</script>`;
const ERROR_COPY_SCRIPT = `<script>(function(){var root=document.querySelector("[data-farm-default-error]");var copy=root&&root.querySelector("[data-farm-error-copy]");var report=document.getElementById("farm-default-error-report");if(!copy||!report)return;copy.addEventListener("click",async function(){var value="";try{value=JSON.parse(report.textContent||'""')}catch(_error){value=report.textContent||""}try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(value)}else{var area=document.createElement("textarea");area.value=value;area.setAttribute("readonly","");area.style.position="fixed";area.style.opacity="0";document.body.appendChild(area);area.select();document.execCommand("copy");area.remove()}var label=copy.querySelector("[data-farm-error-copy-label]");var status=copy.querySelector("[data-farm-error-copy-status]");if(label)label.textContent="COPIED";if(status)status.textContent="Debug report copied";window.setTimeout(function(){if(label)label.textContent="COPY DEBUG REPORT";if(status)status.textContent=""},1800)}catch(_error){var status=copy.querySelector("[data-farm-error-copy-status]");if(status)status.textContent="Unable to copy the debug report"}})})();</script>`;

export function createDefaultErrorMarkup(options: DefaultErrorPageOptions = {}): string {
  const statusCode = normalizeErrorStatus(options.statusCode) ?? 500;
  const statusText = options.statusText || getDefaultErrorStatusText(statusCode);
  const development = options.development === true;
  const title = getDefaultErrorTitle(statusCode);
  const message =
    development && options.message ? options.message : getDefaultErrorPublicMessage(statusCode);
  const requestPath = options.requestPath || "/";
  const method = (options.method || "GET").toUpperCase();
  const eyebrow = statusCode >= 500 ? "Runtime error" : "Request error";
  const details = development
    ? `<section class="farm-default-error__details" aria-labelledby="farm-default-error-details-title"><div class="farm-default-error__details-header"><h2 id="farm-default-error-details-title" class="farm-default-error__details-title">Details</h2><button class="farm-default-error__copy" type="button" data-farm-error-copy><span data-farm-error-copy-label>COPY DEBUG REPORT</span><span class="farm-default-error__sr-only" aria-live="polite" data-farm-error-copy-status></span></button></div>${createSourceFrameMarkup(options.sourceFrame)}<p class="farm-default-error__meta">Farm.js v${escapeHtml(options.farmVersion || "unknown")} · ${escapeHtml(options.mode || "development")} · Node.js ${escapeHtml(options.nodeVersion || "unknown")}</p></section>`
    : "";
  const report = development
    ? `<script id="farm-default-error-report" type="application/json">${serializeJsonForHtml(createDebugReport({ ...options, statusCode, statusText, requestPath, method }))}</script>${ERROR_COPY_SCRIPT}`
    : "";

  return `<style>${DEFAULT_ERROR_STYLES}</style><main class="farm-default-error" data-farm-default-error role="alert" aria-labelledby="farm-default-error-title" aria-describedby="farm-default-error-description"><div class="farm-default-error__content"><p class="farm-default-error__code" aria-hidden="true">${statusCode}</p><p class="farm-default-error__eyebrow">${escapeHtml(eyebrow)}</p><header class="farm-default-error__summary"><h1 id="farm-default-error-title" class="farm-default-error__title">${escapeHtml(title)}</h1><p id="farm-default-error-description" class="farm-default-error__message">${escapeHtml(message)}</p></header><section class="farm-default-error__panel" aria-label="Error information"><div class="farm-default-error__row"><span class="farm-default-error__label">Request</span><span class="farm-default-error__value">${escapeHtml(method)} ${escapeHtml(requestPath)}</span></div><div class="farm-default-error__row"><span class="farm-default-error__label">Status</span><span class="farm-default-error__value">${statusCode} ${escapeHtml(statusText)}</span></div>${details}</section><div class="farm-default-error__actions"><button class="farm-default-error__action farm-default-error__action--primary" type="button" data-farm-error-retry>TRY AGAIN</button><a class="farm-default-error__action" href="/">RETURN HOME</a></div></div>${report}${ERROR_PAGE_SCRIPT}</main>`;
}
