export type FarmCspDirectiveValue = string | readonly string[] | boolean | null | undefined;

export type FarmCspDirectives = Readonly<Record<string, FarmCspDirectiveValue>>;

export interface FarmCspOptions {
  /** A pre-serialized CSP value. Cannot be combined with directives. */
  policy?: string;
  /** CSP directives using camelCase or kebab-case names. */
  directives?: FarmCspDirectives;
  /** Emit Content-Security-Policy-Report-Only instead of enforcing the policy. */
  reportOnly?: boolean;
  /**
   * Generate a fresh nonce for every dynamic HTML response and per-page
   * script hashes for prerendered HTML. Farm adds the matching sources to the
   * governing script directive and stamps dynamic script elements with the
   * response nonce.
   */
  nonce?: boolean;
}

export type FarmCspConfig = string | FarmCspOptions;

export interface FarmSecurityConfig {
  /** App-wide CSP for dynamic responses and prerendered output. */
  csp?: FarmCspConfig | false;
  /** @deprecated Use csp. */
  contentSecurityPolicy?: never;
}

export interface ResolvedFarmCspConfig {
  value: string;
  reportOnly: boolean;
  nonce: boolean;
}

export interface ResolvedFarmSecurityConfig {
  csp: ResolvedFarmCspConfig | false;
}

export function resolveFarmSecurityConfig(
  input: FarmSecurityConfig | ResolvedFarmSecurityConfig | undefined,
): ResolvedFarmSecurityConfig {
  if (input === undefined) return { csp: false };
  if (!isPlainRecord(input)) {
    throw new TypeError("security must be an object containing the csp option.");
  }
  if (Object.prototype.hasOwnProperty.call(input, "contentSecurityPolicy")) {
    throw new TypeError(
      "security.contentSecurityPolicy is not supported. Use security.csp instead.",
    );
  }

  const csp = input.csp;
  if (csp === undefined || csp === false) return { csp: false };

  if (typeof csp === "string") {
    return {
      csp: {
        value: validateSerializedCsp(csp),
        reportOnly: false,
        nonce: false,
      },
    };
  }

  if (!isPlainRecord(csp)) {
    throw new TypeError("security.csp must be a policy string, false, or an options object.");
  }

  const reportOnly = validateReportOnly(csp.reportOnly);
  const nonce = validateNonce(csp.nonce);
  if (Object.prototype.hasOwnProperty.call(csp, "value")) {
    if (
      Object.prototype.hasOwnProperty.call(csp, "policy") ||
      Object.prototype.hasOwnProperty.call(csp, "directives")
    ) {
      throw new TypeError(
        "Resolved security.csp values cannot include policy or directives options.",
      );
    }
    return {
      csp: {
        value: validateSerializedCsp(csp.value),
        reportOnly,
        nonce,
      },
    };
  }

  const { policy, directives } = csp;
  if (policy !== undefined && directives !== undefined) {
    throw new TypeError("security.csp accepts either policy or directives, not both.");
  }
  if (policy === undefined && directives === undefined) {
    throw new TypeError("security.csp requires a policy string or directives object.");
  }

  return {
    csp: {
      value:
        policy !== undefined
          ? validateSerializedCsp(policy)
          : serializeFarmCspDirectives(directives as FarmCspDirectives),
      reportOnly,
      nonce,
    },
  };
}

export function serializeFarmCspDirectives(directives: FarmCspDirectives): string {
  if (!isPlainRecord(directives)) {
    throw new TypeError("security.csp.directives must be an object.");
  }
  const serialized: string[] = [];
  const normalizedNames = new Set<string>();

  for (const [configuredName, configuredValue] of Object.entries(directives)) {
    if (configuredValue === false || configuredValue === null || configuredValue === undefined) {
      continue;
    }

    const name = normalizeDirectiveName(configuredName);
    if (normalizedNames.has(name)) {
      throw new TypeError(`security.csp contains the duplicate directive ${JSON.stringify(name)}.`);
    }
    normalizedNames.add(name);

    const values =
      configuredValue === true
        ? []
        : (Array.isArray(configuredValue) ? configuredValue : [configuredValue]).map(
            validateDirectiveValue,
          );
    serialized.push(values.length > 0 ? `${name} ${values.join(" ")}` : name);
  }

  if (serialized.length === 0) {
    throw new TypeError("security.csp.directives must contain at least one enabled directive.");
  }
  return serialized.join("; ");
}

