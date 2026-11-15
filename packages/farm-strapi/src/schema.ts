import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

interface StrapiAttribute {
  type?: string;
  required?: boolean;
  private?: boolean;
  multiple?: boolean;
  repeatable?: boolean;
  relation?: string;
  target?: string;
  component?: string;
  components?: string[];
  enum?: string[];
}

interface StrapiSchema {
  kind?: string;
  collectionName?: string;
  info?: {
    singularName?: string;
    pluralName?: string;
    displayName?: string;
  };
  attributes?: Record<string, StrapiAttribute>;
}

interface LoadedSchema {
  file: string;
  uid: string;
  schema: StrapiSchema;
}

export interface GenerateStrapiTypesOptions {
  /** Directory containing the Strapi application's `src` directory. */
  strapiRoot: string;
  /** Declaration file to create. Relative paths are resolved from the current directory. */
  outFile: string;
  /** Verify the output without writing it. */
  check?: boolean;
}

export interface GenerateStrapiTypesResult {
  changed: boolean;
  contentTypes: number;
  components: number;
  outFile: string;
}

export class StrapiTypesStaleError extends Error {
  constructor(outFile: string) {
    super(`Generated Strapi types are stale or missing: ${outFile}`);
    this.name = "StrapiTypesStaleError";
  }
}

async function readJson(file: string): Promise<StrapiSchema> {
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    throw new Error(`Could not read Strapi schema ${file}`, { cause: error });
  }

  try {
    const value = JSON.parse(source) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("expected a JSON object");
    }
    return value as StrapiSchema;
  } catch (error) {
    throw new Error(`Could not parse Strapi schema ${file}`, { cause: error });
  }
}

async function filesNamed(root: string, name: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...(await filesNamed(entryPath, name)));
    else if (entry.isFile() && entry.name === name) files.push(entryPath);
  }
  return files;
}

async function componentFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...(await componentFiles(entryPath)));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(entryPath);
  }
  return files;
}

function contentTypeUid(file: string): string {
  const segments = file.split(path.sep);
  const contentTypesIndex = segments.lastIndexOf("content-types");
  const apiIndex = segments.lastIndexOf("api");
  if (apiIndex < 0 || contentTypesIndex <= apiIndex + 1 || !segments[contentTypesIndex + 1]) {
    throw new Error(`Unsupported Strapi content type path: ${file}`);
  }
  return `api::${segments[apiIndex + 1]}.${segments[contentTypesIndex + 1]}`;
}

function componentUid(root: string, file: string): string {
  return path
    .relative(root, file)
    .replace(/\.json$/i, "")
    .split(path.sep)
    .join(".");
}

function typeName(uid: string): string {
  const value = uid
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
  return `StrapiComponent${value || "Value"}`;
}

function property(name: string): string {
  return JSON.stringify(name);
}

function nullable(type: string, required: boolean | undefined): string {
  return required ? type : `${type} | null`;
}

function scalarType(attribute: StrapiAttribute): string | undefined {
  switch (attribute.type) {
    case "string":
    case "text":
    case "richtext":
    case "email":
    case "uid":
    case "date":
    case "time":
    case "datetime":
    case "timestamp":
      return "string";
    case "integer":
    case "float":
    case "decimal":
      return "number";
    case "biginteger":
      return "string";
    case "boolean":
      return "boolean";
    case "json":
      return "unknown";
    case "blocks":
      return "unknown[]";
    case "enumeration":
      return attribute.enum?.length
        ? attribute.enum.map((value) => JSON.stringify(value)).join(" | ")
        : "string";
    case "password":
    case "relation":
    case "media":
    case "component":
    case "dynamiczone":
      return undefined;
    default:
      return "unknown";
  }
}

function renderScalarFields(attributes: Record<string, StrapiAttribute>, indentation = 0): string {
  const indent = " ".repeat(indentation);
  const lines = Object.entries(attributes)
    .filter(([, attribute]) => !attribute.private && attribute.type !== "password")
    .map(([name, attribute]) => {
      const value = scalarType(attribute);
      return value
        ? `${indent}  ${property(name)}: ${nullable(value, attribute.required)};`
        : undefined;
    })
    .filter((line): line is string => !!line);
  return lines.length ? `{\n${lines.join("\n")}\n${indent}}` : "Record<never, never>";
}

function relationIsMany(relation: string | undefined): boolean {
  return (
    relation === "oneToMany" ||
    relation === "manyToMany" ||
    relation === "manyWay" ||
    relation === "morphToMany"
  );
}

