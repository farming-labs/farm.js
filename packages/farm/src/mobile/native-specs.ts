import { createRequire } from "node:module";
import * as path from "node:path";

/**
 * What web screens can call on an app native module (RFC 0004, 7.5): the Promise methods of its
 * Codegen spec, read with React Native's own Codegen parser so the spec stays the one source. The
 * Android shell checks arguments against these types before the module runs, and `src/farm.d.ts`
 * types `native.<module>` from them.
 */

/** A value a web screen sends or receives, as the Codegen spec declares it. */
export type FarmNativeType = (
  | { type: "string" }
  | { type: "number"; integer?: true }
  | { type: "boolean" }
  /** A string literal union, a single literal, or an enum: the values the spec allows. */
  | { type: "literal"; values: Array<string | number> }
  /** An object type with declared properties: `ReadableMap` in Kotlin. */
  | { type: "object"; properties: FarmNativeProperty[] }
  /** `Object` or `UnsafeObject`: any JSON object, `ReadableMap` in Kotlin. */
  | { type: "map" }
  /** An array; without `element`, any JSON values. `ReadableArray` in Kotlin. */
  | { type: "array"; element?: FarmNativeType }
  /** Return values only: `Promise<void>`. */
  | { type: "void" }
  /** Return values only: a type web screens get as JSON without a narrower type. */
  | { type: "unknown" }
) & { nullable?: true };

export interface FarmNativeProperty {
  name: string;
  optional: boolean;
  type: FarmNativeType;
}

export interface FarmNativeMethod {
  name: string;
  params: FarmNativeProperty[];
  /** What the Promise resolves with. */
  returns: FarmNativeType;
}

/** The part of one Codegen spec web screens reach. */
export interface FarmNativeWebSpec {
  /** Promise methods whose parameters web screens can send, in spec order. */
  methods: FarmNativeMethod[];
  /** Promise methods web screens cannot call, and why, such as a callback parameter. */
  unsupported: Array<{ method: string; reason: string }>;
}

interface CodegenAnnotation {
  type: string;
  [key: string]: unknown;
}

interface CodegenModuleSchema {
  type: string;
  moduleName?: string;
  aliasMap?: Record<string, CodegenAnnotation>;
  enumMap?: Record<
    string,
    { memberType?: string; members?: Array<{ value?: { value?: unknown } }> }
  >;
  spec?: {
    methods?: Array<{ name: string; optional?: boolean; typeAnnotation: CodegenAnnotation }>;
  };
}

interface CodegenParser {
  parseFile(file: string): { modules: Record<string, CodegenModuleSchema> };
}

class UnsupportedType extends Error {}

const parsers = new Map<string, { typescript: CodegenParser; flow: CodegenParser }>();

/**
 * React Native's Codegen parsers from the app's own install: `@react-native/codegen` next to
 * `react-native`, the version its Gradle plugin runs for the app. Throws when it is not installed.
 */
function loadCodegen(root: string): { typescript: CodegenParser; flow: CodegenParser } {
  const cached = parsers.get(root);
  if (cached) return cached;
  let codegenDir: string;
  let load: NodeJS.Require;
  try {
    const reactNative = createRequire(path.join(root, "package.json")).resolve(
      "react-native/package.json",
    );
    load = createRequire(reactNative);
    codegenDir = path.dirname(load.resolve("@react-native/codegen/package.json"));
  } catch (error) {
    throw Object.assign(
      new Error(
        "Reading a native module spec needs React Native's Codegen (@react-native/codegen, " +
          "installed with react-native). Add react-native to the app's dependencies and install them.",
      ),
      { cause: error },
    );
  }
  const typescript = load(path.join(codegenDir, "lib/parsers/typescript/parser.js")) as {
    TypeScriptParser: new () => CodegenParser;
  };
  const flow = load(path.join(codegenDir, "lib/parsers/flow/parser.js")) as {
    FlowParser: new () => CodegenParser;
  };
  const loaded = { typescript: new typescript.TypeScriptParser(), flow: new flow.FlowParser() };
  parsers.set(root, loaded);
  return loaded;
}

/** True when the app has React Native's Codegen installed, so its specs can be read. */
export function hasFarmNativeCodegen(root: string): boolean {
  try {
    loadCodegen(root);
    return true;
  } catch {
    return false;
  }
}

