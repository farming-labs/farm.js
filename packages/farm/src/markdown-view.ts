/**
 * Partial reads of a Markdown representation for agents: `?outline` returns the
 * heading tree, `?section=<id>` returns one section, `?max_tokens=<n>` returns the
 * document (or section) in parts that fit a token budget, `?actions` lists the
 * page's forms as JSON. Every Markdown response also
 * carries an ETag so an agent can re-check a page with `If-None-Match`.
 */

import { emitFarmAgentRead } from "./agent-identity";
import type { FarmPageFormAction } from "./markdown";

export interface FarmMarkdownHeading {
  /** GitHub-style slug, unique within the document. */
  id: string;
  level: number;
  text: string;
  /** Line index of the heading. */
  start: number;
  /** Line index where the section ends (exclusive): the next heading at the same or a higher level. */
  end: number;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const ATX_HEADING = /^\s{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

/** Parse ATX headings, skipping front matter and fenced code blocks. */
export function parseFarmMarkdownHeadings(markdown: string): FarmMarkdownHeading[] {
  return parseMarkdownHeadingsFromLines(markdown.split("\n"));
}

function parseMarkdownHeadingsFromLines(lines: string[]): FarmMarkdownHeading[] {
  const headings: FarmMarkdownHeading[] = [];
  const used = new Map<string, number>();
  let index = 0;

  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((line, lineIndex) => lineIndex > 0 && line.trim() === "---");
    if (close > 0) index = close + 1;
  }

  let fence: string | null = null;
  for (; index < lines.length; index++) {
    const line = lines[index];
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const match = ATX_HEADING.exec(line);
    if (!match) continue;
    const text = match[2].trim();
    const base = slugifyHeading(text) || "section";
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    headings.push({
      id: count === 0 ? base : `${base}-${count}`,
      level: match[1].length,
      text,
      start: index,
      end: lines.length,
    });
  }

  // One pass: a heading closes every open section at the same or a deeper level.
  const open: FarmMarkdownHeading[] = [];
  for (const heading of headings) {
    while (open.length > 0 && open[open.length - 1]!.level >= heading.level) {
      open.pop()!.end = heading.start;
    }
    open.push(heading);
  }

  return headings;
}

/** GitHub's heading anchor rules: lowercase, drop punctuation, spaces to hyphens. */
function slugifyHeading(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** Rough token estimate for budgeting: about four characters per token. */
export function estimateFarmMarkdownTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface FarmMarkdownView {
  status: number;
  body: string;
  /** Extra response headers, such as the `Link` to the next part. */
  headers?: Record<string, string>;
}

/** The smallest `?max_tokens` budget, so reading a page never takes hundreds of requests. */
export const FARM_MARKDOWN_MIN_TOKEN_BUDGET = 100;

/** Query parameters that choose a view of the mirror rather than belonging to the page. */
export const FARM_MARKDOWN_VIEW_PARAMS = [
  "outline",
  "section",
  "actions",
  "max_tokens",
  "cursor",
] as const;

/**
 * Select the part of a Markdown document a request asks for. Returns the whole
 * document when the request has neither `outline` nor `section`.
 */
export function selectFarmMarkdownView(
  markdown: string,
  searchParams: URLSearchParams,
  markdownPath: string,
): FarmMarkdownView {
  const wantsOutline = searchParams.has("outline");
  const sectionId = searchParams.get("section");
  const budget = searchParams.get("max_tokens");
  if (!wantsOutline && sectionId === null && budget === null)
    return { status: 200, body: markdown };

  // Links to other views keep the page's own query (`?category=shoes`), so they
  // read the same page this request rendered.
  const viewUrl = (view: Record<string, string | null | undefined>) => {
    const query = new URLSearchParams(searchParams);
    for (const name of FARM_MARKDOWN_VIEW_PARAMS) query.delete(name);
    for (const [name, value] of Object.entries(view)) {
      if (value !== null && value !== undefined) query.set(name, value);
    }
    const search = query.toString();
    return search ? `${markdownPath}?${search}` : markdownPath;
  };
  const withinBudget = (document: string): FarmMarkdownView =>
    budget === null
      ? { status: 200, body: document }
      : selectFarmMarkdownPart(document, budget, searchParams.get("cursor"), (cursor) =>
          viewUrl({ section: sectionId, max_tokens: budget, cursor }),
        );

  if (!wantsOutline && sectionId === null) return withinBudget(markdown);

  const lines = markdown.split("\n");
  const headings = parseMarkdownHeadingsFromLines(lines);
  const sectionText = (heading: FarmMarkdownHeading) =>
    lines.slice(heading.start, heading.end).join("\n").trim();

  if (sectionId !== null) {
    const heading = headings.find((candidate) => candidate.id === sectionId);
    if (heading) return withinBudget(`${sectionText(heading)}\n`);
    const available = headings.map((candidate) => `- \`${candidate.id}\``).join("\n");
    return {
      status: 404,
      body:
        `# Section not found\n\n${markdownCodeSpan(sectionId)} is not a section of ${markdownPath}.\n\n` +
        (available ? `Available sections:\n\n${available}\n` : "This page has no sections.\n"),
    };
  }

  // Outlines need section lengths, not copies of every overlapping section.
  // Offsets include the separating newlines and retain JS's UTF-16 counting.
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const minLevel = headings.reduce((min, heading) => Math.min(min, heading.level), 6);
  const entries = headings.map((heading) => {
    const indent = "  ".repeat(heading.level - minLevel);
    let last = heading.end - 1;
    while (last > heading.start && lines[last]!.trim().length === 0) last--;
    const first = lines[heading.start]!;
    const length =
      offsets[last]! +
      lines[last]!.trimEnd().length -
      offsets[heading.start]! -
      (first.length - first.trimStart().length);
    const tokens = Math.ceil(length / 4);
    return `${indent}- [${heading.text}](${viewUrl({ section: heading.id })}) ~${tokens} tokens`;
  });
  return {
    status: 200,
    body:
      `# Outline of ${markdownPath}\n\n` +
      `About ${estimateFarmMarkdownTokens(markdown)} tokens in total. Request one section with \`?section=<id>\`, or read in parts with \`?max_tokens=<n>\`.\n\n` +
      (entries.length > 0 ? `${entries.join("\n")}\n` : "This page has no headings.\n"),
  };
}

/**
 * Untrusted text as an inline code span: one line, fenced by more backticks than
 * it contains, so it cannot start a heading, a link, or HTML in the response.
 */
function markdownCodeSpan(value: string): string {
  const text = value.replace(/[\p{Cc}\u2028\u2029]+/gu, " ");
  const longestRun = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(longestRun + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** The page's forms as JSON, linked back to the page and its Markdown. */
function selectFarmPageActionsView(
  markdownPath: string,
  actions: readonly FarmPageFormAction[],
  headers: Headers,
): FarmMarkdownView {
  headers.set("Content-Type", "application/json; charset=utf-8");
  const page = markdownPath === "/index.md" ? "/" : markdownPath.replace(/\.md$/, "");
  return {
    status: 200,
    body: `${JSON.stringify({ page, markdown: markdownPath, actions }, null, 2)}\n`,
  };
}

/**
 * One part of a document that fits `?max_tokens`, cut where a reader would
 * pause: before a heading or after a blank line, never inside a code block
 * unless a single block is larger than the budget. A block cut that way is
 * closed at the end of this part and reopened at the start of the next. The
 * cursor names the line to continue from and the document it belongs to, so a
 * page that changes between requests is reported instead of read misaligned.
 */
function selectFarmMarkdownPart(
  document: string,
  rawBudget: string,
  rawCursor: string | null,
  partUrl: (cursor?: string) => string,
): FarmMarkdownView {
  const budget = /^\d{1,9}$/.test(rawBudget) ? Number(rawBudget) : Number.NaN;
  if (!(budget >= FARM_MARKDOWN_MIN_TOKEN_BUDGET)) {
    return {
      status: 400,
      body: `# Invalid max_tokens\n\n\`max_tokens\` must be a whole number of at least ${FARM_MARKDOWN_MIN_TOKEN_BUDGET}.\n`,
    };
  }

  const lines = document.replace(/\n$/, "").split("\n");
  const version = hashFarmMarkdown(document).slice(0, 8);
  let start = 0;
  if (rawCursor !== null) {
    const match = /^(\d{1,9})\.([0-9a-z]+)$/.exec(rawCursor);
    if (!match || Number(match[1]) <= 0 || Number(match[1]) >= lines.length) {
      return {
        status: 400,
        body: `# Invalid cursor\n\nStart again at ${partUrl()}.\n`,
      };
    }
    if (match[2] !== version) {
      return {
        status: 409,
        body: `# Page changed\n\nThe page changed after this cursor was issued. Start again at ${partUrl()}.\n`,
      };
    }
    start = Number(match[1]);
  }

  const fences = readOpenFences(lines);
  const reopen = fences[start];
  // Room for the reopened fence and the continuation line, at about four characters a token.
  const room = budget * 4 - 200;
  let size = reopen ? reopen.opener.length + 1 : 0;
  let end = start;
  let lastBreak = -1;
  while (end < lines.length) {
    const length = lines[end]!.length + 1;
    if (end > start && size + length > room) break;
    size += length;
    end++;
    if (end < lines.length && isPartBreak(lines, fences, end)) lastBreak = end;
  }

  const head = reopen ? `${reopen.opener}\n` : "";
  if (end >= lines.length) {
    return { status: 200, body: `${head}${lines.slice(start).join("\n")}\n` };
  }
  if (lastBreak > start) end = lastBreak;
  const open = fences[end];
  const part = `${head}${lines.slice(start, end).join("\n").replace(/\n+$/, "")}${open ? `\n${open.closer}` : ""}`;
  const next = partUrl(`${end}.${version}`);
  // Count the unreturned tail without allocating a copy of it. Each boundary
  // contributes one newline, exactly as slice(end).join("\n") did.
  let remainingLength = lines.length - end - 1;
  for (let index = end; index < lines.length; index++) remainingLength += lines[index]!.length;
  const remaining = Math.ceil(remainingLength / 4);
  return {
    status: 200,
    body: `${part}\n\n---\n\nContinue: ${next} (about ${remaining} more tokens)\n`,
    headers: { Link: `<${next}>; rel="next"` },
  };
}

interface OpenFence {
  opener: string;
  closer: string;
}

/** For each line, the code fence still open where that line begins, if any. */
function readOpenFences(lines: string[]): (OpenFence | undefined)[] {
  const open: (OpenFence | undefined)[] = [];
  let fence: (OpenFence & { marker: string }) | undefined;
  let frontMatter = lines[0]?.trim() === "---";
  for (let index = 0; index < lines.length; index++) {
    // Front matter is never cut, so it counts as an open block with nothing to reopen.
    open.push(frontMatter && index > 0 ? { opener: "", closer: "" } : fence);
    const line = lines[index]!;
    if (frontMatter) {
      if (index > 0 && line.trim() === "---") frontMatter = false;
      continue;
    }
    const match = FENCE.exec(line);
    if (!match) continue;
    const marker = match[1]!;
    if (!fence) fence = { opener: line.trim(), closer: marker, marker };
    else if (marker[0] === fence.marker[0] && marker.length >= fence.marker.length)
      fence = undefined;
  }
  return open;
}

function isPartBreak(lines: string[], fences: (OpenFence | undefined)[], index: number): boolean {
  if (fences[index]) return false;
  return lines[index - 1]!.trim() === "" || ATX_HEADING.test(lines[index]!);
}

function readMarkdownViewName(
  searchParams: URLSearchParams,
): "outline" | "section" | "parts" | "actions" | undefined {
  if (searchParams.has("actions")) return "actions";
  if (searchParams.has("outline")) return "outline";
  if (searchParams.has("max_tokens")) return "parts";
  return searchParams.has("section") ? "section" : undefined;
}

/** Weak ETag over the body, synchronous so it works on every runtime. */
export function createFarmMarkdownETag(body: string): string {
  return `W/"${hashFarmMarkdown(body)}-${body.length.toString(36)}"`;
}

/** cyrb53 in base 36: fast, well-distributed, and no dependency on node:crypto. */
function hashFarmMarkdown(body: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < body.length; index++) {
    const code = body.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function ifNoneMatchIncludes(header: string | null, etag: string): boolean {
  if (!header) return false;
  const opaque = etag.replace(/^W\//, "");
  return header
    .split(",")
    .map((token) => token.trim())
    .some((token) => token === "*" || token.replace(/^W\//, "") === opaque);
}

/**
 * Build the final Markdown response: apply `?outline` / `?section`, add an
 * ETag, and evaluate ETag preconditions. `?actions` answers with
 * the page's forms as JSON instead; a Markdown source has none. Errors retain
 * their full explanation and status regardless of the requested view.
 */
export function createFarmMarkdownViewResponse(options: {
  request: Request;
  requestUrl?: URL;
  markdown: string;
  status: number;
  headers: Headers;
  markdownPath: string;
  actions?: readonly FarmPageFormAction[];
}): Response {
  const url = options.requestUrl ?? new URL(options.request.url);
  const view: FarmMarkdownView =
    options.status >= 400
      ? { status: options.status, body: options.markdown }
      : url.searchParams.has("actions")
        ? selectFarmPageActionsView(options.markdownPath, options.actions ?? [], options.headers)
        : selectFarmMarkdownView(options.markdown, url.searchParams, options.markdownPath);
  let status = view.status === 200 ? options.status : view.status;
  // Our ETags are always weak, so no entity-tag can satisfy If-Match's strong
  // comparison. Only the existence wildcard succeeds. Page/view errors win.
  const ifMatch = options.request.headers.get("if-match");
  const preconditionFailed =
    status >= 200 && status < 300 && ifMatch !== null && ifMatch.trim() !== "*";
  if (preconditionFailed) {
    status = 412;
    options.headers.set("Cache-Control", "no-store");
  }
  emitFarmAgentRead(options.request, "markdown", status, readMarkdownViewName(url.searchParams));
  for (const [name, value] of Object.entries(view.headers ?? {}))
    options.headers.append(name, value);
  const etag = createFarmMarkdownETag(view.body);
  options.headers.set("ETag", etag);

  if (status === 200 && ifNoneMatchIncludes(options.request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers: options.headers });
  }
  return new Response(preconditionFailed || options.request.method === "HEAD" ? null : view.body, {
    status,
    headers: options.headers,
  });
}
