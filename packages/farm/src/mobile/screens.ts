/**
 * Which screen each route shows on mobile, and why. Loaded only by mobile commands.
 *
 * Per route and OS, the first source that decides wins (RFC 0004, 7.3):
 * 1. the page export, `export const mobile = { native: false }` in `page.tsx` (`"page"`);
 * 2. the config route, `mobile.native.routes[route]`: the OS key, then `screen` (`"config"`);
 * 3. the files next to `page.tsx`: `page.<os>.tsx`, then `page.native.tsx`, or `page.kt` /
 *    `page.swift` (`"file"`);
 * 4. the analyzer, with `mobile.native.auto: "on"` (`"analyzer"`);
 * 5. web (`"default"`).
 *
 * No native engine or analyzer emitter ships yet, so a route that asks for a port with no file
 * to show (config `screen: "native"` without `page.native.tsx`, or an analyzer port) stays web
 * and records the tier it asked for in `requested`.
 */
import * as path from "node:path";

import type { PlatformRouteFiles } from "../routing/generate-route-types";
import {
  validateFarmMobilePageConfig,
  type FarmMobileOS,
  type FarmMobilePageConfig,
  type FarmMobilePrefetch,
  type FarmMobilePresentation,
  type FarmMobileScreen,
  type ResolvedFarmMobileConfig,
} from "./config";

export type FarmMobileScreenSource = "page" | "config" | "file" | "analyzer" | "default";

export interface FarmMobileScreenDecision {
  screen: FarmMobileScreen;
  source: FarmMobileScreenSource;
  /** App-root-relative file that decided (`"page"`), or the screen's file. */
  file?: string;
  /** Native module id, derived from the route, such as `"app/notes/[id]"`. Not on web screens. */
  module?: string;
  /** The tier a config route or the analyzer asked for, while nothing can build it yet. */
  requested?: Exclude<FarmMobileScreen, "web">;
  presentation: FarmMobilePresentation;
  prefetch: FarmMobilePrefetch;
}

/** A page's static `export const mobile` and the file it came from. */
export interface FarmMobilePageExport {
  file: string;
  config: FarmMobilePageConfig;
}

export interface FarmMobileScreensOptions {
  root: string;
  os: FarmMobileOS;
  /** Page route patterns with route groups removed. */
  routes: readonly string[];
  mobile: Pick<ResolvedFarmMobileConfig, "routes" | "native">;
  /** Absolute screen files per route. */
  nativePages?: ReadonlyMap<string, PlatformRouteFiles>;
  pageExports?: ReadonlyMap<string, FarmMobilePageExport>;
  /** Routes the analyzer would port; used only with `native.auto: "on"`. */
  analyzerPorts?: ReadonlySet<string>;
  /** Why the analyzer cannot port a route, for config routes that ask for a port. */
  analyzerBlockers?: ReadonlyMap<string, readonly string[]>;
}

export interface FarmMobileScreens {
  screens: Record<string, FarmMobileScreenDecision>;
  /** Overridden settings, unused files, and ports nothing can build yet. */
  warnings: string[];
}

/**
 * The id a native screen registers under: the route under `app/`, route groups removed, such as
 * `"app"` for `/` and `"app/notes/[id]"` for `/notes/[id]`. Never hand-written, so the shell,
 * the native bundle, and the manifest cannot disagree.
 */
export function createFarmMobileModuleId(route: string): string {
  return route === "/" ? "app" : `app${route}`;
}

