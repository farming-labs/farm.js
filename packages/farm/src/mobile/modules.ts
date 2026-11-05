import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import * as path from "node:path";
import { isPlainObject, readAppPackageJson } from "../platform-blocks";

/**
 * Native modules (RFC 0004, 7.5): the app's own TurboModules in `src/native/`, and
 * `mobile.modules`, the OS permission entries and usage strings per module.
 */

/** What the OS needs for one module: `mobile.modules.<name>`. */
export interface FarmMobileModuleConfig {
  /**
   * Android permissions the generated `AndroidManifest.xml` declares, such as
   * `"android.permission.VIBRATE"`. Community modules already merge their own manifest's
   * permissions, so this is for extra ones.
   */
  permissions?: string[];
  /**
   * iOS usage strings the generated `Info.plist` gets, keyed by usage-description key, such as
   * `{ NSCameraUsageDescription: "Scans receipts." }`.
   */
  usage?: Record<string, string>;
}

export interface ResolvedFarmMobileModuleConfig {
  permissions: string[];
  usage: Record<string, string>;
}

/** One Codegen spec in `src/native/`, such as `NativeDevice.ts`. */
export interface FarmMobileAppModuleSpec {
  /** The name the spec registers: `TurboModuleRegistry.getEnforcing<Spec>("Device")`. */
  name: string;
  /** Absolute path of the spec file. */
  file: string;
}

/** The app's own native modules: the files in `src/native/` the generated projects copy. */
export interface FarmMobileAppModules {
  /** Absolute path of `src/native/`. */
  dir: string;
  specs: FarmMobileAppModuleSpec[];
  /** Absolute paths of the Kotlin files (`*.kt`), linked into the Android app. */
  android: string[];
  /** Absolute paths of the Swift files (`*.swift`), copied but not built: iOS has no host yet. */
  ios: string[];
}