function describe(annotation: CodegenAnnotation): string {
  switch (annotation.type) {
    case "FunctionTypeAnnotation":
      return "a callback";
    case "MixedTypeAnnotation":
      return "a mixed value";
    case "ReservedTypeAnnotation":
      return String(annotation.name ?? "a reserved type");
    case "EventEmitterTypeAnnotation":
      return "an event emitter";
    default:
      return annotation.type.replace(/TypeAnnotation$/, "");
  }
}

function toType(
  annotation: CodegenAnnotation,
  module: CodegenModuleSchema,
  options: { returns?: boolean } = {},
): FarmNativeType {
  switch (annotation.type) {
    case "NullableTypeAnnotation":
      return {
        ...toType(annotation.typeAnnotation as CodegenAnnotation, module, options),
        nullable: true,
      };
    case "StringTypeAnnotation":
      return { type: "string" };
    case "NumberTypeAnnotation":
    case "DoubleTypeAnnotation":
    case "FloatTypeAnnotation":
      return { type: "number" };
    case "Int32TypeAnnotation":
      return { type: "number", integer: true };
    case "BooleanTypeAnnotation":
      return { type: "boolean" };
    case "StringLiteralTypeAnnotation":
    case "NumberLiteralTypeAnnotation":
      return { type: "literal", values: [annotation.value as string | number] };
    case "UnionTypeAnnotation":
    case "StringLiteralUnionTypeAnnotation": {
      const types = (annotation.types as CodegenAnnotation[] | undefined) ?? [];
      const values = types.map((member) => member.value);
      if (
        types.length > 0 &&
        types.every(
          (member) =>
            member.type === "StringLiteralTypeAnnotation" ||
            member.type === "NumberLiteralTypeAnnotation",
        ) &&
        (values.every((value) => typeof value === "string") ||
          values.every((value) => typeof value === "number"))
      ) {
        return { type: "literal", values: values as Array<string | number> };
      }
      throw new UnsupportedType("a union that is not all string or all number literals");
    }
    case "EnumDeclaration": {
      const members = module.enumMap?.[String(annotation.name)]?.members ?? [];
      const values = members.map((member) => member.value?.value);
      if (
        values.length > 0 &&
        (values.every((value) => typeof value === "string") ||
          values.every((value) => typeof value === "number"))
      ) {
        return { type: "literal", values: values as Array<string | number> };
      }
      throw new UnsupportedType(`the enum ${String(annotation.name)}`);
    }
    case "ObjectTypeAnnotation": {
      const properties =
        (annotation.properties as
          | Array<{ name: string; optional?: boolean; typeAnnotation: CodegenAnnotation }>
          | undefined) ?? [];
      return {
        type: "object",
        properties: properties.map((property) => ({
          name: property.name,
          optional: property.optional === true,
          type: toType(property.typeAnnotation, module, options),
        })),
      };
    }
    case "TypeAliasTypeAnnotation": {
      const alias = module.aliasMap?.[String(annotation.name)];
      if (!alias) throw new UnsupportedType(`the unknown type ${String(annotation.name)}`);
      return toType(alias, module, options);
    }
    case "GenericObjectTypeAnnotation":
      return { type: "map" };
    case "ArrayTypeAnnotation": {
      const element = annotation.elementType as CodegenAnnotation | undefined;
      if (!element || element.type === "AnyTypeAnnotation") return { type: "array" };
      return { type: "array", element: toType(element, module, options) };
    }
    case "VoidTypeAnnotation":
      if (options.returns) return { type: "void" };
      break;
  }
  if (options.returns) return { type: "unknown" };
  throw new UnsupportedType(describe(annotation));
}

/**
 * The Promise methods of one Codegen spec, such as `src/native/NativeDevice.ts`, as web screens
 * see them. Methods that do not return a Promise (synchronous methods, callbacks, constants) are
 * left out; Promise methods with a parameter web screens cannot send are listed in `unsupported`.
 * Throws when Codegen is not installed or rejects the spec.
 */