export function getFarmSecurityHeader(
  security: ResolvedFarmSecurityConfig,
  nonce?: string,
): { key: string; value: string } | undefined {
  if (!security.csp) return undefined;
  if (security.csp.nonce && !nonce) return undefined;
  return {
    key: security.csp.reportOnly
      ? "Content-Security-Policy-Report-Only"
      : "Content-Security-Policy",
    value: nonce ? applyFarmCspNonceToPolicy(security.csp.value, nonce) : security.csp.value,
  };
}

export function createFarmCspNonce(security: ResolvedFarmSecurityConfig): string | undefined {
  if (!security.csp || !security.csp.nonce) return undefined;
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function applyFarmCspNonceToPolicy(policy: string, nonce: string): string {
  validateCspNonce(nonce);
  return applyFarmCspScriptSourcesToPolicy(policy, [`'nonce-${nonce}'`]);
}

export function applyFarmCspHashesToPolicy(policy: string, hashes: readonly string[]): string {
  const sources = hashes.map((hash) => {
    if (!/^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(hash)) {
      throw new TypeError(`Invalid CSP script hash: ${JSON.stringify(hash)}.`);
    }
    return `'${hash}'`;
  });
  return applyFarmCspScriptSourcesToPolicy(policy, sources);
}

function applyFarmCspScriptSourcesToPolicy(policy: string, sources: readonly string[]): string {
  const uniqueSources = [...new Set(sources)];
  if (uniqueSources.length === 0) return policy;
  const segments = policy
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const names = segments.map((segment) => segment.split(/\s+/, 1)[0]!.toLowerCase());
  const governingName = names.includes("script-src-elem")
    ? "script-src-elem"
    : names.includes("script-src")
      ? "script-src"
      : names.includes("default-src")
        ? "default-src"
        : undefined;

  if (!governingName) return `${policy}; script-src ${uniqueSources.join(" ")}`;
  return segments
    .map((segment, index) => {
      if (names[index] !== governingName) return segment;
      const existing = new Set(segment.split(/\s+/));
      const missing = uniqueSources.filter((source) => !existing.has(source));
      return missing.length > 0 ? `${segment} ${missing.join(" ")}` : segment;
    })
    .join("; ");
}

export function addFarmCspNonceToScriptTags(html: string, nonce: string): string {
  validateCspNonce(nonce);
  return createFarmCspNonceRewriter(nonce).write(html, true);
}

export function removeFarmCspNoncesFromScriptTags(html: string): string {
  return createFarmScriptTagRewriter(stripScriptNonceAttribute).write(html, true);
}

export async function createFarmCspScriptHashes(html: string): Promise<string[]> {
  const hashes: string[] = [];
  const seen = new Set<string>();
  for (const content of collectFarmInlineScriptContents(html)) {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(content),
    );
    let binary = "";
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
    const hash = `sha256-${globalThis.btoa(binary)}`;
    if (!seen.has(hash)) {
      seen.add(hash);
      hashes.push(hash);
    }
  }
  return hashes;
}

export async function applyFarmCspHashesToHtml(
  html: string,
  security: ResolvedFarmSecurityConfig,
): Promise<{ html: string; header: { key: string; value: string } } | undefined> {
  if (!security.csp || !security.csp.nonce) return undefined;
  const staticHtml = removeFarmCspNoncesFromScriptTags(html);
  const hashes = await createFarmCspScriptHashes(staticHtml);
  return {
    html: staticHtml,
    header: {
      key: security.csp.reportOnly
        ? "Content-Security-Policy-Report-Only"
        : "Content-Security-Policy",
      value: applyFarmCspHashesToPolicy(security.csp.value, hashes),
    },
  };
}

