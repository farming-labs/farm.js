import { createHash } from "node:crypto";
import type { LoadedFarmDocsPage } from "./handler";
import type {
  FarmDocsResolvedConfig,
  FarmDocsSocialImageConfig,
  FarmDocsSocialImageFonts,
} from "./types";

export const FARM_DOCS_SOCIAL_IMAGE_WIDTH = 1200;
export const FARM_DOCS_SOCIAL_IMAGE_HEIGHT = 630;

export interface FarmDocsSocialImageDescriptor {
  title: string;
  description: string;
  section: string;
  siteName: string;
  brand: string;
  pageHref: string;
  pageUrl: string;
  imagePath: string;
  imageUrl: string;
  imageAlt: string;
  illustration: FarmDocsSocialImageIllustration;
  fonts?: FarmDocsSocialImageFonts;
  hash: string;
}

export type FarmDocsSocialImageIllustration =
  | "auth"
  | "cache"
  | "cli"
  | "integrations"
  | "project"
  | "routing"
  | "runtime";

const FARM_DOCS_SOCIAL_IMAGE_VERSION = 3;

function normalizeEntry(entry: string): string {
  if (!entry || entry === "/") return "";
  return `/${entry.replace(/^\/+|\/+$/g, "")}`;
}

function encodeSlugPath(slug: string): string {
  return slug
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function getSocialImageConfig(docs: FarmDocsResolvedConfig): FarmDocsSocialImageConfig | undefined {
  return typeof docs.config.socialImage === "object" && docs.config.socialImage
    ? docs.config.socialImage
    : undefined;
}

function getNavTitle(docs: FarmDocsResolvedConfig): string {
  if (typeof docs.config.nav !== "object" || !docs.config.nav || !("title" in docs.config.nav)) {
    return "Farm.js";
  }
  return String((docs.config.nav as { title?: unknown }).title || "Farm.js");
}

function isFalse(value: string | undefined): boolean {
  return value ? /^(false|no|none|off|disabled)$/i.test(value.trim()) : false;
}

function isExternalOrRootPath(value: string): boolean {
  return /^(https?:)?\/\//i.test(value) || value.startsWith("/");
}

export function isFarmDocsSocialImageEnabled(
  page: LoadedFarmDocsPage,
  docs: FarmDocsResolvedConfig,
): boolean {
  if (docs.config.socialImage === false || getSocialImageConfig(docs)?.enabled === false) {
    return false;
  }
  return !isFalse(page.frontmatter.socialImage);
}

export function getFarmDocsCustomSocialImage(page: LoadedFarmDocsPage): string | undefined {
  const value =
    page.frontmatter.socialImage || page.frontmatter.openGraphImage || page.frontmatter.ogImage;
  return value && !isFalse(value) && isExternalOrRootPath(value) ? value : undefined;
}

function resolveIllustration(page: LoadedFarmDocsPage): FarmDocsSocialImageIllustration {
  const explicit = page.frontmatter.socialIllustration?.toLowerCase();
  if (
    explicit === "auth" ||
    explicit === "cache" ||
    explicit === "cli" ||
    explicit === "integrations" ||
    explicit === "project" ||
    explicit === "routing" ||
    explicit === "runtime"
  ) {
    return explicit;
  }

  const source = `${page.slug} ${page.title} ${page.section || ""}`.toLowerCase();
  if (/auth|session|security|csrf/.test(source)) return "auth";
  if (/cache|ppr|render|static|revalid|stream/.test(source)) return "cache";
  if (/integration|stripe|prisma|better.auth|email|job|workflow/.test(source)) {
    return "integrations";
  }
  if (/cli|test|deploy|preview|upgrade|migration|install/.test(source)) return "cli";
  if (/project|structure|config|environment|markdown|docs.engine/.test(source)) {
    return "project";
  }
  if (/rout|endpoint|middleware|navigation|server.function|server.action|api/.test(source)) {
    return "routing";
  }
  return "runtime";
}

function createHashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function resolveBaseUrl(requestUrl: URL, config: FarmDocsSocialImageConfig | undefined): URL {
  return config?.baseUrl ? new URL(config.baseUrl) : new URL(requestUrl.origin);
}

export function createFarmDocsSocialImageDescriptor(
  page: LoadedFarmDocsPage,
  docs: FarmDocsResolvedConfig,
  requestUrl: URL,
): FarmDocsSocialImageDescriptor {
  const config = getSocialImageConfig(docs);
  const siteName = config?.siteName || getNavTitle(docs);
  const brand = config?.brand || siteName;
  const title = page.frontmatter.socialTitle || page.title;
  const description =
    page.frontmatter.socialDescription ||
    page.description ||
    docs.config.metadata?.description ||
    `Documentation for ${siteName}`;
  const section = page.frontmatter.section || page.section || "Documentation";
  const illustration = resolveIllustration(page);
  const entry = normalizeEntry(docs.entry);
  const slugPath = encodeSlugPath(page.slug) || "index";
  const imagePath = `${entry}/_social/${slugPath}/opengraph-image.svg`;
  const baseUrl = resolveBaseUrl(requestUrl, config);
  const pageUrl = new URL(page.href, baseUrl).href;
  const imageAlt = `${title} — ${siteName} documentation`;
  const hash = createHashValue({
    version: FARM_DOCS_SOCIAL_IMAGE_VERSION,
    title,
    description,
    section,
    siteName,
    brand,
    pageHref: page.href,
    illustration,
    fonts: config?.fonts,
  });

  return {
    title,
    description,
    section,
    siteName,
    brand,
    pageHref: page.href,
    pageUrl,
    imagePath,
    imageUrl: new URL(`${imagePath}?v=${hash}`, baseUrl).href,
    imageAlt,
    illustration,
    fonts: config?.fonts,
    hash,
  };
}

export function getFarmDocsSocialImageSlug(
  docs: FarmDocsResolvedConfig,
  requestUrl: URL,
): string | null {
  const entry = normalizeEntry(docs.entry);
  const prefix = `${entry}/_social/`;
  const suffix = "/opengraph-image.svg";
  if (!requestUrl.pathname.startsWith(prefix) || !requestUrl.pathname.endsWith(suffix)) {
    return null;
  }

  const rawSlug = requestUrl.pathname.slice(prefix.length, -suffix.length);
  if (!rawSlug) return null;
  try {
    const slug = rawSlug
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
    if (slug.split("/").some((segment) => !segment || segment === ".." || segment === ".")) {
      return null;
    }
    return slug === "index" ? "" : slug;
  } catch {
    return null;
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncate(value: string, length: number): string {
  if (value.length <= length) return value;
  return `${value.slice(0, Math.max(0, length - 1)).trimEnd()}…`;
}

function wrapText(value: string, maxCharacters: number, maxLines: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let consumedWords = 0;

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharacters || !current) {
      current = candidate;
      consumedWords += 1;
      continue;
    }
    lines.push(current);
    if (lines.length === maxLines) break;
    current = word;
    consumedWords += 1;
  }

  if (current && lines.length < maxLines) lines.push(current);
  if (consumedWords < words.length && lines.length) {
    lines[lines.length - 1] = truncate(`${lines[lines.length - 1]}…`, maxCharacters);
  }
  return lines;
}

function renderTextLines(
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
  attributes: string,
): string {
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" ${attributes}>${escapeXml(line)}</text>`,
    )
    .join("");
}

