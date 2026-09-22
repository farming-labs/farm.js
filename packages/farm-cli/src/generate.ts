import {
  collectSchemaModels,
  escapeSqlString,
  findSchemaTableOwners,
  generateFarmTypeArtifacts,
  getFarmDocsRouteTypeEntries,
  getIntegrationSchemas,
  isNullableField,
  loadConfig,
  logger,
  renderSqlSchemaFile,
  resolveConfig,
  toCamelCase,
  type CollectedSchemaModel,
  type FarmSchema,
  type ResolvedSchemaField,
} from "@farm.js/core";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Kept exported here: this is where it has always been part of the cli surface.
export { escapeSqlString } from "@farm.js/core";

export type GenerateFarmSchemaTarget =
  | "prisma"
  | "drizzle"
  | "postgres"
  | "mysql"
  | "sqlite"
  | "mongodb";

export type GenerateFarmSqlDialect = "postgres" | "mysql" | "sqlite";

export interface GenerateFarmOptions {
  root?: string;
  configPath?: string;
  orm?: GenerateFarmSchemaTarget;
  output?: string;
  dialect?: GenerateFarmSqlDialect;
  /** Verify committed type artifacts without writing files. */
  check?: boolean;
}

export class FarmGeneratedArtifactsStaleError extends Error {
  readonly stalePaths: string[];

  constructor(root: string, stalePaths: readonly string[]) {
    const normalizedPaths = [...new Set(stalePaths)].sort();
    const relativePaths = normalizedPaths.map((filePath) => path.relative(root, filePath));
    super(
      `Generated types are stale:\n${relativePaths.map((filePath) => `  - ${filePath}`).join("\n")}\nRun farm generate and commit the updated files.`,
    );
    this.name = "FarmGeneratedArtifactsStaleError";
    this.stalePaths = normalizedPaths;
  }
}

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

const PRISMA_GENERATED_START = "// Farm.js integrations generated schema: start";
const PRISMA_GENERATED_END = "// Farm.js integrations generated schema: end";