function relativeFile(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

export function resolveFarmMobileScreens(options: FarmMobileScreensOptions): FarmMobileScreens {
  const { os, root } = options;
  const { native } = options.mobile;
  const prefix = `mobile (os: ${os})`;
  const nativeTier: FarmMobileScreen = native.engine === "platform" ? "platform" : "native";
  const platformFileName = os === "android" ? "page.kt" : "page.swift";
  const screens: Record<string, FarmMobileScreenDecision> = {};
  const warnings: string[] = [];

  for (const route of options.routes) {
    const where = `native.routes["${route}"]`;
    const routeConfig = native.routes[route];
    const tier = routeConfig ? (routeConfig[os] ?? routeConfig.screen) : undefined;
    const tierKey = routeConfig?.[os] !== undefined ? os : "screen";
    const page = options.pageExports?.get(route);
    const files = options.nativePages?.get(route) ?? {};
    const reactFile = files[os] ?? files.native;
    const platformFile = os === "android" ? files.kt : files.swift;
    const module = createFarmMobileModuleId(route);

    if (native.engine === "platform") {
      const reactNative = files.native ?? files.ios ?? files.android;
      if (reactNative) {
        throw new TypeError(
          `${prefix}: ${relativeFile(root, reactNative)} is a React Native screen, but ` +
            'native.engine is "platform" (no React Native). Remove the file or use ' +
            `${platformFileName}.`,
        );
      }
    }
    if (reactFile && platformFile) {
      throw new TypeError(
        `${prefix}: "${route}" has two screens on ${os}: ${relativeFile(root, reactFile)} and ` +
          `${relativeFile(root, platformFile)}. Keep one.`,
      );
    }

    const configPresentation =
      options.mobile.routes[route]?.presentation ?? routeConfig?.presentation;
    if (page?.config.presentation !== undefined && configPresentation !== undefined) {
      warnings.push(
        `${page.file}: mobile.presentation "${page.config.presentation}" overrides the config's ` +
          `"${configPresentation}" for "${route}".`,
      );
    }
    const base = {
      presentation: page?.config.presentation ?? configPresentation ?? "push",
      prefetch: page?.config.prefetch ?? native.prefetch,
    };

    if (page?.config.native === false) {
      if (tier !== undefined && tier !== "web") {
        warnings.push(
          `${page.file}: mobile.native false overrides ${where}.${tierKey} "${tier}"; the route ` +
            "stays web.",
        );
      }
      for (const unused of [reactFile, platformFile]) {
        if (unused) {
          warnings.push(
            `${relativeFile(root, unused)} is unused: ${page.file} sets mobile.native to false.`,
          );
        }
      }
      screens[route] = { screen: "web", source: "page", file: page.file, ...base };
      continue;
    }

    if (tier === "web") {
      screens[route] = { screen: "web", source: "config", ...base };
      continue;
    }
    if (tier === "platform" || (tier === "native" && nativeTier === "platform" && platformFile)) {
      if (!platformFile) {
        throw new TypeError(
          `${prefix}: ${where}.${tierKey} is "platform", which needs ${platformFileName} next to ` +
            "the route's page.tsx.",
        );
      }
      screens[route] = {
        screen: "platform",
        source: "config",
        file: relativeFile(root, platformFile),
        module,
        ...base,
      };
      continue;
    }
    if (tier === "native") {
      if (nativeTier === "native" && reactFile) {
        screens[route] = {
          screen: "native",
          source: "config",
          file: relativeFile(root, reactFile),
          module,
          ...base,
        };
        continue;
      }
      const blockers = options.analyzerBlockers?.get(route);
      warnings.push(
        `${where}.${tierKey} is "native", but "${route}" has no ` +
          `${nativeTier === "native" ? "page.native.tsx" : platformFileName} and Farm cannot ` +
          "port pages yet, so it stays web" +
          (blockers?.length ? `. The analyzer would keep it web: ${blockers.join("; ")}` : "") +
          ". This fails the build once native screens ship.",
      );
      screens[route] = { screen: "web", source: "config", requested: nativeTier, ...base };
      continue;
    }

    const file = reactFile ?? platformFile;
    if (file) {
      screens[route] = {
        screen: reactFile ? "native" : "platform",
        source: "file",
        file: relativeFile(root, file),
        module,
        ...base,
      };
      continue;
    }
    if (native.auto === "on" && options.analyzerPorts?.has(route)) {
      screens[route] = { screen: "web", source: "analyzer", requested: nativeTier, ...base };
      continue;
    }
    screens[route] = { screen: "web", source: "default", ...base };
  }
  return { screens, warnings };
}

type Node = { type: string; [key: string]: unknown };
type ParseProgram = (file: string, source: string) => { body: Node[] };

function unwrap(node: Node): Node {
  let current = node;
  while (
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "ParenthesizedExpression"
  ) {
    current = current.expression as Node;
  }
  return current;
}

function literalValue(node: Node, fail: (message: string) => never): unknown {
  const value = unwrap(node);
  if (value.type === "Literal") return value.value;
  if (value.type === "ObjectExpression") {
    const result: Record<string, unknown> = {};
    for (const property of value.properties as Node[]) {
      const key = property.key as Node | undefined;
      if (property.type !== "Property" || property.computed || !key) {
        fail("must be an object literal without spreads or computed keys");
      }
      const name = key.type === "Identifier" ? key.name : key.value;
      if (typeof name !== "string") fail("must use plain keys");
      result[name] = literalValue(property.value as Node, fail);
    }
    return result;
  }
  return fail('must use literal values, such as { presentation: "modal" }');
}

/**
 * A page's `export const mobile = { ... }`, read from its source without running it. Returns
 * undefined when the page has no such export. Only literal values are allowed.
 */
export function readFarmMobilePageExport(
  source: string,
  file: string,
  parse: ParseProgram,
  context?: { os: FarmMobileOS },
): FarmMobilePageConfig | undefined {
  if (!/\bmobile\b/.test(source)) return undefined;
  const prefix = context ? `mobile (os: ${context.os})` : "mobile";
  const fail = (message: string): never => {
    throw new TypeError(
      `${prefix}: ${file}: export const mobile ${message}. Farm reads it without running the page.`,
    );
  };
  for (const statement of parse(file, source).body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    for (const specifier of (statement.specifiers as Node[] | undefined) ?? []) {
      const exported = specifier.exported as Node;
      if ((exported.name ?? exported.value) === "mobile") {
        fail("must be declared in place, as export const mobile = { ... }");
      }
    }
    const declaration = statement.declaration as Node | null;
    if (!declaration) continue;
    if (declaration.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations as Node[]) {
        const id = declarator.id as Node;
        if (id.type !== "Identifier" || id.name !== "mobile") continue;
        if (declaration.kind !== "const") fail("must be a const");
        if (!declarator.init) fail("needs a value");
        const value = literalValue(declarator.init as Node, fail);
        return validateFarmMobilePageConfig(value, file, context);
      }
    } else if ((declaration.id as Node | null)?.name === "mobile") {
      fail('must be an object, such as export const mobile = { presentation: "modal" }');
    }
  }
  return undefined;
}
