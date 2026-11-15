import { highlight } from "sugar-high";
import { icon } from "./icons.js";

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

/** Data is escaped before entering HTML; only the highlighter's generated spans are markup. */
export function codeBlock(source: string, label: string, id: string): string {
  const lines = source.split("\n");
  const displayed = lines.slice(0, 1500).join("\n");
  return `<section class="fd-code-pane" aria-label="${escapeHtml(label)}"><div class="fd-code-title"><span class="fd-label">${escapeHtml(label)}</span><button type="button" class="fd-link-button" data-copy="${escapeHtml(id)}" aria-label="Copy ${escapeHtml(label)}">${icon("copy")}<span class="fd-button-label">Copy</span></button></div><pre class="fd-source"><code>${highlight(displayed)}</code></pre>${lines.length > 1500 ? '<p class="fd-subtitle">Showing the first 1,500 lines. Copy includes the full bounded source.</p>' : ""}</section>`;
}

type ShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "repeat"
>;

/** Mirrors the host overlay's matcher in @farm.js/core so only the toggle shortcut leaves the panel. */
export function createShortcutMatcher(
  shortcut: string,
  isMac: boolean,
): (event: ShortcutEvent) => boolean {
  const tokens = shortcut
    .toLowerCase()
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  const modifiers = ["alt", "ctrl", "control", "meta", "cmd", "command", "mod", "shift"];
  const key = tokens.find((token) => !modifiers.includes(token));
  if (!key) return () => false;
  const mod = tokens.includes("mod");
  const alt = tokens.includes("alt");
  const shift = tokens.includes("shift");
  const ctrl = tokens.includes("ctrl") || tokens.includes("control") || (mod && !isMac);
  const meta =
    tokens.includes("meta") ||
    tokens.includes("cmd") ||
    tokens.includes("command") ||
    (mod && isMac);
  const code =
    key === "." || key === "period"
      ? "Period"
      : key === "," || key === "comma"
        ? "Comma"
        : key === "/" || key === "slash"
          ? "Slash"
          : undefined;
  return (event) =>
    !event.repeat &&
    event.altKey === alt &&
    event.ctrlKey === ctrl &&
    event.metaKey === meta &&
    event.shiftKey === shift &&
    (code ? event.code === code : String(event.key || "").toLowerCase() === key);
}

export function property(label: string, value: string): string {
  return `<div class="fd-property"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

export function heading(title: string, subtitle: string, tag = ""): string {
  return `<div class="fd-page-heading"><div><h2>${escapeHtml(title)}</h2><p class="fd-subtitle">${escapeHtml(subtitle)}</p></div>${tag ? `<span class="fd-tag">${escapeHtml(tag)}</span>` : ""}</div>`;
}