export function readFarmNativeWebSpec(options: { root: string; file: string }): FarmNativeWebSpec {
  const codegen = loadCodegen(options.root);
  const parser = /\.tsx?$/.test(options.file) ? codegen.typescript : codegen.flow;
  let schema: { modules: Record<string, CodegenModuleSchema> };
  try {
    schema = parser.parseFile(options.file);
  } catch (error) {
    const shown = path.relative(options.root, options.file).split(path.sep).join("/");
    throw Object.assign(
      new Error(`React Native's Codegen rejected ${shown}: ${(error as Error).message}`),
      { cause: error },
    );
  }
  const module = Object.values(schema.modules).find((entry) => entry.type === "NativeModule");
  const result: FarmNativeWebSpec = { methods: [], unsupported: [] };
  for (const method of module?.spec?.methods ?? []) {
    let fn = method.typeAnnotation;
    if (fn.type === "NullableTypeAnnotation") fn = fn.typeAnnotation as CodegenAnnotation;
    if (fn.type !== "FunctionTypeAnnotation") continue;
    const returned = fn.returnTypeAnnotation as CodegenAnnotation | undefined;
    if (returned?.type !== "PromiseTypeAnnotation") continue;
    const params =
      (fn.params as
        | Array<{ name: string; optional?: boolean; typeAnnotation: CodegenAnnotation }>
        | undefined) ?? [];
    try {
      result.methods.push({
        name: method.name,
        params: params.map((param) => {
          try {
            return {
              name: param.name,
              optional: param.optional === true,
              type: toType(param.typeAnnotation, module!),
            };
          } catch (error) {
            if (!(error instanceof UnsupportedType)) throw error;
            throw new UnsupportedType(
              `its parameter ${param.name} is ${error.message}, which a web screen cannot send`,
            );
          }
        }),
        returns: toType(
          (returned.elementType as CodegenAnnotation | undefined) ?? { type: "VoidTypeAnnotation" },
          module!,
          { returns: true },
        ),
      });
    } catch (error) {
      if (!(error instanceof UnsupportedType)) throw error;
      result.unsupported.push({ method: method.name, reason: error.message });
    }
  }
  return result;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A TypeScript type for one value, as `src/farm.d.ts` writes it. */
export function renderFarmNativeType(type: FarmNativeType): string {
  let rendered: string;
  switch (type.type) {
    case "string":
    case "number":
    case "boolean":
    case "void":
    case "unknown":
      rendered = type.type;
      break;
    case "literal":
      rendered = type.values.map((value) => JSON.stringify(value)).join(" | ");
      break;
    case "map":
      rendered = "Record<string, unknown>";
      break;
    case "array": {
      const element = type.element ? renderFarmNativeType(type.element) : "unknown";
      rendered = `Array<${element}>`;
      break;
    }
    case "object":
      rendered = type.properties.length
        ? `{ ${type.properties
            .map(
              (property) =>
                `${IDENTIFIER.test(property.name) ? property.name : JSON.stringify(property.name)}${
                  property.optional ? "?" : ""
                }: ${renderFarmNativeType(property.type)};`,
            )
            .join(" ")} }`
        : "{}";
      break;
  }
  return type.nullable ? `${rendered} | null` : rendered;
}

/** One method's TypeScript signature, such as `vibrate(ms: number): Promise<void>;`. */
export function renderFarmNativeMethod(method: FarmNativeMethod): string {
  // A TypeScript optional parameter cannot come before a required one.
  const lastRequired = method.params.reduce(
    (last, param, index) => (param.optional ? last : index),
    -1,
  );
  const params = method.params
    .map((param, index) => {
      const type = renderFarmNativeType(param.type);
      if (!param.optional) return `${param.name}: ${type}`;
      return index > lastRequired
        ? `${param.name}?: ${type}`
        : `${param.name}: ${type} | undefined`;
    })
    .join(", ");
  return `${method.name}(${params}): Promise<${renderFarmNativeType(method.returns)}>;`;
}

/**
 * The `src/farm.d.ts` section that types `native.<module>` from `@farm.js/core/native`: each app
 * module's Promise methods, read from its Codegen spec. Undefined when the app has no specs, or
 * when React Native's Codegen is not installed (a pruned production install): the declarations
 * only type-check web pages, so a build does not need them.
 */
export function createFarmNativeModuleTypeDeclarations(
  specs: ReadonlyArray<{ name: string; file: string }>,
  options: { root: string },
): string | undefined {
  if (specs.length === 0 || !hasFarmNativeCodegen(options.root)) return undefined;
  const modules = specs.map((spec) => {
    const { methods } = readFarmNativeWebSpec({ root: options.root, file: spec.file });
    const body = methods
      .filter((method) => method.name !== "available")
      .map((method) => `      ${renderFarmNativeMethod(method)}`)
      .join("\n");
    return `    ${spec.name}: {${body ? `\n${body}\n    ` : ""}};`;
  });
  return `/**
 * Auto-generated from the Codegen specs in src/native: native.<module> from @farm.js/core/native.
 * Web screens reach a module's Promise methods only when mobile.modules.<name>.web is true, and
 * only inside the Android shell; check native.<module>.available() first.
 */
declare module "@farm.js/core/native" {
  interface FarmNativeModules {
${modules.join("\n")}
  }
}`;
}
