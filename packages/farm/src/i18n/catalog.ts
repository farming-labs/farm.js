import { readFile } from "node:fs/promises";
import { TYPE, parse, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { resolveFarmI18nMessagePath } from "./config";
import type { FarmI18nCatalog, FarmI18nCatalogs, ResolvedFarmI18nConfig } from "./types";

export type FarmI18nArgumentKind = "string" | "number" | "date" | "select" | "rich";
export type FarmI18nMessageSignature = Record<string, FarmI18nArgumentKind>;

export interface FarmI18nCatalogBundle {
  catalogs: FarmI18nCatalogs;
  signatures: Record<string, FarmI18nMessageSignature>;
}

export async function readFarmI18nCatalogs(
  config: ResolvedFarmI18nConfig,
): Promise<FarmI18nCatalogBundle> {
  if (!config.enabled) {
    return { catalogs: {}, signatures: {} };
  }

  const catalogs: FarmI18nCatalogs = {};
  for (const locale of config.locales) {
    const filePath = resolveFarmI18nMessagePath(config, locale);
    let source: string;
    try {
      source = await readFile(filePath, "utf8");
    } catch (error) {
      throw new Error(
        `Unable to read Farm i18n catalog for "${locale}" at ${filePath}: ${messageOf(error)}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      throw new Error(`Invalid JSON in Farm i18n catalog ${filePath}: ${messageOf(error)}`);
    }
    catalogs[locale] = flattenFarmI18nCatalog(parsed, filePath);
  }

  const reference = catalogs[config.defaultLocale] || {};
  const signatures: Record<string, FarmI18nMessageSignature> = {};
  for (const [key, message] of Object.entries(reference)) {
    signatures[key] = analyzeFarmI18nMessage(message, `${config.defaultLocale}:${key}`);
  }

  validateFarmI18nCatalogs(config, catalogs, signatures);
  return { catalogs, signatures };
}

export function flattenFarmI18nCatalog(input: unknown, source = "i18n catalog"): FarmI18nCatalog {
  if (!isPlainObject(input)) {
    throw new Error(`${source} must contain a JSON object at its root.`);
  }

  const output: FarmI18nCatalog = {};
  const visit = (value: unknown, segments: string[]) => {
    if (typeof value === "string") {
      const key = segments.join(".");
      if (!key) throw new Error(`${source} contains an empty message key.`);
      if (key in output) throw new Error(`${source} contains duplicate message key "${key}".`);
      output[key] = value;
      return;
    }

    if (!isPlainObject(value)) {
      const key = segments.join(".") || "<root>";
      throw new Error(`${source} message "${key}" must be a string or nested object.`);
    }

    for (const [key, nested] of Object.entries(value)) {
      if (!key.trim()) throw new Error(`${source} contains an empty message key.`);
      visit(nested, [...segments, key]);
    }
  };

  visit(input, []);
  return output;
}

export function analyzeFarmI18nMessage(
  message: string,
  label = "message",
): FarmI18nMessageSignature {
  let ast: MessageFormatElement[];
  try {
    ast = parse(message, { captureLocation: false });
  } catch (error) {
    throw new Error(`Invalid ICU syntax in ${label}: ${messageOf(error)}`);
  }

  const signature: FarmI18nMessageSignature = {};
  collectArguments(ast, signature, label);
  return signature;
}

function validateFarmI18nCatalogs(
  config: ResolvedFarmI18nConfig,
  catalogs: FarmI18nCatalogs,
  signatures: Record<string, FarmI18nMessageSignature>,
): void {
  const referenceKeys = Object.keys(catalogs[config.defaultLocale] || {}).sort();

  for (const locale of config.locales) {
    const catalog = catalogs[locale] || {};
    const localeKeys = Object.keys(catalog).sort();
    const missing = referenceKeys.filter((key) => !(key in catalog));
    const extra = localeKeys.filter((key) => !(key in signatures));

    if (config.strict && (missing.length > 0 || extra.length > 0)) {
      const details = [
        missing.length ? `missing: ${missing.join(", ")}` : "",
        extra.length ? `extra: ${extra.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      throw new Error(
        `Farm i18n catalog "${locale}" does not match the default catalog (${details}).`,
      );
    }

    for (const [key, message] of Object.entries(catalog)) {
      const actual = analyzeFarmI18nMessage(message, `${locale}:${key}`);
      const expected = signatures[key];
      if (!expected || sameSignature(expected, actual)) continue;
      throw new Error(
        `Farm i18n message "${key}" in "${locale}" uses different variables than "${config.defaultLocale}".`,
      );
    }
  }
}

function collectArguments(
  elements: MessageFormatElement[],
  signature: FarmI18nMessageSignature,
  label: string,
): void {
  for (const element of elements) {
    switch (element.type) {
      case TYPE.argument:
        addArgument(signature, element.value, "string", label);
        break;
      case TYPE.number:
      case TYPE.plural:
        addArgument(signature, element.value, "number", label);
        break;
      case TYPE.date:
      case TYPE.time:
        addArgument(signature, element.value, "date", label);
        break;
      case TYPE.select:
        addArgument(signature, element.value, "select", label);
        break;
      case TYPE.tag:
        addArgument(signature, element.value, "rich", label);
        collectArguments(element.children, signature, label);
        break;
    }

    if (element.type === TYPE.plural || element.type === TYPE.select) {
      for (const option of Object.values(element.options)) {
        collectArguments(option.value, signature, label);
      }
    }
  }
}

function addArgument(
  signature: FarmI18nMessageSignature,
  name: string,
  kind: FarmI18nArgumentKind,
  label: string,
): void {
  const existing = signature[name];
  if (existing && existing !== kind) {
    throw new Error(`Farm i18n ${label} uses variable "${name}" as both ${existing} and ${kind}.`);
  }
  signature[name] = kind;
}

function sameSignature(
  expected: FarmI18nMessageSignature,
  actual: FarmI18nMessageSignature,
): boolean {
  const expectedEntries = Object.entries(expected).sort(([a], [b]) => a.localeCompare(b));
  const actualEntries = Object.entries(actual).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(expectedEntries) === JSON.stringify(actualEntries);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
