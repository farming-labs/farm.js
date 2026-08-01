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