export async function generateFarmArtifacts(options: GenerateFarmOptions = {}) {
  const root = path.resolve(options.root || process.cwd());
  if (options.check && hasSchemaOptions(options)) {
    throw new Error(
      "--check verifies generated framework types and cannot be combined with schema output options.",
    );
  }
  const userConfig = await loadConfig(root, options.configPath, "development");

  if (!userConfig && hasSchemaOptions(options)) {
    throw new Error("No Farm config found. Please create farm.config.ts or config.ts.");
  }

  const resolvedConfig = await resolveConfig({ root, ...userConfig }, "development");
  const extraRoutes = [
    ...(resolvedConfig.openapi?.enabled && resolvedConfig.openapi.route
      ? [resolvedConfig.openapi.route]
      : []),
    ...getFarmDocsRouteTypeEntries(resolvedConfig.docs),
  ];
  const typeArtifacts = await generateFarmTypeArtifacts({
    root: resolvedConfig.root,
    srcDir: resolvedConfig.srcDir,
    configPath: options.configPath,
    layers: resolvedConfig.layers,
    plugins: resolvedConfig.plugins,
    extraRoutes,
    suppressLintOnLink: resolvedConfig.suppressLintOnLink,
    componentExtensions: resolvedConfig.renderer.componentExtensions,
    i18nConfig: resolvedConfig.i18n,
    check: options.check,
  });

  if (options.check) {
    if (typeArtifacts.stalePaths.length) {
      throw new FarmGeneratedArtifactsStaleError(root, typeArtifacts.stalePaths);
    }
    logger.success(
      `Generated route, API, env${resolvedConfig.i18n.enabled ? ", and i18n" : ""} types are up to date.`,
    );
    return typeArtifacts;
  }

  logger.success(
    `Generated route, API, env${resolvedConfig.i18n.enabled ? ", and i18n" : ""} types (${typeArtifacts.apiRoutes.length} API route${typeArtifacts.apiRoutes.length === 1 ? "" : "s"}).`,
  );

  // Integrations declare a schema directly; plugins declare one by owning
  // tables, so both feed the same artifacts.
  const schemas = getIntegrationSchemas(resolvedConfig.integrations);
  const schemaEntries: Array<readonly [string, FarmSchema, (readonly string[])?]> = Object.entries(
    schemas,
  ).map(([key, schema]) => [key, schema] as const);

  for (const owner of findSchemaTableOwners(resolvedConfig)) {
    if (schemas[owner.name]) continue; // already collected as an integration
    schemaEntries.push([owner.name, owner.schema, owner.models]);
  }

  if (!schemaEntries.length) {
    if (hasSchemaOptions(options)) {
      logger.warn("No schemas were found in the current Farm config.");
    }
    return typeArtifacts;
  }

  const packageManifest = await readPackageManifest(root);
  const schemaOptionsExplicit = hasSchemaOptions(options);
  let orm: GenerateFarmSchemaTarget | null = null;
  try {
    orm = options.orm ?? (await detectSchemaTarget(root, packageManifest));
  } catch (error) {
    if (schemaOptionsExplicit) {
      throw error;
    }
    logger.warn(
      `Schemas were found, but Farm could not choose a schema target automatically: ${(error as Error).message}`,
    );
    return typeArtifacts;
  }

  if (!orm) {
    if (!schemaOptionsExplicit) {
      logger.warn(
        "Schemas were found, but no data layer was detected. Pass --orm prisma|drizzle|postgres|mysql|sqlite|mongodb to generate schema artifacts.",
      );
      return typeArtifacts;
    }
    throw new Error(
      "Could not auto-detect a schema target. Pass one explicitly with --orm prisma|drizzle|postgres|mysql|sqlite|mongodb.",
    );
  }

  const collectedModels = collectSchemaModels(schemaEntries);

  switch (orm) {
    case "prisma": {
      const schemaPath = options.output
        ? path.resolve(root, options.output)
        : path.join(root, "prisma", "schema.prisma");

      if (!existsSync(schemaPath)) {
        throw new Error(
          `Prisma target was selected but no schema file was found at ${schemaPath}. Create prisma/schema.prisma or pass --output.`,
        );
      }

      await writePrismaSchema(schemaPath, collectedModels);
      logger.success(`Generated Prisma integration schema in ${path.relative(root, schemaPath)}.`);
      return typeArtifacts;
    }

    case "drizzle": {
      const dialect =
        options.dialect ?? (await detectDrizzleDialect(root, packageManifest)) ?? undefined;

      if (!dialect) {
        throw new Error(
          "Detected Drizzle but could not determine its dialect. Pass --dialect postgres|mysql|sqlite.",
        );
      }

      const outputPath = options.output
        ? path.resolve(root, options.output)
        : path.join(root, "farm-integrations.generated.ts");
      await writeGeneratedFile(outputPath, generateDrizzleSchema(collectedModels, dialect));
      logger.success(`Generated Drizzle integration schema in ${path.relative(root, outputPath)}.`);
      return typeArtifacts;
    }

    case "postgres":
    case "mysql":
    case "sqlite": {
      const outputPath = options.output
        ? path.resolve(root, options.output)
        : path.join(root, `farm-integrations.generated.${orm}.sql`);
      await writeGeneratedFile(outputPath, renderSqlSchemaFile(collectedModels, orm));
      logger.success(`Generated ${orm} integration schema in ${path.relative(root, outputPath)}.`);
      return typeArtifacts;
    }

    case "mongodb": {
      const outputPath = options.output
        ? path.resolve(root, options.output)
        : path.join(root, "farm-integrations.generated.mongodb.ts");
      await writeGeneratedFile(outputPath, generateMongoBootstrap(collectedModels));
      logger.success(
        `Generated MongoDB integration bootstrap in ${path.relative(root, outputPath)}.`,
      );
      return typeArtifacts;
    }
  }
}

function hasSchemaOptions(options: GenerateFarmOptions) {
  return Boolean(options.orm || options.output || options.dialect);
}

async function readPackageManifest(root: string): Promise<PackageManifest | null> {
  const packagePath = path.join(root, "package.json");
  if (!existsSync(packagePath)) {
    return null;
  }

  const source = await readFile(packagePath, "utf8");
  return JSON.parse(source) as PackageManifest;
}

