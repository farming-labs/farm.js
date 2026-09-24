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
  return (scope[WRITE_RUNTIME_KEY] ??= { registrations: {} });
}

export function registerContentWriteRuntime(
  registrations: Record<string, ContentWriteRegistration>,
): void {
  Object.assign(writeRuntime().registrations, registrations);
}

export function setContentAfterWrite(afterWrite: (() => Promise<void>) | undefined): void {
  writeRuntime().afterWrite = afterWrite;
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
  // visible on the next build - pair writes with a deploy hook.
  await writeRuntime().afterWrite?.();
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
          await validateAgainstSchema(registration.schema, document.data);
          return settleWrite(document);
        },
        update: async (id: string, patch: { data?: Record<string, unknown>; body?: string }) => {
          const { callback, registration } = requireWritableSource(name, "update");
          const document = await (callback as NonNullable<ContentRemoteSource["update"]>)(
            id,
            patch,
          );
          await validateAgainstSchema(registration.schema, document.data);
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

  const collectionsProxy = new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      return collectionHandle(property);
    },
    has: (_target, property) => typeof property === "string" && property in collections,
    ownKeys: () => Object.keys(collections),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  });

  return Object.freeze({ getCollection, getEntry, getEntryOrThrow, collections: collectionsProxy });
}