export function applyFarmCspNonceToResponse(
  response: Response,
  security: ResolvedFarmSecurityConfig,
): Response {
  if (!security.csp || !security.csp.nonce) return response;
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) return response;

  const nonce = createFarmCspNonce(security)!;
  const securityHeader = getFarmSecurityHeader(security, nonce)!;
  const headers = new Headers(response.headers);
  headers.set(securityHeader.key, securityHeader.value);
  headers.delete("content-length");

  if (!response.body) {
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const rewriter = createFarmCspNonceRewriter(nonce);
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const output = rewriter.write(decoder.decode(chunk, { stream: true }));
        if (output) controller.enqueue(encoder.encode(output));
      },
      flush(controller) {
        const output = rewriter.write(decoder.decode(), true);
        if (output) controller.enqueue(encoder.encode(output));
      },
    }),
  );

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Whether a resolved CSP would block the inline scripts the framework injects
 * into SSR documents (theme bootstrap, hydration bootstraps).
 *
 * Without nonce mode, those scripts carry no nonce and their content varies
 * per page, so a static hash cannot allow them either. They run only when the
 * governing directive (`script-src-elem`, then `script-src`, then
 * `default-src`) allows `'unsafe-inline'` and lists no nonce, hash, or
 * `'strict-dynamic'` source: browsers ignore `'unsafe-inline'` as soon as any
 * of those is present. A policy with no script-governing directive does not
 * restrict inline scripts, so it is not flagged. Nonce mode handles this at
 * response time and therefore never reports the static policy as blocking.
 */
export function farmCspBlocksFrameworkInlineScripts(security: ResolvedFarmSecurityConfig): boolean {
  if (!security.csp) return false;
  if (security.csp.nonce) return false;

  const directives = parseCspDirectives(security.csp.value);
  const governing =
    directives.get("script-src-elem") ??
    directives.get("script-src") ??
    directives.get("default-src");
  if (!governing) return false;

  const sources = governing.map((source) => source.toLowerCase());
  const disablesUnsafeInline = sources.some(
    (value) =>
      value === "'strict-dynamic'" ||
      value.startsWith("'nonce-") ||
      value.startsWith("'sha256-") ||
      value.startsWith("'sha384-") ||
      value.startsWith("'sha512-"),
  );
  return !sources.includes("'unsafe-inline'") || disablesUnsafeInline;
}

function parseCspDirectives(value: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const segment of value.split(";")) {
    const parts = segment.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    const name = parts[0]!.toLowerCase();
    if (!directives.has(name)) directives.set(name, parts.slice(1));
  }
  return directives;
}

function normalizeDirectiveName(value: string): string {
  const name = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new TypeError(`Invalid security.csp directive name: ${JSON.stringify(value)}.`);
  }
  return name;
}

function validateDirectiveValue(value: string): string {
  if (typeof value !== "string") {
    throw new TypeError("security.csp directive values must be strings or booleans.");
  }
  const normalized = value.trim();
  if (!normalized || /[;\r\n]/.test(normalized) || normalized.includes("\0")) {
    throw new TypeError(`Invalid security.csp directive value: ${JSON.stringify(value)}.`);
  }
  return normalized;
}

function validateSerializedCsp(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("security.csp policy must be a non-empty single-line string.");
  }
  const normalized = value.trim().replace(/;+$/g, "").trim();
  if (!normalized || /[\r\n]/.test(normalized) || normalized.includes("\0")) {
    throw new TypeError("security.csp policy must be a non-empty single-line string.");
  }
  return normalized;
}

function validateReportOnly(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new TypeError("security.csp.reportOnly must be a boolean.");
  }
  return value;
}

function validateNonce(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new TypeError("security.csp.nonce must be a boolean.");
  }
  return value;
}

function validateCspNonce(value: string): void {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    throw new TypeError("A CSP nonce must be a base64 or base64url value.");
  }
}