function renderEmbeddedFont(name: string, source: string | undefined, weight: string): string {
  if (!source) return "";
  return `@font-face{font-family:"${name}";src:url("${escapeXml(source)}") format("woff2");font-style:normal;font-weight:${weight};font-display:block;}`;
}

function renderArrow(x1: number, y: number, x2: number, color = "#8b8b8b"): string {
  return `<path d="M${x1} ${y}H${x2 - 9}" fill="none" stroke="${color}"/><path d="m${x2 - 9} ${y - 5} 9 5-9 5" fill="none" stroke="${color}"/>`;
}

function renderPanelHeader(label: string, status: string): string {
  return `<text x="819" y="171" class="label">${escapeXml(label)}</text><text x="1134" y="171" class="label bright" text-anchor="end">${escapeXml(status)}</text>`;
}

function renderRoutingIllustration(): string {
  return `${renderPanelHeader("ROUTE BLUEPRINT", "TYPED")}
    <rect x="819" y="296" width="92" height="54" fill="#a3a3a3"/>
    <text x="832" y="327" class="diagram-title ink">src/app</text>
    <path d="M911 323h41M952 232v181M952 232h44M952 323h44M952 413h44" fill="none" stroke="#696969"/>
    <rect x="996" y="205" width="138" height="54" fill="#0a0a0a" stroke="#414141"/>
    <text x="1010" y="228" class="diagram-title">/</text><text x="1010" y="246" class="micro">STATIC</text>
    <rect x="996" y="296" width="138" height="54" fill="#0a0a0a" stroke="#414141"/>
    <text x="1010" y="319" class="diagram-title">/blog/:slug</text><text x="1010" y="337" class="micro">DYNAMIC</text>
    <rect x="996" y="386" width="138" height="55" fill="#f0f0f0"/>
    <text x="1010" y="410" class="diagram-title ink">/docs/:path*</text><text x="1010" y="428" class="micro ink-muted">CATCH-ALL</text>
    <line x1="819" y1="450" x2="1134" y2="450" stroke="#343434"/>
    <text x="819" y="475" class="label bright">FILE ROUTES</text><text x="1134" y="475" class="label" text-anchor="end">TYPES INCLUDED</text>`;
}