async function detectSchemaTarget(
  root: string,
  packageManifest: PackageManifest | null,
): Promise<GenerateFarmSchemaTarget | null> {
  const hasPrismaSchema = existsSync(path.join(root, "prisma", "schema.prisma"));
  const drizzleConfigPath = findExistingPath(root, [
    "drizzle.config.ts",
    "drizzle.config.mts",
    "drizzle.config.js",
    "drizzle.config.mjs",
    "drizzle.config.cjs",
  ]);

  if (hasPrismaSchema && drizzleConfigPath) {
    throw new Error(
      "Detected both Prisma and Drizzle in this project. Pass --orm prisma or --orm drizzle to choose one.",
    );
  }

  if (hasPrismaSchema) {
    return "prisma";
  }

  if (drizzleConfigPath) {
    return "drizzle";
  }

  const dependencies = getPackageDependencyNames(packageManifest);
  const candidates = new Set<GenerateFarmSchemaTarget>();

  if (dependencies.has("@prisma/client") || dependencies.has("prisma")) {
    candidates.add("prisma");
  }

  if (dependencies.has("drizzle-orm") || dependencies.has("drizzle-kit")) {
    candidates.add("drizzle");
  }

  if (hasAnyDependency(dependencies, ["pg", "postgres", "@neondatabase/serverless"])) {
    candidates.add("postgres");
  }

  if (hasAnyDependency(dependencies, ["mysql2", "@planetscale/database"])) {
    candidates.add("mysql");
  }

  if (hasAnyDependency(dependencies, ["better-sqlite3", "sqlite3"])) {
    candidates.add("sqlite");
  }

  if (hasAnyDependency(dependencies, ["mongodb", "mongoose"])) {
    candidates.add("mongodb");
  }

  if (candidates.size === 1) {
    return Array.from(candidates)[0]!;
  }

  if (candidates.size > 1) {
    throw new Error(
      `Detected multiple possible schema targets (${Array.from(candidates).join(", ")}). Pass --orm to choose one.`,
    );
  }

  return null;
}