export function createFarmCspNonceRewriter(nonce: string) {
  validateCspNonce(nonce);
  return createFarmScriptTagRewriter((tag) => stampScriptTag(tag, nonce));
}

function createFarmScriptTagRewriter(transformScriptTag: (tag: string) => string) {
  let pending = "";
  let rawTextElement: string | undefined;

  return {
    write(chunk: string, final = false): string {
      pending += chunk;
      let output = "";

      while (pending) {
        if (rawTextElement) {
          if (rawTextElement === "plaintext") {
            output += pending;
            pending = "";
            break;
          }
          const closing = `</${rawTextElement}`;
          const start = findRawTextEnd(pending, rawTextElement);
          if (start === -1) {
            if (final) {
              output += pending;
              pending = "";
            } else {
              const keep = matchingSuffixLength(pending, closing);
              output += pending.slice(0, pending.length - keep);
              pending = pending.slice(pending.length - keep);
            }
            break;
          }

          output += pending.slice(0, start);
          pending = pending.slice(start);
          const end = findHtmlTagEnd(pending);
          if (end === -1) {
            if (final) {
              output += pending;
              pending = "";
            }
            break;
          }
          output += pending.slice(0, end + 1);
          pending = pending.slice(end + 1);
          rawTextElement = undefined;
          continue;
        }

        const start = pending.indexOf("<");
        if (start === -1) {
          output += pending;
          pending = "";
          break;
        }
        output += pending.slice(0, start);
        pending = pending.slice(start);

        if (pending.startsWith("<!--")) {
          const end = pending.indexOf("-->", 4);
          if (end === -1) {
            if (final) {
              output += pending;
              pending = "";
            }
            break;
          }
          output += pending.slice(0, end + 3);
          pending = pending.slice(end + 3);
          continue;
        }
        if (!final && "<!--".startsWith(pending)) break;

        const tagNameMatch = pending.match(/^<\/?([a-z][a-z0-9:-]*)\b/i);
        if (!tagNameMatch) {
          if (!final && /^<\/?[a-z][a-z0-9:-]*$/i.test(pending)) break;
          output += pending[0];
          pending = pending.slice(1);
          continue;
        }

        const end = findHtmlTagEnd(pending);
        if (end === -1) {
          if (!final) break;
          output += pending;
          pending = "";
          break;
        }

        const tag = pending.slice(0, end + 1);
        const tagName = tagNameMatch[1]!.toLowerCase();
        const isClosing = pending.startsWith("</");
        const isSelfClosing = /\/\s*>$/.test(tag);
        output += !isClosing && tagName === "script" ? transformScriptTag(tag) : tag;
        pending = pending.slice(end + 1);
        if (!isClosing && !isSelfClosing && rawTextElements.has(tagName)) {
          rawTextElement = tagName;
        }
      }

      return output;
    },
  };
}

const rawTextElements = new Map<string, RegExp | null>([
  ["iframe", /<\/iframe(?=[\s/>]|$)/gi],
  ["noembed", /<\/noembed(?=[\s/>]|$)/gi],
  ["noframes", /<\/noframes(?=[\s/>]|$)/gi],
  ["plaintext", null],
  ["script", /<\/script(?=[\s/>]|$)/gi],
  ["style", /<\/style(?=[\s/>]|$)/gi],
  ["textarea", /<\/textarea(?=[\s/>]|$)/gi],
  ["title", /<\/title(?=[\s/>]|$)/gi],
  ["xmp", /<\/xmp(?=[\s/>]|$)/gi],
]);

function stampScriptTag(tag: string, nonce: string): string {
  const opening = tag.match(/^<script\b/i)?.[0];
  if (!opening) return tag;
  const attributes = stripScriptNonceAttribute(tag).slice(opening.length, -1);
  return `<script nonce="${nonce}"${attributes}>`;
}