function renderAuthIllustration(): string {
  return `${renderPanelHeader("REQUEST GUARD", "SERVER VERIFIED")}
    <rect x="819" y="269" width="86" height="54" fill="#0a0a0a" stroke="#454545"/>
    <text x="837" y="292" class="micro bright">REQUEST</text><text x="837" y="310" class="diagram-title">GET /app</text>
    ${renderArrow(905, 296, 943)}
    <rect x="943" y="224" width="104" height="118" fill="#f0f0f0"/>
    <path d="M974 271v-12a21 21 0 0 1 42 0v12M968 271h54v45h-54z" fill="#050505"/>
    <circle cx="995" cy="292" r="4" fill="#f0f0f0"/><path d="M995 296v8" stroke="#f0f0f0" stroke-width="3"/>
    <text x="995" y="332" class="micro ink" text-anchor="middle">auth()</text>
    ${renderArrow(1047, 296, 1071)}
    <rect x="1071" y="269" width="63" height="54" fill="#0a0a0a" stroke="#454545"/>
    <text x="1082" y="292" class="micro bright">ALLOW</text><text x="1082" y="310" class="micro">/app</text>
    <rect x="819" y="372" width="315" height="38" fill="#090909" stroke="#3d3d3d"/>
    <rect x="832" y="385" width="11" height="11" fill="#a3a3a3"/>
    <text x="856" y="395" class="code">session.user / verified</text>
    <line x1="819" y1="450" x2="1134" y2="450" stroke="#343434"/>
    <text x="819" y="475" class="label bright">SESSION TYPED</text><text x="1134" y="475" class="label" text-anchor="end">CSRF PROTECTED</text>`;
}

function renderCacheIllustration(): string {
  return `${renderPanelHeader("PAGE / PRODUCT", "CACHE + PPR")}
    <rect x="819" y="204" width="315" height="54" fill="#f0f0f0"/>
    <text x="836" y="235" class="diagram-title ink">STATIC SHELL</text><text x="1116" y="235" class="micro ink-muted" text-anchor="end">BUILD</text>
    <rect x="819" y="271" width="198" height="76" fill="#a3a3a3"/>
    <text x="836" y="301" class="diagram-title ink">CACHED DATA</text><text x="836" y="326" class="micro ink-muted">tag: products</text>
    <rect x="1029" y="271" width="105" height="76" fill="#0a0a0a" stroke="#555"/>
    <text x="1045" y="301" class="diagram-title">LIVE</text><text x="1045" y="326" class="micro">stream</text>
    <path d="M1081 347v43m-8-9 8 9 8-9" fill="none" stroke="#d4d4d4"/>
    <line x1="819" y1="450" x2="1134" y2="450" stroke="#343434"/>
    <text x="819" y="475" class="label bright">STATIC FIRST</text><text x="1134" y="475" class="label" text-anchor="end">DYNAMIC WHERE NEEDED</text>`;
}

function renderIntegrationsIllustration(): string {
  return `${renderPanelHeader("INTEGRATION GRAPH", "ONE PRODUCT")}
    <path d="M976 309H879V247M976 309H879v87M1030 309h93V247M1030 309h93v87" fill="none" stroke="#4a4a4a"/>
    <rect x="819" y="214" width="120" height="57" fill="#0a0a0a" stroke="#4b4b4b"/><text x="839" y="247" class="diagram-title">BETTER AUTH</text>
    <rect x="819" y="368" width="120" height="57" fill="#0a0a0a" stroke="#4b4b4b"/><text x="851" y="401" class="diagram-title">PRISMA</text>
    <rect x="1061" y="214" width="73" height="57" fill="#0a0a0a" stroke="#4b4b4b"/><text x="1077" y="247" class="diagram-title">STRIPE</text>
    <rect x="1061" y="368" width="73" height="57" fill="#a3a3a3"/><text x="1075" y="401" class="diagram-title ink">VERCEL</text>
    <rect x="976" y="277" width="94" height="64" fill="#f0f0f0"/>
    <text x="994" y="304" class="diagram-title ink">FARM.JS</text><text x="994" y="324" class="micro ink-muted">CORE</text>
    <line x1="819" y1="450" x2="1134" y2="450" stroke="#343434"/>
    <text x="819" y="475" class="label bright">BRING YOUR STACK</text><text x="1134" y="475" class="label" text-anchor="end">CONNECTED ONCE</text>`;
}