const MODULE_KEYS = new Set(["permissions", "usage"]);
/** A fully qualified Android permission, such as `android.permission.VIBRATE`. */
const PERMISSION = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/;
const BARE_PERMISSION = /^[A-Z][A-Z0-9_]*$/;
const USAGE_KEY = /^NS[A-Za-z0-9]+UsageDescription$/;
const SPEC_FILE = /^Native[A-Za-z0-9_]+\.(?:ts|js)$/;
const SPEC_NAME =
  /TurboModuleRegistry\s*\.\s*(?:getEnforcing|get)\s*(?:<[^>]*>)?\s*\(\s*(["'`])([A-Za-z_$][\w$]*)\1/;

function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

/**
 * The app's own TurboModules: Codegen specs (`Native*.ts`), Kotlin, and Swift files directly in
 * `<srcDir>/native/`. Undefined when the folder has none of them. A spec whose registered name
 * cannot be read throws, naming the file.
 */
export function scanFarmMobileAppModules(options: {
  root: string;
  srcDir?: string;
}): FarmMobileAppModules | undefined {
  const dir = path.resolve(options.root, options.srcDir ?? "src", "native");
  if (!existsSync(dir)) return undefined;
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const specs: FarmMobileAppModuleSpec[] = [];
  const names = new Map<string, string>();
  for (const name of entries.filter((entry) => SPEC_FILE.test(entry))) {
    const file = path.join(dir, name);
    const match = SPEC_NAME.exec(readFileSync(file, "utf8"));
    const shown = relative(options.root, file);
    if (!match) {
      throw new TypeError(
        `${shown} is a native module spec (Native*.ts) without a registered name. Export ` +
          `TurboModuleRegistry.getEnforcing<Spec>("${name.replace(/^Native|\.\w+$/g, "")}") ` +
          "as its default, as in a React Native app.",
      );
    }
    const other = names.get(match[2]!);
    if (other) {
      throw new TypeError(
        `${shown} and ${other} both register the native module "${match[2]}". Give each ` +
          "spec its own name.",
      );
    }
    names.set(match[2]!, shown);
    specs.push({ name: match[2]!, file });
  }
  const android = entries
    .filter((entry) => entry.endsWith(".kt"))
    .map((entry) => path.join(dir, entry));
  const ios = entries
    .filter((entry) => entry.endsWith(".swift"))
    .map((entry) => path.join(dir, entry));
  if (specs.length === 0 && android.length === 0 && ios.length === 0) return undefined;
  return { dir, specs, android, ios };
}

/** The installed package directory, as Node resolves it from `from`. */
function findPackage(name: string, from: string): string | undefined {
  let dir = from;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return realpathSync(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Why `name` is not a React Native module the app installed, or undefined when it is one. */
function installedModuleProblem(
  name: string,
  root: string,
  dependencies: Record<string, unknown>,
): string | undefined {
  if (!(name in dependencies)) return "unknown";
  const dir = findPackage(name, root);
  if (!dir) return "missing";
  try {
    const pkg: unknown = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    return isPlainObject(pkg) && isPlainObject(pkg.codegenConfig) ? undefined : "not-a-module";
  } catch {
    return "not-a-module";
  }
}

/**
 * Check `mobile.modules` and fill in its defaults. Every problem is collected, and one error lists
 * them all, each with its key and the fix. A module name must be one of the app's own modules
 * (`appModules`) or a React Native module in the app's `dependencies`.
 */
export function resolveFarmMobileModules(
  input: unknown,
  options: { root: string; srcDir?: string; appModules?: readonly string[] },
  fail: (message: string) => never,
): Record<string, ResolvedFarmMobileModuleConfig> {
  if (input === undefined) return {};
  if (!isPlainObject(input)) {
    fail(
      "modules must be an object keyed by module name, such as " +
        '{ Device: { permissions: ["android.permission.VIBRATE"] } }.',
    );
  }
  const issues: string[] = [];
  const resolved: Record<string, ResolvedFarmMobileModuleConfig> = {};
  const appModules = new Set(options.appModules ?? []);
  // Info.plist has one string per key, so two modules must agree on it.
  const usageOwners = new Map<string, { name: string; value: string }>();
  let dependencies: Record<string, unknown> | undefined;
  const specDir = relative(
    options.root,
    path.resolve(options.root, options.srcDir ?? "src", "native"),
  );

  for (const name of Object.keys(input).sort()) {
    const where = `modules[${JSON.stringify(name)}]`;
    const entry = input[name];
    if (!appModules.has(name)) {
      dependencies ??= ((value) => (isPlainObject(value) ? value : {}))(
        readAppPackageJson(options.root).dependencies,
      );
      const problem = installedModuleProblem(name, options.root, dependencies);
      if (problem === "unknown") {
        issues.push(
          `${where} is not one of the app's native modules or an installed React Native module. ` +
            `Use the name a ${specDir}/Native*.ts spec registers, or a package in dependencies ` +
            "in package.json.",
        );
      } else if (problem === "missing") {
        issues.push(
          `${where} is in dependencies but not installed. Install the app's dependencies, then ` +
            "run the command again.",
        );
      } else if (problem === "not-a-module") {
        issues.push(
          `${where} names a package with no "codegenConfig" in its package.json, so it is not a ` +
            "React Native module for the new architecture. Remove the entry, or upgrade the package.",
        );
      }
    }
    if (!isPlainObject(entry)) {
      issues.push(
        `${where} must be an object, such as { permissions: ["android.permission.VIBRATE"] }.`,
      );
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!MODULE_KEYS.has(key)) {
        issues.push(`unknown option ${where}.${key}. Supported: permissions, usage.`);
      }
    }
    const permissions: string[] = [];
    if (entry.permissions !== undefined) {
      if (!Array.isArray(entry.permissions)) {
        issues.push(
          `${where}.permissions must be an array of Android permissions, such as ` +
            '["android.permission.VIBRATE"].',
        );
      } else {
        entry.permissions.forEach((permission: unknown, index: number) => {
          const at = `${where}.permissions[${index}]`;
          if (typeof permission !== "string" || !PERMISSION.test(permission)) {
            const hint =
              typeof permission === "string" && BARE_PERMISSION.test(permission)
                ? ` Use "android.permission.${permission}".`
                : "";
            issues.push(
              `${at} must be a full Android permission name such as ` +
                `"android.permission.VIBRATE", got ${JSON.stringify(permission)}.${hint}`,
            );
          } else if (!permissions.includes(permission)) {
            permissions.push(permission);
          }
        });
      }
    }
    const usage: Record<string, string> = {};
    if (entry.usage !== undefined) {
      if (!isPlainObject(entry.usage)) {
        issues.push(
          `${where}.usage must be an object of iOS usage strings, such as ` +
            '{ NSCameraUsageDescription: "Scans receipts." }.',
        );
      } else {
        for (const [key, value] of Object.entries(entry.usage)) {
          const at = `${where}.usage.${key}`;
          if (!USAGE_KEY.test(key)) {
            issues.push(
              `${at} is not an iOS usage-description key. Keys are NS...UsageDescription, such as ` +
                "NSCameraUsageDescription.",
            );
          } else if (typeof value !== "string" || !value.trim()) {
            issues.push(
              `${at} must be a non-empty string: the sentence iOS shows when it asks for access.`,
            );
          } else {
            const owner = usageOwners.get(key);
            if (owner && owner.value !== value.trim()) {
              issues.push(
                `${at} and modules[${JSON.stringify(owner.name)}].usage.${key} set different ` +
                  "strings, and Info.plist has one per key. Set it on one module.",
              );
            }
            usageOwners.set(key, { name, value: value.trim() });
            usage[key] = value.trim();
          }
        }
      }
    }
    resolved[name] = { permissions, usage };
  }
  if (issues.length === 1) fail(issues[0]!);
  if (issues.length > 1) {
    fail(
      `modules has ${issues.length} problems:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`,
    );
  }
  return resolved;
}
