export type FarmFontDisplay = "auto" | "block" | "swap" | "fallback" | "optional";

export interface FarmFontSource {
  /** Local file path or remote URL, depending on the loader. */
  path: string;
  /** A fixed weight (`400`) or variable range (`100 900`). */
  weight?: number | string;
  /** Font style for this source. */
  style?: string;
  /** Optional CSS unicode-range descriptor. */
  unicodeRange?: string;
}

export interface FarmFontOptions {
  /** CSS font-family name. */
  family: string;
  /** A fixed weight (`400`) or variable range (`100 900`). */
  weight?: number | string;
  /** Font style. @default "normal" */
  style?: string;
  /** Browser loading behavior. @default "swap" */
  display?: FarmFontDisplay;
  /** CSS custom property populated by `variable`, for example `--font-sans`. */
  variable?: `--${string}`;
  /** Fallback family names appended to the generated stack. */
  fallback?: string[];
  /** Emit font preload hints. @default true */
  preload?: boolean;
}

export interface LocalFontOptions extends FarmFontOptions {
  /**
   * A file relative to this module, a package font specifier, or explicit
   * sources for a multi-weight family.
   */
  src: string | FarmFontSource[];
}

export interface RemoteFontSource extends FarmFontSource {
  /** Optional integrity value for this source. Overrides the family-level value. */
  integrity?: string;
}

export interface RemoteFontOptions extends FarmFontOptions {
  /** HTTPS font URL, or explicit remote sources for a multi-weight family. */
  src: string | RemoteFontSource[];
  /** Download and fingerprint the font during the build, or retain its URL. */
  strategy?: "self-host" | "external";
  /** Optional Subresource Integrity value checked while self-hosting. */
  integrity?: string;
}

export interface FarmFont {
  /** Generated class that applies the font family and fallback stack. */
  className: string;
  /** Generated class that defines the configured CSS custom property. */
  variable: string;
  /** Inline-style equivalent of the generated family. */
  style: Readonly<{
    fontFamily: string;
    fontStyle?: string;
    fontWeight?: number | string;
  }>;
  /** Compiled resources that should be preloaded when this font is selected. */
  preloads: readonly Readonly<{
    href: string;
    type: string;
  }>[];
}

/** Semantic font roles inherited by framework-owned surfaces such as Farm Docs. */
export interface FarmLayoutFonts {
  /** Default text and prose font. */
  body?: FarmFont;
  /** Code, keyboard input, and other technical UI font. */
  code?: FarmFont;
}

export interface FarmLayoutFontModule {
  fonts?: FarmLayoutFonts;
  /**
   * @internal The roles the font compiler infers from the font classes a layout applies, when the
   * layout has no `fonts` export.
   */
  __farmLayoutFonts?: FarmLayoutFonts;
}

/**
 * Define the semantic fonts exported by a layout.
 *
 * Layouts are resolved from the root toward the requested route. A nearer
 * layout overrides only the roles it defines, so it can replace `body` while
 * continuing to inherit `code` from a parent layout.
 */
export function defineLayoutFonts<const T extends FarmLayoutFonts>(fonts: T): T {
  return fonts;
}

/** Resolve semantic font roles from root layout to nearest layout. */
export function resolveFarmLayoutFonts(
  layouts: readonly FarmLayoutFontModule[],
): FarmLayoutFonts | undefined {
  let resolved: FarmLayoutFonts | undefined;

  for (const layout of layouts) {
    const fonts = layout.fonts ?? layout.__farmLayoutFonts;
    if (!fonts) continue;
    resolved = { ...resolved, ...fonts };
  }

  return resolved;
}

/**
 * @internal Infers a layout's font roles from the fonts it applies, in source order. `body` is the
 * first font whose `className` the layout applies, or else its first font that is not monospace.
 * `code` is the first other font whose stack ends in `monospace`. The font compiler calls this for
 * a layout without a `fonts` export.
 */
export function inferFarmLayoutFonts(
  uses: readonly (readonly [value: unknown, property: string])[],
): FarmLayoutFonts | undefined {
  const fonts = uses.filter((use): use is readonly [FarmFont, string] => isFarmFont(use[0]));
  const body =
    fonts.find(([, property]) => property === "className")?.[0] ??
    fonts.find(([font]) => !isMonospaceFont(font))?.[0];
  const code =
    fonts.find(([font]) => font !== body && isMonospaceFont(font))?.[0] ??
    (body && isMonospaceFont(body) ? body : undefined);
  if (!body && !code) return undefined;
  return { ...(body ? { body } : {}), ...(code ? { code } : {}) };
}

function isFarmFont(value: unknown): value is FarmFont {
  if (!value || typeof value !== "object") return false;
  const font = value as Partial<FarmFont>;
  return (
    typeof font.className === "string" &&
    typeof font.variable === "string" &&
    typeof font.style?.fontFamily === "string" &&
    Array.isArray(font.preloads)
  );
}

function isMonospaceFont(font: FarmFont): boolean {
  return /(?:^|,)\s*monospace\s*$/i.test(font.style.fontFamily);
}

function fontCompilerError(loader: string): never {
  throw new Error(
    `[Farm fonts] ${loader}() must be called at module scope with static options and compiled by the Farm Vite plugin.`,
  );
}

/**
 * Compile local font files into hashed application assets and generated CSS.
 * The call is removed at build time and adds no font-loader runtime code.
 */
export function localFont(_options: LocalFontOptions): FarmFont {
  return fontCompilerError("localFont");
}

/**
 * Compile a remote font into a self-hosted application asset by default.
 * Use `strategy: "external"` only when the browser should retain the remote URL.
 */
export function remoteFont(_options: RemoteFontOptions): FarmFont {
  return fontCompilerError("remoteFont");
}