function renderCliIllustration(): string {
  return `${renderPanelHeader("TERMINAL", "PRODUCTION OUTPUT")}
    <rect x="819" y="203" width="315" height="213" fill="#050505" stroke="#555"/>
    <line x1="819" y1="236" x2="1134" y2="236" stroke="#555"/>
    <circle cx="837" cy="220" r="4" fill="#5d5d5d"/><circle cx="850" cy="220" r="4" fill="#7a7a7a"/><circle cx="863" cy="220" r="4" fill="#a3a3a3"/>
    <text x="837" y="273" class="code bright"><tspan fill="#7a7a7a">$</tspan> farm build</text>
    <rect x="837" y="293" width="11" height="11" fill="#a3a3a3"/><path d="m839 298 3 3 6-7" fill="none" stroke="#050505" stroke-width="1.5"/>
    <text x="861" y="303" class="code">64 routes discovered</text>
    <rect x="837" y="320" width="11" height="11" fill="#a3a3a3"/><path d="m839 325 3 3 6-7" fill="none" stroke="#050505" stroke-width="1.5"/>
    <text x="861" y="330" class="code">client + server bundles</text>
    <rect x="837" y="355" width="126" height="30" fill="#f0f0f0"/><text x="853" y="374" class="micro ink">BUILD COMPLETE</text>
    <text x="1115" y="374" class="micro" text-anchor="end">/dist</text>
    <line x1="819" y1="450" x2="1134" y2="450" stroke="#343434"/>
    <text x="819" y="475" class="label bright">REAL COMMANDS</text><text x="1134" y="475" class="label" text-anchor="end">842MS</text>`;
}

function renderProjectIllustration(): string {
  return `${renderPanelHeader("PROJECT MAP", "CONVENTION TYPED")}
    <rect x="819" y="202" width="315" height="216" fill="#050505" stroke="#555"/>
    <text x="837" y="227" class="diagram-title bright">my-app/</text>
    <path d="M847 243v143M847 259h23M847 293h23M847 327h23M847 361h23" fill="none" stroke="#666"/>
    <rect x="870" y="243" width="246" height="33" fill="#0a0a0a" stroke="#444"/><text x="886" y="264" class="code">src/app</text><text x="1098" y="264" class="micro" text-anchor="end">ROUTES</text>
    <rect x="870" y="277" width="246" height="33" fill="#f0f0f0"/><text x="886" y="298" class="code ink">src/app/page.tsx</text>
    <rect x="870" y="311" width="246" height="33" fill="#0a0a0a" stroke="#444"/><text x="886" y="332" class="code">src/app/api/users/route.ts</text><text x="1098" y="332" class="micro" text-anchor="end">API</text>
    <rect x="870" y="345" width="246" height="33" fill="#0a0a0a" stroke="#444"/><text x="886" y="366" class="code">farm.config.ts</text><text x="1098" y="366" class="micro" text-anchor="end">CONFIG</text>
    <line x1="819" y1="450" x2="1134" y2="450" stroke="#343434"/>
    <text x="819" y="475" class="label bright">FILES BECOME FEATURES</text><text x="1134" y="475" class="label" text-anchor="end">ONE CONFIG</text>`;
}

function renderRuntimeIllustration(): string {
  return `${renderPanelHeader("PRODUCT ARCHITECTURE", "FULL STACK")}
    <rect x="819" y="211" width="315" height="55" fill="#f0f0f0"/>
    <text x="836" y="244" class="diagram-title ink">PRODUCT SURFACE</text><text x="1116" y="244" class="micro ink-muted" text-anchor="end">UI + ROUTES</text>
    <path d="M976 266v20m0 61v20" stroke="#727272"/>
    <rect x="855" y="286" width="242" height="61" fill="#a3a3a3"/>
    <text x="874" y="314" class="diagram-title ink">APPLICATION CORE</text><text x="874" y="334" class="micro ink-muted">APIS · MIDDLEWARE</text>
    <rect x="819" y="367" width="315" height="55" fill="#4c4c4c"/>
    <text x="836" y="400" class="diagram-title bright">CONNECTED STACK</text><text x="1116" y="400" class="micro" text-anchor="end">DATA · AUTH · DEPLOY</text>
    <line x1="819" y1="450" x2="1134" y2="450" stroke="#343434"/>
    <text x="819" y="475" class="label bright">ONE FRAMEWORK</text><text x="1134" y="475" class="label" text-anchor="end">ONE DEPLOYMENT MODEL</text>`;
}

