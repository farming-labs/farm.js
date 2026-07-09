import {
  APITypeGenerator,
  getFarmDocsRouteTypeEntries,
  getIntegrationSchemas,
  generateRouteTypes,
  loadConfig,
  logger,
  resolveConfig,
  type FarmIntegrationSchema,
  type FarmIntegrationSchemaField,
  type FarmIntegrationSchemaModel,
} from "@farmjs/core";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
}

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

type ResolvedSchemaField = FarmIntegrationSchemaField & {
  name: string;
};

type ResolvedSchemaModel = Omit<FarmIntegrationSchemaModel, "fields"> & {
  name: string;
  fields: Record<string, ResolvedSchemaField>;
};

type CollectedSchemaModel = {
  integrationKey: string;
  modelKey: string;
  modelName: string;
  exportName: string;
  prismaModelName: string;
  model: ResolvedSchemaModel;
};

const PRISMA_GENERATED_START = "// Farm.js integrations generated schema: start";
const PRISMA_GENERATED_END = "// Farm.js integrations generated schema: end";

export async function generateFarmArtifacts(options: GenerateFarmOptions = {}) {
  const root = path.resolve(options.root || process.cwd());
  const userConfig = await loadConfig(root, options.configPath, "development");

  if (!userConfig && hasSchemaOptions(options)) {
    throw new Error("No Farm config found. Please create farm.config.ts or config.ts.");
  }

  const resolvedConfig = await resolveConfig({ root, ...(userConfig || {}) }, "development");
  const extraRoutes = [
    ...(resolvedConfig.openapi?.enabled && resolvedConfig.openapi.route
      ? [resolvedConfig.openapi.route]
      : []),
    ...getFarmDocsRouteTypeEntries(resolvedConfig.docs),
  ];
  await generateRouteTypes({
    root: resolvedConfig.root,
    srcDir: resolvedConfig.srcDir,
    extraRoutes,
    suppressLintOnLink: resolvedConfig.suppressLintOnLink,
  });
  const appDir = path.join(resolvedConfig.root, resolvedConfig.srcDir, "app");
  const apiGenerator = new APITypeGenerator(appDir);
  const apiRoutes = apiGenerator.scanAPIRoutes();
  const apiTypesPath = path.join(resolvedConfig.root, resolvedConfig.srcDir, "lib", "api.generated.ts");
  await mkdir(path.dirname(apiTypesPath), { recursive: true });
  await writeFile(apiTypesPath, apiGenerator.generateAPIRouter(apiRoutes), "utf8");
  logger.success(
    `Generated route and API types (${apiRoutes.length} API route${apiRoutes.length === 1 ? "" : "s"}).`,
  );

  const schemas = getIntegrationSchemas(resolvedConfig.integrations);
  const schemaEntries = Object.entries(schemas);

  if (!schemaEntries.length) {
    if (hasSchemaOptions(options)) {
      logger.warn("No integration schemas were found in the current Farm config.");
    }
    return;
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
      `Integration schemas were found, but Farm could not choose a schema target automatically: ${(error as Error).message}`,
    );
    return;
  }

  if (!orm) {
    if (!schemaOptionsExplicit) {
      logger.warn(
        "Integration schemas were found, but no data layer was detected. Pass --orm prisma|drizzle|postgres|mysql|sqlite|mongodb to generate schema artifacts.",
      );
      return;
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
      return;
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
      return;
    }

    case "postgres":
    case "mysql":
    case "sqlite": {
      const outputPath = options.output
        ? path.resolve(root, options.output)
        : path.join(root, `farm-integrations.generated.${orm}.sql`);
      await writeGeneratedFile(outputPath, generateSqlSchema(collectedModels, orm));
      logger.success(`Generated ${orm} integration schema in ${path.relative(root, outputPath)}.`);
      return;
    }

    case "mongodb": {
      const outputPath = options.output
        ? path.resolve(root, options.output)
        : path.join(root, "farm-integrations.generated.mongodb.ts");
      await writeGeneratedFile(outputPath, generateMongoBootstrap(collectedModels));
      logger.success(
        `Generated MongoDB integration bootstrap in ${path.relative(root, outputPath)}.`,
      );
      return;
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

function collectSchemaModels(
  schemaEntries: ReadonlyArray<readonly [string, FarmIntegrationSchema]>,
) {
  const collectedModels: CollectedSchemaModel[] = [];
  const seenModelNames = new Map<string, string>();

  for (const [integrationKey, schema] of schemaEntries) {
    const resolvedModels = resolveSchemaModels(integrationKey, schema);

    for (const [modelKey, model] of Object.entries(resolvedModels)) {
      const collisionKey = model.name.toLowerCase();
      const previousOwner = seenModelNames.get(collisionKey);

      if (previousOwner && previousOwner !== `${integrationKey}.${modelKey}`) {
        throw new Error(
          `Integration schema model "${integrationKey}.${modelKey}" resolves to "${model.name}", which conflicts with "${previousOwner}". Rename one of the models with schema.models.<model>.name.`,
        );
      }

      seenModelNames.set(collisionKey, `${integrationKey}.${modelKey}`);

      collectedModels.push({
        integrationKey,
        modelKey,
        modelName: model.name,
        exportName: toCamelCase(`${integrationKey}_${modelKey}`),
        prismaModelName: toPascalCase(`${integrationKey}_${modelKey}`),
        model,
      });
    }
  }

  return collectedModels;
}

function resolveSchemaModels(integrationKey: string, schema: FarmIntegrationSchema) {
  const models: Record<string, FarmIntegrationSchemaModel> = Object.fromEntries(
    Object.entries(schema.models).map(([modelKey, model]) => [modelKey, cloneSchemaModel(model)]),
  );

  for (const [modelKey, extension] of Object.entries(schema.extend || {})) {
    const existing = models[modelKey];
    models[modelKey] = {
      ...(existing || { fields: {} }),
      ...(extension.name ? { name: extension.name } : {}),
      ...(extension.description ? { description: extension.description } : {}),
      fields: {
        ...existing?.fields,
        ...extension.fields,
      },
      constraints: [...(existing?.constraints || []), ...(extension.constraints || [])],
      meta: {
        ...existing?.meta,
        ...extension.meta,
      },
    };
  }

  for (const [modelKey, override] of Object.entries(schema.override || {})) {
    const existing = models[modelKey];

    if (!existing) {
      throw new Error(
        `Integration schema override for "${integrationKey}.${modelKey}" is invalid because that model does not exist.`,
      );
    }

    const fields = {
      ...existing.fields,
    };

    for (const [fieldKey, fieldOverride] of Object.entries(override.fields || {})) {
      const existingField = fields[fieldKey];

      if (!existingField && !fieldOverride.type) {
        throw new Error(
          `Integration schema override for "${integrationKey}.${modelKey}.${fieldKey}" is missing a field type.`,
        );
      }

      fields[fieldKey] = {
        ...existingField,
        ...fieldOverride,
      } as FarmIntegrationSchemaField;
    }

    models[modelKey] = {
      ...existing,
      ...(override.name ? { name: override.name } : {}),
      ...(override.description ? { description: override.description } : {}),
      fields,
      constraints: override.constraints || existing.constraints,
      meta: {
        ...existing.meta,
        ...override.meta,
      },
    };
  }

  const resolvedModels: Record<string, ResolvedSchemaModel> = {};

  for (const [modelKey, model] of Object.entries(models)) {
    const modelName = model.name || toSnakeCase(`${integrationKey}_${modelKey}`);
    const fieldNames = new Set<string>();
    const resolvedFields: Record<string, ResolvedSchemaField> = {};

    for (const [fieldKey, field] of Object.entries(model.fields)) {
      const fieldName = field.name || toSnakeCase(fieldKey);

      if (fieldNames.has(fieldName)) {
        throw new Error(
          `Integration schema model "${integrationKey}.${modelKey}" contains duplicate field name "${fieldName}".`,
        );
      }

      fieldNames.add(fieldName);
      resolvedFields[fieldKey] = {
        ...field,
        name: fieldName,
      };
    }

    resolvedModels[modelKey] = {
      ...model,
      name: modelName,
      fields: resolvedFields,
    };
  }

  return resolvedModels;
}

function cloneSchemaModel(model: FarmIntegrationSchemaModel): FarmIntegrationSchemaModel {
  return {
    ...model,
    fields: Object.fromEntries(
      Object.entries(model.fields).map(([fieldKey, field]) => [fieldKey, { ...field }]),
    ),
    constraints: model.constraints ? [...model.constraints] : undefined,
    meta: model.meta ? { ...model.meta } : undefined,
  };
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
    `/// Farm.js generated from integration "${model.integrationKey}" model "${model.modelKey}"`,
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
      attributes.push(`@map("${escapeString(field.name)}")`);
    }

    if (attributes.length) {
      parts.push(attributes.join(" "));
    }

    lines.push(`  ${parts.join(" ")}`);

    if (field.index) {
      modelLevelConstraints.push(
        `@@index([${fieldKey}], map: "${escapeString(`${model.modelName}_${field.name}_idx`)}")`,
      );
    }
  }

  for (const constraint of model.model.constraints || []) {
    const fields = constraint.fields.join(", ");
    const attribute = constraint.type === "unique" ? "@@unique" : "@@index";
    const suffix = constraint.name ? `, map: "${escapeString(constraint.name)}"` : "";
    modelLevelConstraints.push(`${attribute}([${fields}]${suffix})`);
  }

  lines.push(`  @@map("${escapeString(model.modelName)}")`);

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
    return `@default("${escapeString(field.default)}")`;
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
    `// Farm.js generated from integration "${model.integrationKey}" model "${model.modelKey}"`,
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
        `  ${fieldKey}Idx: index("${escapeString(`${model.modelName}_${field.name}_idx`)}").on(table.${fieldKey}),`,
      );
    }
  }

  for (const constraint of model.model.constraints || []) {
    const builder = constraint.type === "unique" ? "uniqueIndex" : "index";
    const accessor = constraint.fields.map((fieldKey) => `table.${fieldKey}`).join(", ");
    const name =
      constraint.name ||
      `${model.modelName}_${constraint.fields.map((fieldKey) => model.model.fields[fieldKey]?.name || fieldKey).join("_")}_${constraint.type}`;
    lines.push(`  ${toCamelCase(name)}: ${builder}("${escapeString(name)}").on(${accessor}),`);
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
    return `.default("${escapeString(field.default)}")`;
  }

  if (typeof field.default === "number" || typeof field.default === "boolean") {
    return `.default(${String(field.default)})`;
  }

  return "";
}