function renderPopulateFields(
  attributes: Record<string, StrapiAttribute>,
  resourcesByUid: Map<string, string>,
  componentNames: Map<string, string>,
  indentation = 0,
): string {
  const indent = " ".repeat(indentation);
  const lines: string[] = [];
  for (const [name, attribute] of Object.entries(attributes)) {
    if (attribute.private) continue;
    let value: string | undefined;
    if (attribute.type === "relation") {
      const resource = attribute.target ? resourcesByUid.get(attribute.target) : undefined;
      value = resource
        ? `StrapiRelation<${JSON.stringify(resource)}, ${relationIsMany(attribute.relation)}>`
        : `StrapiUnknownPopulate<${relationIsMany(attribute.relation)}>`;
    } else if (attribute.type === "media") {
      value = `StrapiMedia<${attribute.multiple === true}>`;
    } else if (attribute.type === "component") {
      const componentName = attribute.component
        ? componentNames.get(attribute.component)
        : undefined;
      if (!componentName) {
        throw new Error(
          `Strapi component ${JSON.stringify(attribute.component)} referenced by ${JSON.stringify(name)} was not found`,
        );
      }
      value = `StrapiComponent<${componentName}, ${attribute.repeatable === true}>`;
    } else if (attribute.type === "dynamiczone") {
      const members = (attribute.components ?? []).map((uid) => {
        const componentName = componentNames.get(uid);
        if (!componentName) {
          throw new Error(`Strapi dynamic-zone component ${JSON.stringify(uid)} was not found`);
        }
        return `(${componentName} & { __component: ${JSON.stringify(uid)} })`;
      });
      value = `StrapiDynamicZone<${members.length ? members.join(" | ") : "never"}>`;
    }
    if (value) lines.push(`${indent}  ${property(name)}: ${value};`);
  }
  return lines.length ? `{\n${lines.join("\n")}\n${indent}}` : "Record<never, never>";
}

function renderOutput(contentTypes: LoadedSchema[], components: LoadedSchema[]): string {
  const componentNames = new Map<string, string>();
  const usedNames = new Map<string, string>();
  for (const component of components) {
    const name = typeName(component.uid);
    const previous = usedNames.get(name);
    if (previous) {
      throw new Error(
        `Strapi components ${JSON.stringify(previous)} and ${JSON.stringify(component.uid)} generate the same type name ${name}`,
      );
    }
    usedNames.set(name, component.uid);
    componentNames.set(component.uid, name);
  }

  const resourcesByUid = new Map<string, string>();
  const usedResources = new Map<string, string>();
  for (const contentType of contentTypes) {
    if (contentType.schema.kind !== "collectionType") continue;
    const resource = contentType.schema.info?.pluralName;
    if (!resource) {
      throw new Error(`Strapi collection schema ${contentType.file} has no info.pluralName`);
    }
    const previous = usedResources.get(resource);
    if (previous) {
      throw new Error(
        `Strapi schemas ${JSON.stringify(previous)} and ${JSON.stringify(contentType.uid)} use the same plural name ${JSON.stringify(resource)}`,
      );
    }
    usedResources.set(resource, contentType.uid);
    resourcesByUid.set(contentType.uid, resource);
  }

  const imports = [
    "StrapiComponent",
    "StrapiContentTypeDefinition",
    "StrapiDynamicZone",
    "StrapiMedia",
    "StrapiRelation",
    "StrapiUnknownPopulate",
  ];
  const lines = [
    "// Generated by @farm.js/strapi. Do not edit by hand.",
    `import type { ${imports.join(", ")} } from "@farm.js/strapi";`,
    "",
  ];

  for (const component of components) {
    lines.push(
      `type ${componentNames.get(component.uid)} = { id: number } & ${renderScalarFields(component.schema.attributes ?? {})};`,
      "",
    );
  }

  lines.push("declare global {", "  namespace FarmJS {", "    interface StrapiContentTypes {");
  for (const contentType of contentTypes) {
    const resource = resourcesByUid.get(contentType.uid);
    if (!resource) continue;
    const attributes = contentType.schema.attributes ?? {};
    lines.push(
      `      ${property(resource)}: StrapiContentTypeDefinition<`,
      `        ${renderScalarFields(attributes, 8)},`,
      `        ${renderPopulateFields(attributes, resourcesByUid, componentNames, 8)}`,
      "      >;",
    );
  }
  lines.push("    }", "  }", "}", "", "export {};", "");
  return lines.join("\n");
}

export async function generateStrapiTypes(
  options: GenerateStrapiTypesOptions,
): Promise<GenerateStrapiTypesResult> {
  const strapiRoot = path.resolve(options.strapiRoot);
  const outFile = path.resolve(options.outFile);
  const sourceDirectory = path.join(strapiRoot, "src");
  try {
    if (!(await stat(sourceDirectory)).isDirectory()) throw new Error("not a directory");
  } catch (error) {
    throw new Error(`Strapi source directory was not found: ${sourceDirectory}`, { cause: error });
  }

  const contentRoot = path.join(sourceDirectory, "api");
  const componentRoot = path.join(sourceDirectory, "components");
  const contentFiles = (await filesNamed(contentRoot, "schema.json")).filter((file) =>
    file.split(path.sep).includes("content-types"),
  );
  if (contentFiles.length === 0) {
    throw new Error(`No Strapi content type schemas were found under ${contentRoot}`);
  }
  const componentsFiles = await componentFiles(componentRoot);
  const contentTypes = await Promise.all(
    contentFiles.map(async (file) => ({
      file,
      uid: contentTypeUid(file),
      schema: await readJson(file),
    })),
  );
  const components = await Promise.all(
    componentsFiles.map(async (file) => ({
      file,
      uid: componentUid(componentRoot, file),
      schema: await readJson(file),
    })),
  );
  const output = renderOutput(contentTypes, components);
  const current = await readFile(outFile, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  const changed = current !== output;
  if (options.check && changed) throw new StrapiTypesStaleError(outFile);
  if (!options.check && changed) {
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, output, "utf8");
  }
  return {
    changed,
    contentTypes: contentTypes.filter((contentType) => contentType.schema.kind === "collectionType")
      .length,
    components: components.length,
    outFile,
  };
}