function renderIllustration(type: FarmDocsSocialImageIllustration): string {
  switch (type) {
    case "auth":
      return renderAuthIllustration();
    case "cache":
      return renderCacheIllustration();
    case "cli":
      return renderCliIllustration();
    case "integrations":
      return renderIntegrationsIllustration();
    case "project":
      return renderProjectIllustration();
    case "routing":
      return renderRoutingIllustration();
    default:
      return renderRuntimeIllustration();
  }
}

export function renderFarmDocsSocialImageSvg(descriptor: FarmDocsSocialImageDescriptor): string {
  const titleLines = wrapText(descriptor.title, 22, 2);
  const longestTitleLine = Math.max(...titleLines.map((line) => line.length));
  const titleSize = titleLines.length === 1 ? (longestTitleLine > 17 ? 62 : 74) : 56;
  const titleLineHeight = Math.round(titleSize * 0.98);
  const titleY = titleLines.length === 1 ? 294 : 266;
  const descriptionY = titleY + (titleLines.length - 1) * titleLineHeight + 59;
  const descriptionLines = wrapText(descriptor.description, 68, 2);
  const routeY = Math.max(418, descriptionY + descriptionLines.length * 29 + 24);
  const section = truncate(descriptor.section.toUpperCase(), 27);
  const route = truncate(descriptor.pageHref, 42);
  const footerUrl = truncate(descriptor.pageUrl.replace(/^https?:\/\//, ""), 70);
  const brand = truncate(descriptor.brand.toUpperCase(), 25);
  const titleId = `farm-docs-og-${descriptor.hash}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${FARM_DOCS_SOCIAL_IMAGE_WIDTH}" height="${FARM_DOCS_SOCIAL_IMAGE_HEIGHT}" viewBox="0 0 ${FARM_DOCS_SOCIAL_IMAGE_WIDTH} ${FARM_DOCS_SOCIAL_IMAGE_HEIGHT}" role="img" aria-labelledby="${titleId}-title ${titleId}-description">
  <title id="${titleId}-title">${escapeXml(descriptor.imageAlt)}</title>
  <desc id="${titleId}-description">${escapeXml(descriptor.description)}</desc>
  <metadata>${escapeXml(JSON.stringify({ generator: "Farm.js docs", page: descriptor.pageUrl, illustration: descriptor.illustration }))}</metadata>
  <style type="text/css">
    ${renderEmbeddedFont("Farm Sans", descriptor.fonts?.sans, "100 900")}
    ${renderEmbeddedFont("Farm Mono", descriptor.fonts?.mono, "100 900")}
    ${renderEmbeddedFont("Farm Pixel", descriptor.fonts?.display, "400 700")}
    .sans{font-family:"Farm Sans","Arial",sans-serif}.mono,.label,.code,.diagram-title,.micro{font-family:"Farm Mono","Menlo","DejaVu Sans Mono",monospace}.pixel{font-family:"Farm Pixel","Farm Mono",monospace}.label{fill:#8b8b8b;font-size:10px;font-weight:600;letter-spacing:1.2px}.code{fill:#8b8b8b;font-size:11px}.diagram-title{fill:#e7e7e7;font-size:11px;font-weight:650}.micro{fill:#777;font-size:8px;letter-spacing:.45px}.bright{fill:#f5f5f4}.ink{fill:#050505}.ink-muted{fill:#4c4c4c}
  </style>
  <defs>
    <pattern id="canvas-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#151515"/></pattern>
    <pattern id="diagonal" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="12" stroke="#171717" stroke-width="2"/></pattern>
    <clipPath id="frame-clip"><rect x="28" y="28" width="1144" height="574"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="#050505"/>
  <rect width="1200" height="630" fill="url(#canvas-grid)"/>
  <g clip-path="url(#frame-clip)">
    <rect x="28" y="28" width="1144" height="574" fill="#020202"/>
    <rect x="782" y="114" width="390" height="411" fill="url(#diagonal)"/>
  </g>
  <rect x="28.5" y="28.5" width="1143" height="573" fill="none" stroke="#323232"/>
  <path d="M28 114.5h1144M28 525.5h1144M781.5 114v411" fill="none" stroke="#303030"/>

  <g transform="translate(71 51)">
    <rect width="11" height="11" rx="1" fill="#f5f5f4"/><rect x="15" width="28" height="11" rx="1" fill="#f5f5f4"/>
    <rect y="15" width="11" height="11" rx="1" fill="#9b9b9b"/><rect x="15" y="15" width="28" height="11" rx="1" fill="#9b9b9b"/>
    <rect y="30" width="11" height="11" rx="1" fill="#5f5f5f"/><rect x="15" y="30" width="20" height="11" rx="1" fill="#5f5f5f"/>
    <text x="61" y="24" class="mono bright" font-size="24" font-weight="550">FARM<tspan fill="#777">.JS</tspan></text>
    <text x="61" y="43" class="label">BY FARMING LABS</text>
  </g>
  <text x="1134" y="72" class="label" text-anchor="end">${escapeXml(brand)} · DOCUMENTATION</text>

  <text x="71" y="198" class="mono bright" font-size="13" font-weight="650">DOCS</text>
  <line x1="117" y1="193" x2="155" y2="193" stroke="#696969"/>
  <text x="166" y="198" class="mono" fill="#9b9b9b" font-size="13">${escapeXml(section)}</text>
  ${renderTextLines(titleLines, 71, titleY, titleLineHeight, `class="pixel bright" font-size="${titleSize}" font-weight="500" letter-spacing="-2.4"`)}
  ${renderTextLines(descriptionLines, 71, descriptionY, 29, 'class="sans" fill="#a3a3a3" font-size="20" font-weight="430" letter-spacing="-.3"')}
  <rect x="71" y="${routeY}" width="${Math.min(390, 56 + route.length * 8)}" height="36" fill="#050505" stroke="#3c3c3c"/>
  <text x="85" y="${routeY + 23}" class="mono bright" font-size="11" font-weight="600">GET</text>
  <text x="119" y="${routeY + 23}" class="mono" fill="#898989" font-size="11">${escapeXml(route)}</text>

  ${renderIllustration(descriptor.illustration)}

  <text x="71" y="570" class="mono bright" font-size="13" font-weight="550">${escapeXml(footerUrl)}</text>
  <text x="1134" y="570" class="mono" fill="#9b9b9b" font-size="12" text-anchor="end">FARM.JS DOCUMENTATION</text>
  <path d="M20 20h10M20 20v10M1180 20h-10M1180 20v10M20 610h10M20 610v-10M1180 610h-10M1180 610v-10" fill="none" stroke="#9b9b9b"/>
</svg>`;
}

export function renderFarmDocsSocialMetadata(
  descriptor: FarmDocsSocialImageDescriptor,
  customImage?: string,
): string {
  const imageUrl = customImage
    ? new URL(customImage, descriptor.pageUrl).href
    : descriptor.imageUrl;
  const customExtension = customImage?.toLowerCase().split(/[?#]/, 1)[0];
  const imageType = customExtension?.endsWith(".webp")
    ? "image/webp"
    : customExtension?.endsWith(".png")
      ? "image/png"
      : customExtension?.match(/\.jpe?g$/)
        ? "image/jpeg"
        : "image/svg+xml";
  const tag = (property: string, content: string, name = false) =>
    `<meta ${name ? "name" : "property"}="${property}" content="${escapeXml(content)}">`;

  return [
    tag("og:type", "article"),
    tag("og:site_name", descriptor.siteName),
    tag("og:title", descriptor.title),
    tag("og:description", descriptor.description),
    tag("og:url", descriptor.pageUrl),
    tag("og:image", imageUrl),
    tag("og:image:type", imageType),
    ...(customImage
      ? []
      : [
          tag("og:image:width", String(FARM_DOCS_SOCIAL_IMAGE_WIDTH)),
          tag("og:image:height", String(FARM_DOCS_SOCIAL_IMAGE_HEIGHT)),
        ]),
    tag("og:image:alt", descriptor.imageAlt),
    tag("twitter:card", "summary_large_image", true),
    tag("twitter:title", descriptor.title, true),
    tag("twitter:description", descriptor.description, true),
    tag("twitter:image", imageUrl, true),
    tag("twitter:image:alt", descriptor.imageAlt, true),
  ].join("\n  ");
}