function generateSqlSchema(
  models: readonly CollectedSchemaModel[],
  dialect: GenerateFarmSqlDialect,
) {
  const lines = ["-- Generated by Farm.js CLI. Review before applying.", ""];
  const modelLookup = createModelLookup(models);

  for (const model of models) {
    lines.push(
      `-- Integration "${model.integrationKey}" model "${model.modelKey}"`,
      renderSqlTable(model, dialect, modelLookup),
      "",
    );

    for (const statement of renderSqlIndexes(model, dialect)) {
      lines.push(statement, "");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

function renderSqlTable(
  model: CollectedSchemaModel,
  dialect: GenerateFarmSqlDialect,
  modelLookup: Map<string, CollectedSchemaModel>,
) {
  const tableName = quoteIdentifier(dialect, model.modelName);
  const lines = [`CREATE TABLE IF NOT EXISTS ${tableName} (`];
  const columns: string[] = [];
  const internalReferences = createInternalReferenceLookup(model, dialect, modelLookup);

  for (const [fieldKey, field] of Object.entries(model.model.fields)) {
    const parts = [`  ${quoteIdentifier(dialect, field.name)}`, getSqlColumnType(field, dialect)];

    if (field.primaryKey) {
      parts.push("PRIMARY KEY");
    } else if (!isNullableField(field)) {
      parts.push("NOT NULL");
    }

    if (!field.primaryKey && field.unique) {
      parts.push("UNIQUE");
    }

    const defaultValue = getSqlDefaultExpression(field, dialect);
    if (defaultValue) {
      parts.push(`DEFAULT ${defaultValue}`);
    }

    const reference = internalReferences.get(fieldKey);
    if (reference) {
      parts.push(reference);
    } else if (field.reference) {
      parts.push(
        `/* references ${field.reference.model}.${field.reference.field}${field.reference.onDelete ? ` on delete ${field.reference.onDelete}` : ""} */`,
      );
    }

    columns.push(parts.join(" "));
  }

  lines.push(columns.join(",\n"));
  lines.push(");");
  return lines.join("\n");
}

function renderSqlIndexes(model: CollectedSchemaModel, dialect: GenerateFarmSqlDialect) {
  const statements: string[] = [];
  const tableName = quoteIdentifier(dialect, model.modelName);

  for (const [fieldKey, field] of Object.entries(model.model.fields)) {
    if (!field.index) {
      continue;
    }

    const indexName = `${model.modelName}_${field.name}_idx`;
    statements.push(
      `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(dialect, indexName)} ON ${tableName} (${quoteIdentifier(dialect, field.name)});`,
    );
  }

  for (const constraint of model.model.constraints || []) {
    const indexName =
      constraint.name ||
      `${model.modelName}_${constraint.fields.map((fieldKey) => model.model.fields[fieldKey]?.name || fieldKey).join("_")}_${constraint.type}`;
    const fields = constraint.fields
      .map((fieldKey) => quoteIdentifier(dialect, model.model.fields[fieldKey]?.name || fieldKey))
      .join(", ");

    if (constraint.type === "unique") {
      statements.push(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier(dialect, indexName)} ON ${tableName} (${fields});`,
      );
    } else {
      statements.push(
        `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(dialect, indexName)} ON ${tableName} (${fields});`,
      );
    }
  }

  return statements;
}

function createInternalReferenceLookup(
  model: CollectedSchemaModel,
  dialect: GenerateFarmSqlDialect,
  modelLookup: Map<string, CollectedSchemaModel>,
) {
  const lookup = new Map<string, string>();

  for (const [fieldKey, field] of Object.entries(model.model.fields)) {
    if (!field.reference) {
      continue;
    }

    const referencedModel = modelLookup.get(`${model.integrationKey}.${field.reference.model}`);

    if (referencedModel) {
      const referencedField = field.reference.field;
      const pieces = [
        `REFERENCES ${quoteIdentifier(dialect, referencedModel.modelName)} (${quoteIdentifier(dialect, referencedModel.model.fields[referencedField]?.name || toSnakeCase(referencedField))})`,
      ];

      if (field.reference.onDelete) {
        pieces.push(`ON DELETE ${field.reference.onDelete.toUpperCase()}`);
      }

      lookup.set(fieldKey, pieces.join(" "));
    }
  }

  return lookup;
}

function getSqlColumnType(field: ResolvedSchemaField, dialect: GenerateFarmSqlDialect) {
  if (dialect === "postgres") {
    switch (field.type) {
      case "boolean":
        return "BOOLEAN";
      case "integer":
        return "INTEGER";
      case "number":
        return "DOUBLE PRECISION";
      case "datetime":
        return "TIMESTAMPTZ";
      case "json":
        return "JSONB";
      default:
        return "TEXT";
    }
  }

  if (dialect === "mysql") {
    switch (field.type) {
      case "boolean":
        return "BOOLEAN";
      case "integer":
        return "INT";
      case "number":
        return "DOUBLE";
      case "datetime":
        return "DATETIME";
      case "json":
        return "JSON";
      case "text":
        return "TEXT";
      default:
        return "VARCHAR(255)";
    }
  }

  switch (field.type) {
    case "boolean":
    case "integer":
      return "INTEGER";
    case "number":
      return "REAL";
    default:
      return "TEXT";
  }
}

function getSqlDefaultExpression(field: ResolvedSchemaField, dialect: GenerateFarmSqlDialect) {
  if (field.default === undefined) {
    return null;
  }

  if (field.type === "datetime" && field.default === "now") {
    return "CURRENT_TIMESTAMP";
  }

  if (typeof field.default === "string") {
    return `'${escapeString(field.default)}'`;
  }

  if (typeof field.default === "number") {
    return String(field.default);
  }

  if (typeof field.default === "boolean") {
    if (dialect === "sqlite") {
      return field.default ? "1" : "0";
    }
    return field.default ? "TRUE" : "FALSE";
  }

  return null;
}

function generateMongoBootstrap(models: readonly CollectedSchemaModel[]) {
  const lines = [
    "// Generated by Farm.js CLI. Review before committing.",
    'import type { Db } from "mongodb";',
    "",
    "export async function ensureFarmIntegrationCollections(db: Db) {",
  ];

  for (const model of models) {
    lines.push(`  // Integration "${model.integrationKey}" model "${model.modelKey}"`);
    lines.push(`  const ${model.exportName} = db.collection("${escapeString(model.modelName)}");`);

    for (const [fieldKey, field] of Object.entries(model.model.fields)) {
      if (field.unique) {
        const options: string[] = ["unique: true"];
        if (isNullableField(field)) {
          options.push("sparse: true");
        }
        options.push(`name: "${escapeString(`${model.modelName}_${field.name}_unique`)}"`);
        lines.push(
          `  await ${model.exportName}.createIndex({ ${JSON.stringify(field.name)}: 1 }, { ${options.join(", ")} });`,
        );
      } else if (field.index) {
        lines.push(
          `  await ${model.exportName}.createIndex({ ${JSON.stringify(field.name)}: 1 }, { name: "${escapeString(`${model.modelName}_${field.name}_idx`)}" });`,
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
          ? `{ unique: true, name: "${escapeString(indexName)}" }`
          : `{ name: "${escapeString(indexName)}" }`;
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

function isNullableField(field: ResolvedSchemaField) {
  return field.nullable === true || field.required === false;
}

function quoteIdentifier(dialect: GenerateFarmSqlDialect, value: string) {
  if (dialect === "mysql") {
    return `\`${value.replace(/`/g, "``")}\``;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

function createModelLookup(models: readonly CollectedSchemaModel[]) {
  return new Map(models.map((model) => [`${model.integrationKey}.${model.modelKey}`, model]));
}

function toSnakeCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s.-]+/g, "_")
    .replace(/__+/g, "_")
    .toLowerCase();
}

function toPascalCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[\s._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function toCamelCase(value: string) {
  const pascal = toPascalCase(value);
  return pascal ? pascal.charAt(0).toLowerCase() + pascal.slice(1) : pascal;
}

function escapeString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "''");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
