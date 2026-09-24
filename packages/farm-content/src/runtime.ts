import type { ContentEntry, ContentRemoteSource, ContentSchema } from "./types.js";

type RuntimeCollections = Readonly<Record<string, readonly ContentEntry<any>[]>>;

type EncodedContentValue =
  | null
  | boolean
  | number
  | string
  | ["undefined"]
  | ["date", string]
  | ["bigint", string]
  | ["array", EncodedContentValue[]]
  | ["object", Array<[string, EncodedContentValue]>];

export function decodeContentValue(
  value: EncodedContentValue,
  assetUrls: Readonly<Record<string, string>> = {},
): any {
  if (typeof value === "string") return replaceAssetUrls(value, assetUrls);
  if (!Array.isArray(value)) return value;
  const [kind, payload] = value;
  if (kind === "undefined") return undefined;
  if (kind === "date") return new Date(payload as string);
  if (kind === "bigint") return BigInt(payload as string);
  if (kind === "array")
    return Object.freeze(
      (payload as EncodedContentValue[]).map((entry) => decodeContentValue(entry, assetUrls)),
    );
  if (kind === "object") {
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, entry] of payload as Array<[string, EncodedContentValue]>) {
      Object.defineProperty(result, key, {
        value: decodeContentValue(entry, assetUrls),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(result);
  }
  throw new TypeError(`[farm:content] Unknown encoded content value: ${String(kind)}`);
}

function replaceAssetUrls(value: string, assetUrls: Readonly<Record<string, string>>): string {
  let result = value;
  for (const [token, url] of Object.entries(assetUrls)) {
    if (result.includes(token)) result = result.split(token).join(url);
  }
  return result;
}

/**
 * Live write runtime, shared between the config-time plugin and the generated
 * server module through globalThis so bundle-copy duplication cannot split it.
 * The plugin registers each collection's source and schema when the factory
 * runs; the generated module's `collections` handle reads them for writes.
 */
interface ContentWriteRegistration {
  source?: ContentRemoteSource;
  schema?: ContentSchema<any>;
}

interface ContentWriteRuntime {
  registrations: Record<string, ContentWriteRegistration>;
  /** Development hook: rebuild the snapshot after a successful write. */
  afterWrite?: () => Promise<void>;
}

const WRITE_RUNTIME_KEY = "__FARM_CONTENT_WRITE_RUNTIME__";

function writeRuntime(): ContentWriteRuntime {
  const scope = globalThis as { [WRITE_RUNTIME_KEY]?: ContentWriteRuntime };
  return (scope[WRITE_RUNTIME_KEY] ??= { registrations: Object.create(null) });
}

const RESERVED_REGISTRATION_NAMES = new Set(["__proto__", "constructor", "prototype"]);

const PROTOCOL_PROBE_KEYS = new Set([
  "then",
  "toJSON",
  "constructor",
  "$$typeof",
  "nodeType",
  "asymmetricMatch",
  "@@__IMMUTABLE_ITERABLE__@@",
]);

export function registerContentWriteRuntime(
  registrations: Record<string, ContentWriteRegistration>,
): () => void {
  const target = writeRuntime().registrations;
  const names: string[] = [];
  // Own keys assigned one by one onto a null-prototype record: a collection
  // literally named __proto__ must become data, never the record's prototype.
  for (const name of Object.keys(registrations)) {
    if (RESERVED_REGISTRATION_NAMES.has(name)) {
      throw new Error(`[farm:content] Collection name ${JSON.stringify(name)} is reserved`);
    }
    target[name] = registrations[name]!;
    names.push(name);
  }
  return () => {
    for (const name of names) {
      if (target[name] === registrations[name]) delete target[name];
    }
  };
}

export function setContentAfterWrite(afterWrite: (() => Promise<void>) | undefined): () => void {
  const state = writeRuntime();
  state.afterWrite = afterWrite;
  // Vite's restart creates the new server (registering its hook) BEFORE it
  // closes the old one, so an unconditional clear in the old server's close
  // handler would disarm the replacement. Only the current owner may clear.
  return () => {
    if (state.afterWrite === afterWrite) state.afterWrite = undefined;
  };
}

function requireWritableSource(name: string, verb: "create" | "update" | "delete") {
  const registration = writeRuntime().registrations[name];
  if (!registration?.source) {
    throw new Error(
      `[farm:content] Collection "${name}" is read-only: only a remote() source can write. ` +
        "Local file collections are edited on disk.",
    );
  }
  const callback = registration.source[verb];
  if (!callback) {
    throw new Error(
      `[farm:content] Collection "${name}": source ${JSON.stringify(registration.source.name)} ` +
        `does not implement ${verb}(). Add the callback to the source, or perform the write ` +
        "with the provider's own SDK in a server function.",
    );
  }
  return { callback: callback.bind(registration.source), registration };
}

async function validateAgainstSchema(
  schema: ContentSchema<any> | undefined,
  data: unknown,
): Promise<void> {
  if (!schema) return;
  if (typeof schema.parseAsync === "function") {
    await schema.parseAsync(data);
    return;
  }
  if (typeof schema.parse === "function") {
    schema.parse(data);
    return;
  }
  const standard = schema["~standard"];
  if (standard) {
    const result = await standard.validate(data);
    if (result && "issues" in result && result.issues?.length) {
      throw new Error(
        `[farm:content] The written document failed validation: ${result.issues
          .map((issue) => issue.message)
          .join("; ")}`,
      );
    }
  }
}

async function settleWrite<T>(result: T): Promise<T> {
  // The CMS accepted the write; refresh the local snapshot where a dev server
  // is present. In production the snapshot is bundled, so the change becomes
  // visible on the next build - pair writes with a deploy hook. A failing
  // refresh must not report the persisted write as failed: the dev pipeline
  // surfaces its own errors.
  try {
    await writeRuntime().afterWrite?.();
  } catch {
    // reported by the dev pipeline's own channel
  }
  return result;
}

export function createContentRuntime(collections: RuntimeCollections) {
  const indexes = new Map<string, ReadonlyMap<string, ContentEntry<any>>>();

  function collection(name: string): readonly ContentEntry<any>[] {
    const entries = collections[name];
    if (!entries) {
      const available = Object.keys(collections);
      throw new Error(
        `[farm:content] Unknown collection "${name}".${
          available.length
            ? ` Available collections: ${available.join(", ")}`
            : " No collections are configured."
        }`,
      );
    }
    return entries;
  }

  const getCollection = async (name: string) => collection(name);
  const getEntry = async (name: string, id: string) => {
    let index = indexes.get(name);
    if (!index) {
      index = new Map(collection(name).map((entry) => [entry.id, entry]));
      indexes.set(name, index);
    }
    return index.get(id);
  };
  const getEntryOrThrow = async (name: string, id: string) => {
    const entry = await getEntry(name, id);
    if (!entry) {
      throw new Error(`[farm:content] Entry "${id}" was not found in collection "${name}"`);
    }
    return entry;
  };

  const handles = new Map<string, unknown>();
  const collectionHandle = (name: string) => {
    let handle = handles.get(name);
    if (!handle) {
      collection(name); // unknown names fail here with the available list
      handle = Object.freeze({
        all: () => getCollection(name),
        get: (id: string) => getEntry(name, id),
        getOrThrow: (id: string) => getEntryOrThrow(name, id),
        create: async (input: { data: Record<string, unknown>; body?: string }) => {
          const { callback, registration } = requireWritableSource(name, "create");
          const document = await (callback as NonNullable<ContentRemoteSource["create"]>)(input);
          // The source of truth answered; make sure what it stored still
          // satisfies the collection's schema before anyone trusts it.
          // The CMS changed either way, so the snapshot refreshes even when
          // validation rejects - readers should see the CMS's real state.
          try {
            await validateAgainstSchema(registration.schema, document.data);
          } catch (error) {
            await settleWrite(undefined);
            throw error;
          }
          return settleWrite(document);
        },
        update: async (id: string, patch: { data?: Record<string, unknown>; body?: string }) => {
          const { callback, registration } = requireWritableSource(name, "update");
          const document = await (callback as NonNullable<ContentRemoteSource["update"]>)(
            id,
            patch,
          );
          try {
            await validateAgainstSchema(registration.schema, document.data);
          } catch (error) {
            await settleWrite(undefined);
            throw error;
          }
          return settleWrite(document);
        },
        delete: async (id: string) => {
          const { callback } = requireWritableSource(name, "delete");
          await (callback as NonNullable<ContentRemoteSource["delete"]>)(id);
          await settleWrite(undefined);
        },
      });
      handles.set(name, handle);
    }
    return handle;
  };

  // Runtimes probe objects with protocol keys: await checks `then`,
  // JSON.stringify checks `toJSON`, test matchers poke a few more. Those
  // probes must see undefined; only a real unknown collection name throws.
  const collectionsProxy = new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      if (!(property in collections) && PROTOCOL_PROBE_KEYS.has(property)) return undefined;
      return collectionHandle(property);
    },
    has: (_target, property) => typeof property === "string" && property in collections,
    ownKeys: () => Object.keys(collections),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  });

  return Object.freeze({ getCollection, getEntry, getEntryOrThrow, collections: collectionsProxy });
}