async function detectDrizzleDialect(
  root: string,
  packageManifest: PackageManifest | null,
): Promise<GenerateFarmSqlDialect | null> {
  const configPath = findExistingPath(root, [
    "drizzle.config.ts",
    "drizzle.config.mts",
    "drizzle.config.js",
    "drizzle.config.mjs",
    "drizzle.config.cjs",
  ]);

  if (configPath) {
    const source = await readFile(configPath, "utf8");
    const dialectMatch = source.match(
      /dialect\s*:\s*["'](postgresql|postgres|mysql|sqlite|turso)["']/,
    );
    if (dialectMatch) {
      const dialect = dialectMatch[1];
      if (dialect === "postgresql" || dialect === "postgres") {
        return "postgres";
      }
      if (dialect === "mysql") {
        return "mysql";
      }
      if (dialect === "sqlite" || dialect === "turso") {
        return "sqlite";
      }
    }
  }

  const dependencies = getPackageDependencyNames(packageManifest);
  const candidates = new Set<GenerateFarmSqlDialect>();

  if (hasAnyDependency(dependencies, ["pg", "postgres", "@neondatabase/serverless"])) {
    candidates.add("postgres");
  }

  if (hasAnyDependency(dependencies, ["mysql2", "@planetscale/database"])) {
    candidates.add("mysql");
  }

  if (hasAnyDependency(dependencies, ["better-sqlite3", "sqlite3"])) {
    candidates.add("sqlite");
  }

  return candidates.size === 1 ? Array.from(candidates)[0]! : null;
}

function findExistingPath(root: string, relativePaths: readonly string[]) {
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(root, relativePath);
    if (existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  return null;
}

function getPackageDependencyNames(packageManifest: PackageManifest | null) {
  return new Set([
    ...Object.keys(packageManifest?.dependencies || {}),
    ...Object.keys(packageManifest?.devDependencies || {}),
    ...Object.keys(packageManifest?.peerDependencies || {}),
    ...Object.keys(packageManifest?.optionalDependencies || {}),
  ]);
}

function hasAnyDependency(dependencies: Set<string>, candidates: readonly string[]) {
  return candidates.some((candidate) => dependencies.has(candidate));
}

async function writePrismaSchema(schemaPath: string, models: readonly CollectedSchemaModel[]) {
  const source = await readFile(schemaPath, "utf8");
  const generated = createPrismaGeneratedBlock(generatePrismaSchema(models));
  const pattern = new RegExp(
    `${escapeRegExp(PRISMA_GENERATED_START)}[\\s\\S]*?${escapeRegExp(PRISMA_GENERATED_END)}`,
    "m",
  );

  const nextSource = pattern.test(source)
    ? source.replace(pattern, generated)
    : `${source.trimEnd()}\n\n${generated}\n`;

  await writeFile(schemaPath, nextSource, "utf8");
}

function generatePrismaSchema(models: readonly CollectedSchemaModel[]) {
  const sections = models.map((model) => renderPrismaModel(model));
  return sections.join("\n\n");
}

function renderPrismaModel(model: CollectedSchemaModel) {
  const lines: string[] = [
    `/// Farm.js generated from "${model.ownerKey}" model "${model.modelKey}"`,
    `model ${model.prismaModelName} {`,
  ];

  const modelLevelConstraints: string[] = [];

  for (const [fieldKey, field] of Object.entries(model.model.fields)) {
    if (field.reference) {
      lines.push(
        `  /// References ${field.reference.model}.${field.reference.field}${field.reference.onDelete ? ` (onDelete: ${field.reference.onDelete})` : ""}`,
      );
    }

    const parts = [
      fieldKey,
      `${getPrismaFieldType(field)}${field.list ? "[]" : isNullableField(field) ? "?" : ""}`,
    ];
    const attributes: string[] = [];

    if (field.primaryKey) {
      attributes.push("@id");
      if (field.type === "id" && field.default === undefined) {
        attributes.push("@default(cuid())");
      }
      if (field.type === "uuid" && field.default === undefined) {
        attributes.push("@default(uuid())");
      }
    } else if (field.unique) {
      attributes.push("@unique");
    }

    const defaultAttribute = getPrismaDefaultAttribute(field);
    if (defaultAttribute) {
      attributes.push(defaultAttribute);
    }

    if (field.meta?.autoUpdate && field.type === "datetime") {
      attributes.push("@updatedAt");
    }

    if (field.name !== fieldKey) {
      attributes.push(`@map("${escapeDoubleQuoted(field.name)}")`);
    }

    if (attributes.length) {
      parts.push(attributes.join(" "));
    }

    lines.push(`  ${parts.join(" ")}`);

    if (field.index) {
      modelLevelConstraints.push(
        `@@index([${fieldKey}], map: "${escapeDoubleQuoted(`${model.modelName}_${field.name}_idx`)}")`,
      );
    }
  }

  for (const constraint of model.model.constraints || []) {
    const fields = constraint.fields.join(", ");
    const attribute = constraint.type === "unique" ? "@@unique" : "@@index";
    const suffix = constraint.name ? `, map: "${escapeDoubleQuoted(constraint.name)}"` : "";
    modelLevelConstraints.push(`${attribute}([${fields}]${suffix})`);
  }

  lines.push(`  @@map("${escapeDoubleQuoted(model.modelName)}")`);

  for (const constraint of modelLevelConstraints) {
    lines.push(`  ${constraint}`);
  }

  lines.push("}");
  return lines.join("\n");
}

function getPrismaFieldType(field: ResolvedSchemaField) {
  switch (field.type) {
    case "boolean":
      return "Boolean";
    case "integer":
      return "Int";
    case "number":
      return "Float";
    case "datetime":
      return "DateTime";
    case "json":
      return "Json";
    default:
      return "String";
  }
}

function getPrismaDefaultAttribute(field: ResolvedSchemaField) {
  if (field.default === undefined) {
    return null;
  }

  if (field.type === "datetime" && field.default === "now") {
    return "@default(now())";
  }

  if (typeof field.default === "string") {
    return `@default("${escapeDoubleQuoted(field.default)}")`;
  }

  if (typeof field.default === "number" || typeof field.default === "boolean") {
    return `@default(${String(field.default)})`;
  }

  return null;
}

function createPrismaGeneratedBlock(body: string) {
  return [PRISMA_GENERATED_START, body, PRISMA_GENERATED_END].join("\n");
}

function generateDrizzleSchema(
  models: readonly CollectedSchemaModel[],
  dialect: GenerateFarmSqlDialect,
) {
  const tableFactoryName =
    dialect === "postgres" ? "pgTable" : dialect === "mysql" ? "mysqlTable" : "sqliteTable";
  const importSource =
    dialect === "postgres"
      ? "drizzle-orm/pg-core"
      : dialect === "mysql"
        ? "drizzle-orm/mysql-core"
        : "drizzle-orm/sqlite-core";
  const imports = new Set<string>([tableFactoryName, "index", "uniqueIndex"]);

  for (const model of models) {
    for (const field of Object.values(model.model.fields)) {
      for (const helper of getDrizzleImportNames(dialect, field)) {
        imports.add(helper);
      }
    }
  }

  const lines = [
    "// Generated by Farm.js CLI. Review before committing.",
    `import { ${Array.from(imports).sort().join(", ")} } from "${importSource}";`,
    "",
  ];

  for (const model of models) {
    lines.push(renderDrizzleModel(model, dialect, tableFactoryName));
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

function renderDrizzleModel(
  model: CollectedSchemaModel,
  dialect: GenerateFarmSqlDialect,
  tableFactoryName: string,
) {
  const lines = [
    `// Farm.js generated from "${model.ownerKey}" model "${model.modelKey}"`,
    `export const ${model.exportName} = ${tableFactoryName}("${model.modelName}", {`,
  ];

  for (const [fieldKey, field] of Object.entries(model.model.fields)) {
    if (field.reference) {
      lines.push(
        `  // ${fieldKey} references ${field.reference.model}.${field.reference.field}${field.reference.onDelete ? ` (onDelete: ${field.reference.onDelete})` : ""}`,
      );
    }

    lines.push(`  ${fieldKey}: ${renderDrizzleColumn(field, dialect)},`);
  }

  lines.push("}, (table) => ({");

  for (const [fieldKey, field] of Object.entries(model.model.fields)) {
    if (field.index) {
      lines.push(
        `  ${fieldKey}Idx: index("${escapeDoubleQuoted(`${model.modelName}_${field.name}_idx`)}").on(table.${fieldKey}),`,
      );
    }
  }

  for (const constraint of model.model.constraints || []) {
    const builder = constraint.type === "unique" ? "uniqueIndex" : "index";
    const accessor = constraint.fields.map((fieldKey) => `table.${fieldKey}`).join(", ");
    const name =
      constraint.name ||
      `${model.modelName}_${constraint.fields.map((fieldKey) => model.model.fields[fieldKey]?.name || fieldKey).join("_")}_${constraint.type}`;
    lines.push(
      `  ${toCamelCase(name)}: ${builder}("${escapeDoubleQuoted(name)}").on(${accessor}),`,
    );
  }

  lines.push("}));");
  return lines.join("\n");
}

function getDrizzleImportNames(dialect: GenerateFarmSqlDialect, field: ResolvedSchemaField) {
  switch (dialect) {
    case "postgres":
      switch (field.type) {
        case "boolean":
          return ["boolean"];
        case "integer":
          return ["integer"];
        case "number":
          return ["real"];
        case "datetime":
          return ["timestamp"];
        case "json":
          return ["jsonb"];
        default:
          return ["text"];
      }

    case "mysql":
      switch (field.type) {
        case "boolean":
          return ["boolean"];
        case "integer":
          return ["int"];
        case "number":
          return ["double"];
        case "datetime":
          return ["datetime"];
        case "json":
          return ["json"];
        case "text":
          return ["text"];
        default:
          return ["varchar"];
      }

    case "sqlite":
      switch (field.type) {
        case "number":
          return ["real"];
        case "integer":
        case "boolean":
        case "datetime":
          return ["integer"];
        default:
          return ["text"];
      }
  }
}

function renderDrizzleColumn(field: ResolvedSchemaField, dialect: GenerateFarmSqlDialect) {
  let expression: string;

  if (dialect === "postgres") {
    expression = renderPostgresDrizzleColumn(field);
  } else if (dialect === "mysql") {
    expression = renderMysqlDrizzleColumn(field);
  } else {
    expression = renderSqliteDrizzleColumn(field);
  }

  if (field.primaryKey) {
    expression += ".primaryKey()";
  }

  if (!field.primaryKey && !isNullableField(field)) {
    expression += ".notNull()";
  }

  if (!field.primaryKey && field.unique) {
    expression += ".unique()";
  }

  const defaultValue = getDrizzleDefaultExpression(field, dialect);
  if (defaultValue) {
    expression += defaultValue;
  }

  return expression;
}

function renderPostgresDrizzleColumn(field: ResolvedSchemaField) {
  switch (field.type) {
    case "boolean":
      return `boolean("${field.name}")`;
    case "integer":
      return `integer("${field.name}")`;
    case "number":
      return `real("${field.name}")`;
    case "datetime":
      return `timestamp("${field.name}", { mode: "date" })`;
    case "json":
      return `jsonb("${field.name}")`;
    default:
      return `text("${field.name}")`;
  }
}

function renderMysqlDrizzleColumn(field: ResolvedSchemaField) {
  switch (field.type) {
    case "boolean":
      return `boolean("${field.name}")`;
    case "integer":
      return `int("${field.name}")`;
    case "number":
      return `double("${field.name}")`;
    case "datetime":
      return `datetime("${field.name}", { mode: "date" })`;
    case "json":
      return `json("${field.name}")`;
    case "text":
      return `text("${field.name}")`;
    default:
      return `varchar("${field.name}", { length: 255 })`;
  }
}

function renderSqliteDrizzleColumn(field: ResolvedSchemaField) {
  switch (field.type) {
    case "boolean":
      return `integer("${field.name}", { mode: "boolean" })`;
    case "integer":
      return `integer("${field.name}")`;
    case "number":
      return `real("${field.name}")`;
    case "datetime":
      return `integer("${field.name}", { mode: "timestamp_ms" })`;
    default:
      return `text("${field.name}")`;
  }
}

function getDrizzleDefaultExpression(field: ResolvedSchemaField, dialect: GenerateFarmSqlDialect) {
  if (field.default === undefined) {
    return "";
  }

  if (field.type === "datetime" && field.default === "now") {
    return dialect === "sqlite" ? "" : ".defaultNow()";
  }

  if (typeof field.default === "string") {
    return `.default("${escapeDoubleQuoted(field.default)}")`;
  }

  if (typeof field.default === "number" || typeof field.default === "boolean") {
    return `.default(${String(field.default)})`;
  }

  return "";
}

function generateMongoBootstrap(models: readonly CollectedSchemaModel[]) {
  const lines = [
    "// Generated by Farm.js CLI. Review before committing.",
    'import type { Db } from "mongodb";',
    "",
    "export async function ensureFarmIntegrationCollections(db: Db) {",
  ];

  for (const model of models) {
    lines.push(`  // Owner "${model.ownerKey}" model "${model.modelKey}"`);
    lines.push(
      `  const ${model.exportName} = db.collection("${escapeDoubleQuoted(model.modelName)}");`,
    );

    for (const [fieldKey, field] of Object.entries(model.model.fields)) {
      if (field.unique) {
        const options: string[] = ["unique: true"];
        if (isNullableField(field)) {
          options.push("sparse: true");
        }
        options.push(`name: "${escapeDoubleQuoted(`${model.modelName}_${field.name}_unique`)}"`);
        lines.push(
          `  await ${model.exportName}.createIndex({ ${JSON.stringify(field.name)}: 1 }, { ${options.join(", ")} });`,
        );
      } else if (field.index) {
        lines.push(
          `  await ${model.exportName}.createIndex({ ${JSON.stringify(field.name)}: 1 }, { name: "${escapeDoubleQuoted(`${model.modelName}_${field.name}_idx`)}" });`,
        );
      }

      if (field.reference) {
        lines.push(
          `  // ${fieldKey} references ${field.reference.model}.${field.reference.field}${field.reference.onDelete ? ` (onDelete: ${field.reference.onDelete})` : ""}`,
        );
      }
    }

    for (const constraint of model.model.constraints || []) {
      const indexSpec = constraint.fields
        .map((fieldKey) => `${JSON.stringify(model.model.fields[fieldKey]?.name || fieldKey)}: 1`)
        .join(", ");
      const indexName =
        constraint.name ||
        `${model.modelName}_${constraint.fields.map((fieldKey) => model.model.fields[fieldKey]?.name || fieldKey).join("_")}_${constraint.type}`;
      const options =
        constraint.type === "unique"
          ? `{ unique: true, name: "${escapeDoubleQuoted(indexName)}" }`
          : `{ name: "${escapeDoubleQuoted(indexName)}" }`;
      lines.push(`  await ${model.exportName}.createIndex({ ${indexSpec} }, ${options});`);
    }

    lines.push("");
  }

  lines.push("}");
  return lines.join("\n").trimEnd() + "\n";
}

async function writeGeneratedFile(filePath: string, contents: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

export function escapeDoubleQuoted(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