function stripScriptNonceAttribute(tag: string): string {
  let normalized = tag;
  let range = findScriptTagAttributeRange(normalized, "nonce");
  while (range) {
    normalized = normalized.slice(0, range.start) + normalized.slice(range.end);
    range = findScriptTagAttributeRange(normalized, "nonce");
  }
  return normalized;
}

function collectFarmInlineScriptContents(html: string): string[] {
  const contents: string[] = [];
  let offset = 0;

  while (offset < html.length) {
    const start = html.indexOf("<", offset);
    if (start === -1) break;
    if (html.startsWith("<!--", start)) {
      const commentEnd = html.indexOf("-->", start + 4);
      offset = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }

    const remaining = html.slice(start);
    const tagNameMatch = remaining.match(/^<\/?([a-z][a-z0-9:-]*)\b/i);
    if (!tagNameMatch) {
      offset = start + 1;
      continue;
    }
    const tagEnd = findHtmlTagEnd(remaining);
    if (tagEnd === -1) break;
    const tag = remaining.slice(0, tagEnd + 1);
    const tagName = tagNameMatch[1]!.toLowerCase();
    const isClosing = remaining.startsWith("</");
    const isSelfClosing = /\/\s*>$/.test(tag);
    offset = start + tagEnd + 1;
    if (isClosing || isSelfClosing || !rawTextElements.has(tagName)) continue;

    if (tagName === "plaintext") break;
    const closingStart = findRawTextEnd(html, tagName, offset);
    const contentEnd = closingStart === -1 ? html.length : closingStart;
    if (tagName === "script" && !findScriptTagAttributeRange(tag, "src")) {
      contents.push(html.slice(offset, contentEnd));
    }
    if (closingStart === -1) break;
    const closingEnd = findHtmlTagEnd(html.slice(contentEnd));
    if (closingEnd === -1) break;
    offset = contentEnd + closingEnd + 1;
  }

  return contents;
}

function findScriptTagAttributeRange(
  tag: string,
  expectedName: string,
): { start: number; end: number } | undefined {
  const opening = tag.match(/^<script\b/i)?.[0];
  if (!opening) return undefined;
  let offset = opening.length;

  while (offset < tag.length - 1) {
    const whitespaceStart = offset;
    while (/\s/.test(tag[offset] || "")) offset++;
    if (tag[offset] === "/" || tag[offset] === ">" || offset >= tag.length - 1) break;

    const nameStart = offset;
    while (offset < tag.length && !/[\s=/>]/.test(tag[offset]!)) offset++;
    const name = tag.slice(nameStart, offset).toLowerCase();
    while (/\s/.test(tag[offset] || "")) offset++;
    if (tag[offset] === "=") {
      offset++;
      while (/\s/.test(tag[offset] || "")) offset++;
      const quote = tag[offset] === '"' || tag[offset] === "'" ? tag[offset++] : undefined;
      if (quote) {
        while (offset < tag.length && tag[offset] !== quote) offset++;
        if (tag[offset] === quote) offset++;
      } else {
        while (offset < tag.length && !/[\s>]/.test(tag[offset]!)) offset++;
      }
    }
    if (name === expectedName) return { start: whitespaceStart, end: offset };
  }

  return undefined;
}

function findRawTextEnd(input: string, tagName: string, offset = 0): number {
  // Search the original string with ASCII case-insensitive closing tags:
  // lowercasing entire HTML can expand Unicode (İ → i̇) and invalidate offsets.
  const closing = rawTextElements.get(tagName)!;
  // Each synchronous search resets the cursor; separate streamed responses
  // must not inherit another response's match position.
  closing.lastIndex = offset;
  return closing.exec(input)?.index ?? -1;
}

function matchingSuffixLength(input: string, token: string): number {
  const limit = Math.min(token.length - 1, input.length);
  for (let length = limit; length > 0; length--) {
    if (token.startsWith(input.slice(-length).toLowerCase())) return length;
  }
  return 0;
}

function findHtmlTagEnd(tag: string): number {
  let quote: '"' | "'" | undefined;
  for (let index = 1; index < tag.length; index++) {
    const character = tag[index];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
