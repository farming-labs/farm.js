import { isMountSchema } from "./mount-schema";
import type { Client } from "@libsql/core/api";
import type { SchemaDefinition } from "@farming-labs/orm";
import {
  databaseAccessor,
  mountSchema,
  managedOrm,
  managedSqliteName,
  managedSqliteDriver,
  type ManagedSqliteOptions,
  type ManagedSqliteMount,
} from "./managed-sqlite";
export type { ManagedSqliteOptions, ManagedSqliteMount } from "./managed-sqlite";
import { createStorage, prefixStorage, builtinDrivers, type BuiltinDriverName } from "unstorage";
import type { Driver, Storage, TransactionOptions } from "unstorage";
import type { Database } from "db0";
import memoryDriver from "unstorage/drivers/memory";
import type {
  FarmManagedDriverConfig,
  FarmManagedStorageOptions,
  FarmStorageNamedDriver,
  FarmStorageClient,
  FarmStorageClientConfig,
  FarmStorageConfigObject,
  FarmStorageLocalDriverConfig,
  FarmStorageBuiltinDriverConfig,
  FarmStorageDatabaseConfig,
  FarmStorageDatabaseDriverMap,
  FarmStorageDatabaseDriverName,
  FarmStorageRuntimeClient,
  FarmStorageMountConfig,
  FarmStorageMounts,
  FarmStorageUserConfig,
} from "./types";

export type {
  FarmStorageBuiltinDriverConfig,
  FarmManagedDriverConfig,
  FarmManagedStorageOptions,
  FarmStorageNamedDriver,
  FarmStorageClient,
  FarmStorageClientConfig,
  FarmStorageConfigObject,
  FarmStorageCustomDriverConfig,
  FarmStorageDatabaseConfig,
  FarmStorageDatabaseDriverName,
  FarmStorageLocalDriverConfig,
  FarmStorageRuntimeClient,
  FarmStorageMountConfig,
  FarmStorageMounts,
  FarmStorageUserConfig,
} from "./types";
export type {
  BuiltinDriverName,
  BuiltinDriverOptions,
  Driver,
  Storage,
  StorageMeta,
  StorageValue,
  TransactionOptions,
} from "unstorage";
export type { ConnectorName, ConnectorOptions, Database } from "db0";

type DriverFactoryModule = {
  default: (options?: Record<string, any>) => Driver;
};

type DriverResolver = () => Driver | Promise<Driver>;
type ModuleLoader = <T = any>(specifier: string) => Promise<T>;

// A production build bundles the driver modules its storage config names and
// registers them here as literal imports. Outside one, load them by name.
const STORAGE_MODULES_KEY = Symbol.for("farmjs.storage.modules");
type StorageModuleLoaders = Record<string, () => Promise<unknown>>;

function getRegisteredStorageModules(): StorageModuleLoaders | undefined {
  return (globalThis as Record<PropertyKey, unknown>)[STORAGE_MODULES_KEY] as
    | StorageModuleLoaders
    | undefined;
}

const loadModule: ModuleLoader = (specifier) => {
  const registered = getRegisteredStorageModules()?.[specifier];
  return (registered ? registered() : import(/* @vite-ignore */ specifier)) as Promise<any>;
};

/** @internal Register literal imports for the storage driver modules a build needs. */
export function _registerFarmStorageModules(loaders: StorageModuleLoaders): void {
  (globalThis as Record<PropertyKey, unknown>)[STORAGE_MODULES_KEY] = {
    ...getRegisteredStorageModules(),
    ...loaders,
  };
}

const DATABASE_CONNECTORS: {
  [K in FarmStorageDatabaseDriverName]: {
    connector: FarmStorageDatabaseDriverMap[K];
    module: string;
  };
} = {
  sqlite: {
    connector: "node-sqlite",
    module: "db0/connectors/node-sqlite",
  },
  "node-sqlite": {
    connector: "node-sqlite",
    module: "db0/connectors/node-sqlite",
  },
  sqlite3: {
    connector: "sqlite3",
    module: "db0/connectors/sqlite3",
  },
  "better-sqlite3": {
    connector: "better-sqlite3",
    module: "db0/connectors/better-sqlite3",
  },
  postgres: {
    connector: "postgresql",
    module: "db0/connectors/postgresql",
  },
  postgresql: {
    connector: "postgresql",
    module: "db0/connectors/postgresql",
  },
  pg: {
    connector: "postgresql",
    module: "db0/connectors/postgresql",
  },
  mysql: {
    connector: "mysql2",
    module: "db0/connectors/mysql2",
  },
  mysql2: {
    connector: "mysql2",
    module: "db0/connectors/mysql2",
  },
  pglite: {
    connector: "pglite",
    module: "db0/connectors/pglite",
  },
  planetscale: {
    connector: "planetscale",
    module: "db0/connectors/planetscale",
  },
  libsql: {
    connector: "libsql",
    module: "db0/connectors/libsql/node",
  },
  "libsql-node": {
    connector: "libsql-node",
    module: "db0/connectors/libsql/node",
  },
  "libsql-http": {
    connector: "libsql-http",
    module: "db0/connectors/libsql/http",
  },
};

function createMemoryStorage(): Storage {
  return createStorage({
    driver: memoryDriver(),
  });
}

const GLOBAL_STORAGE_KEY = Symbol.for("farmjs.storage.global");

function readGlobalStorage(): Storage | undefined {
  return (globalThis as unknown as Record<PropertyKey, Storage | undefined>)[GLOBAL_STORAGE_KEY];
}

function writeGlobalStorage(storage: Storage): Storage {
  (globalThis as unknown as Record<PropertyKey, Storage | undefined>)[GLOBAL_STORAGE_KEY] = storage;
  return storage;
}

function getActiveGlobalStorage(): Storage {
  const existing = readGlobalStorage();
  if (existing) {
    return existing;
  }
  return writeGlobalStorage(createMemoryStorage());
}

let globalStorage = getActiveGlobalStorage();

function normalizeMountKey(base?: string): string {
  return (base || "")
    .trim()
    .replace(/^[:/\\]+|[:/\\]+$/g, "")
    .replace(/[\\/]+/g, ":");
}

function isDriverInstance(value: unknown): value is Driver {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Driver).getItem === "function" &&
    typeof (value as Driver).getKeys === "function"
  );
}

function isStorageInstance(value: unknown): value is Storage {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Storage).mount === "function" &&
    typeof (value as Storage).getMount === "function"
  );
}

function isStorageClient(value: unknown): value is FarmStorageClient {
  return (
    !!value &&
    typeof value === "object" &&
    (value as FarmStorageClient).kind === "farm-storage-client" &&
    typeof (value as FarmStorageClient).resolveDriver === "function" &&
    typeof (value as FarmStorageClient).createStorage === "function"
  );
}

function isDatabaseDriverName(name: string): name is FarmStorageDatabaseDriverName {
  return name in DATABASE_CONNECTORS;
}

function extractDriverOptions(config: FarmStorageClientConfig): Record<string, any> | undefined {
  const source = config as Record<string, any>;
  const {
    client: _client,
    driver: _driver,
    mounts: _mounts,
    managed: _managed,
    options,
    tableName: _tableName,
    ...inlineOptions
  } = source;
  const hasInlineOptions = Object.keys(inlineOptions).length > 0;

  if (options && typeof options === "object" && !Array.isArray(options)) {
    return hasInlineOptions ? { ...inlineOptions, ...options } : options;
  }

  if (hasInlineOptions) {
    return inlineOptions;
  }

  return options;
}

async function loadBuiltinDriver(
  name: BuiltinDriverName,
  options?: Record<string, any>,
): Promise<Driver> {
  // The default driver, imported statically: loading it by name would leave a
  // bare `unstorage` import in a bundled server, which an app that does not
  // depend on unstorage itself cannot resolve.
  if (name === "memory") return memoryDriver();

  const modulePath = builtinDrivers[name];

  if (!modulePath) {
    throw new Error(`Unsupported storage driver "${name}".`);
  }

  const module = (await loadModule(modulePath)) as DriverFactoryModule;
  return module.default(options);
}

async function loadDatabaseDriver(config: FarmStorageDatabaseConfig): Promise<Driver> {
  const connectorEntry = DATABASE_CONNECTORS[config.driver as FarmStorageDatabaseDriverName];
  const [{ createDatabase }, connectorModule, db0DriverModule] = await Promise.all([
    loadModule<typeof import("db0")>("db0"),
    loadModule<{ default: (options?: any) => any }>(connectorEntry.module),
    loadModule<typeof import("unstorage/drivers/db0")>("unstorage/drivers/db0"),
  ]);

  const database = createDatabase(connectorModule.default(extractDriverOptions(config) || {}));
  const driver = db0DriverModule.default({
    database,
    tableName: config.tableName,
  });

  // Farm created this connection, so it is Farm's to close, exactly once. Newer db0
  // drivers dispose the database themselves; older ones have no dispose at all.
  return {
    ...driver,
    async dispose() {
      await database.dispose();
    },
  };
}

async function resolveDriver(config?: FarmStorageMountConfig, mount?: string): Promise<Driver> {
  if (config && isStorageClient(config)) {
    return config.resolveDriver();
  }

  const hosted = resolveManagedStorageMount(config);
  if (hosted) {
    if (!mount) throw new TypeError("Register managed SQLite in storage.mounts.");
    return managedSqliteDriver(
      managedSqliteName(mount, hosted.managed),
      () => import("./libsql-http"),
      hosted.schema,
    );
  }
  const driverInput = config?.driver ?? "memory";

  if (typeof driverInput === "function") {
    return await driverInput();
  }

  if (isDriverInstance(driverInput)) {
    return driverInput;
  }

  if (isDatabaseDriverName(driverInput)) {
    return loadDatabaseDriver(config as FarmStorageDatabaseConfig);
  }

  if (driverInput === "local") {
    return loadBuiltinDriver("fs-lite", extractDriverOptions(config as FarmStorageClientConfig));
  }

  return loadBuiltinDriver(
    driverInput as BuiltinDriverName,
    extractDriverOptions(config as FarmStorageClientConfig),
  );
}

// The driver modules a Farm-built storage client loads, so a production build
// can bundle them. A client from defineStorageClient imports its own driver.
const STORAGE_CLIENT_MODULES_KEY = Symbol.for("farmjs.storage.clientModules");

function createStorageClientFromResolver(
  resolveDriver: DriverResolver,
  modules: readonly string[] = [],
): FarmStorageClient {
  let driverPromise: Promise<Driver> | undefined;
  let storagePromise: Promise<Storage> | undefined;

  const ensureDriver = () => {
    if (driverPromise) return driverPromise;

    const pending = Promise.resolve().then(resolveDriver);
    driverPromise = pending;
    void pending.catch(() => {
      if (driverPromise === pending) {
        driverPromise = undefined;
        storagePromise = undefined;
      }
    });
    return pending;
  };

  const ensureStorage = () => {
    if (storagePromise) return storagePromise;

    const pending = ensureDriver().then((driver) =>
      createStorage({
        driver,
      }),
    );
    storagePromise = pending;
    void pending.catch(() => {
      if (storagePromise === pending) storagePromise = undefined;
    });
    return pending;
  };

  const target = {
    kind: "farm-storage-client" as const,
    ready: ensureStorage,
    createStorage: ensureStorage,
    resolveDriver: ensureDriver,
    [STORAGE_CLIENT_MODULES_KEY]: modules,
  };

  return new Proxy(target as unknown as FarmStorageClient, {
    get(currentTarget, prop, receiver) {
      if (prop === "then") {
        return undefined;
      }

      if (Reflect.has(currentTarget, prop)) {
        return Reflect.get(currentTarget, prop, receiver);
      }

      return (...args: any[]) =>
        ensureStorage().then(async (storage) => {
          const member = Reflect.get(storage as object, prop);

          if (typeof member !== "function") {
            return member;
          }

          const result = Reflect.apply(member, storage, args);

          if (prop === "dispose") {
            return Promise.resolve(result).finally(() => {
              // Disposing the storage also disposed the driver, so drop both
              // cached promises: a later call must re-run the driver factory
              // instead of rebuilding storage over the dead driver.
              storagePromise = undefined;
              driverPromise = undefined;
            });
          }

          return result;
        });
    },
  });
}

export function defineStorageClient(resolveDriver: DriverResolver): FarmStorageClient {
  return createStorageClientFromResolver(resolveDriver);
}

function configuredStorageClient(config: FarmStorageClientConfig | FarmManagedDriverConfig) {
  const hosted = resolveManagedStorageMount(config);
  if (hosted) return hosted;
  return createStorageClientFromResolver(
    () => resolveDriver(config),
    _collectFarmStorageModules(config as FarmStorageUserConfig),
  );
}

type BareMount = Omit<ManagedSqliteMount, "schema">;
type MountWithSchema<S extends SchemaDefinition> = BareMount & {
  schema: S;
};

export function createStorageClient<S extends SchemaDefinition>(
  config: FarmManagedDriverConfig & { schema: S },
): MountWithSchema<S>;
export function createStorageClient(
  config: FarmManagedDriverConfig & { schema?: undefined },
): BareMount;
export function createStorageClient<S extends SchemaDefinition>(
  config: FarmManagedDriverConfig & { schema?: S },
): BareMount | MountWithSchema<S>;
export function createStorageClient(config: FarmStorageClientConfig): FarmStorageClient;
export function createStorageClient(config: FarmManagedDriverConfig | FarmStorageClientConfig) {
  return configuredStorageClient(config);
}

export function driverStorage(
  driver: Driver | (() => Driver | Promise<Driver>),
): FarmStorageClient {
  return defineStorageClient(() => (typeof driver === "function" ? driver() : driver));
}

export function databaseStorage(
  database: Database,
  options: { tableName?: string } = {},
): FarmStorageClient {
  return createStorageClientFromResolver(async () => {
    const db0DriverModule =
      await loadModule<typeof import("unstorage/drivers/db0")>("unstorage/drivers/db0");
    // The caller owns this database. Newer db0 drivers close their database on
    // dispose, so drop that hook and leave the connection open.
    const { dispose: _dispose, ...driver } = db0DriverModule.default({
      database,
      tableName: options.tableName,
    });
    return driver;
  }, ["unstorage/drivers/db0"]);
}

type FarmStorageOptions = { managed?: true; namespace?: string; schema?: SchemaDefinition };

function assertMountSchema(schema: unknown): asserts schema is SchemaDefinition | undefined {
  if (schema !== undefined && !isMountSchema(schema)) {
    throw new TypeError("Pass a schema created with defineSchema() from @farming-labs/orm.");
  }
}

/** A Farm-hosted SQL and key-value mount. The mount name is its default namespace. */
export function farmStorage<S extends SchemaDefinition>(
  options: FarmStorageOptions & { schema: S },
): MountWithSchema<S>;
export function farmStorage(options?: FarmStorageOptions & { schema?: undefined }): BareMount;
export function farmStorage<S extends SchemaDefinition>(
  options: FarmStorageOptions & { schema?: S },
): BareMount | MountWithSchema<S>;
export function farmStorage(options: FarmStorageOptions = {}): ManagedSqliteMount {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => key !== "namespace" && key !== "managed" && key !== "schema")
  )
    throw new TypeError(
      "Use farmStorage() or pass only the `managed`, `namespace`, and `schema` options.",
    );
  if (options.managed !== undefined && options.managed !== true)
    throw new TypeError("Set `managed` to true or omit it when using farmStorage().");
  assertMountSchema(options.schema);
  return createManagedMount(options.namespace, options.schema, "farm");
}

function createManagedMount(
  namespace: string | undefined,
  schema: SchemaDefinition | undefined,
  declaredDriver?: string,
): ManagedSqliteMount {
  const managed = namespace === undefined ? true : { name: namespace };
  if (managed !== true) managedSqliteName("", managed);
  return {
    driver: "farm-managed-sqlite",
    managed,
    ...(declaredDriver && { declaredDriver }),
    ...(schema && { schema }),
  };
}

/** @internal Resolve the same hosted descriptor for the CLI, the bundler, and the runtime. */
export function resolveManagedStorageMount(config: unknown): ManagedSqliteMount | undefined {
  if (!config || typeof config !== "object") return;
  if (
    "schema" in config &&
    isMountSchema(config.schema) &&
    (!("managed" in config) || !config.managed)
  ) {
    throw new TypeError(
      "Set `managed: true` or use farmStorage({ schema }) to bind an ORM schema.",
    );
  }
  if (!("managed" in config)) {
    if ("driver" in config && config.driver === "farm-managed-sqlite")
      throw new TypeError("Set `managed` to true on a hosted storage mount.");
    return;
  }
  const { driver, managed, ...options } = config as Record<string, unknown>;
  if ((managed === false || managed === undefined) && driver !== "farm-managed-sqlite") return;
  if (driver !== "farm-managed-sqlite" && !isHostedDriver(driver))
    throw new TypeError("Select a built-in storage driver to use `managed: true`.");
  const declaredDriver = driver === "farm-managed-sqlite" ? options.declaredDriver : driver;
  if (driver === "farm-managed-sqlite") {
    delete options.declaredDriver;
    if (
      declaredDriver !== undefined &&
      declaredDriver !== "farm" &&
      !isHostedDriver(declaredDriver)
    )
      throw new TypeError("Use a known storage driver in the managed mount descriptor.");
  }
  if (Object.keys(options).some((key) => key !== "namespace" && key !== "schema"))
    throw new TypeError(
      "Remove provider connection settings and driver options when using `managed: true`.",
    );
  assertMountSchema(options.schema);
  let namespace: string | undefined;
  if (managed === true) namespace = options.namespace as string | undefined;
  else if ((driver === "sqlite" || driver === "farm-managed-sqlite") && !("namespace" in options))
    namespace = managedSqliteName("", managed);
  else
    throw new TypeError("Set `managed` to true and use `namespace` to select a hosted resource.");
  return createManagedMount(
    namespace,
    options.schema,
    typeof declaredDriver === "string" ? declaredDriver : undefined,
  );
}

function isHostedDriver(driver: unknown): driver is string {
  return (
    typeof driver === "string" &&
    (driver === "local" ||
      driver === "vercel-kv" ||
      Object.prototype.hasOwnProperty.call(DATABASE_CONNECTORS, driver) ||
      (driver !== "db0" && Object.prototype.hasOwnProperty.call(builtinDrivers, driver)))
  );
}

type NativeOptions<D extends FarmStorageNamedDriver> = (D extends FarmStorageDatabaseDriverName
  ? Omit<FarmStorageDatabaseConfig, "driver">
  : D extends "local"
    ? Omit<FarmStorageLocalDriverConfig, "driver">
    : Omit<Extract<FarmStorageBuiltinDriverConfig, { driver: D }>, "driver">) & { managed?: false };

function providerStorage<D extends FarmStorageNamedDriver>(driver: D) {
  type HostedOptions =
    | FarmManagedStorageOptions
    | (D extends "sqlite" ? ManagedSqliteOptions : never);
  function storage<S extends SchemaDefinition>(
    options: HostedOptions & { schema: S },
  ): MountWithSchema<S>;
  function storage(options: HostedOptions & { schema?: undefined }): BareMount;
  function storage<S extends SchemaDefinition>(
    options: HostedOptions & { schema?: S },
  ): BareMount | MountWithSchema<S>;
  function storage(
    ...args: D extends "memory" | "local"
      ? [options?: NativeOptions<D>]
      : [options: NativeOptions<D>]
  ): FarmStorageClient;
  function storage(options?: object) {
    return configuredStorageClient({ ...options, driver } as
      | FarmManagedDriverConfig
      | FarmStorageClientConfig);
  }
  return storage;
}

export const memoryStorage = providerStorage("memory");
export const localStorage = providerStorage("local");
export const sqliteStorage = providerStorage("sqlite");
export const mysqlStorage = providerStorage("mysql");
export const mysql2Storage = mysqlStorage;
export const postgresStorage = providerStorage("postgres");
export const pgStorage = postgresStorage;
export const pgliteStorage = providerStorage("pglite");
export const planetscaleStorage = providerStorage("planetscale");
export const libsqlStorage = providerStorage("libsql");
export const redisStorage = providerStorage("redis");
export const s3Storage = providerStorage("s3");
export const mongodbStorage = providerStorage("mongodb");
export const upstashStorage = providerStorage("upstash");
export const netlifyBlobsStorage = providerStorage("netlify-blobs");
export const vercelKVStorage = providerStorage("vercel-kv");
export const vercelBlobStorage = providerStorage("vercel-blob");

function collectDriverModules(config: unknown, modules: Set<string>): void {
  if (!config || typeof config !== "object") return;
  // Before the instance check: a client proxies every Storage method.
  if (isStorageClient(config)) {
    const clientModules = (config as unknown as Record<PropertyKey, unknown>)[
      STORAGE_CLIENT_MODULES_KEY
    ];
    if (Array.isArray(clientModules)) for (const module of clientModules) modules.add(module);
    return;
  }
  if (isStorageInstance(config)) return;

  const source = config as Record<string, unknown>;
  const driver = source.driver;
  // Core bundles the hosted client, so a managed mount adds no module of its own.
  if (typeof driver === "string" && !resolveManagedStorageMount(config)) {
    if (isDatabaseDriverName(driver)) {
      modules.add("db0");
      modules.add(DATABASE_CONNECTORS[driver].module);
      modules.add("unstorage/drivers/db0");
    } else if (driver !== "memory") {
      const module = builtinDrivers[(driver === "local" ? "fs-lite" : driver) as BuiltinDriverName];
      if (module) modules.add(module);
    }
  }
  collectDriverModules(source.client, modules);
  if (source.mounts && typeof source.mounts === "object") {
    for (const mount of Object.values(source.mounts)) collectDriverModules(mount, modules);
  }
}

/**
 * @internal The driver modules `config` loads by name. A production build
 * imports each one literally so the server bundle contains it.
 */
export function _collectFarmStorageModules(config: FarmStorageUserConfig | undefined): string[] {
  const modules = new Set<string>();
  collectDriverModules(config, modules);
  return [...modules];
}

async function mountNamespaces(storage: Storage, mounts?: FarmStorageMounts): Promise<void> {
  if (!mounts) {
    return;
  }

  for (const [base, config] of Object.entries(mounts)) {
    storage.mount(normalizeMountKey(base), await resolveDriver(config, base));
  }
}

export async function createFarmStorage(config: FarmStorageUserConfig = {}): Promise<Storage> {
  if (isStorageInstance(config)) {
    return config;
  }

  if (isStorageClient(config)) {
    return config.createStorage();
  }

  const rootConfig = isStorageClient(config.client) ? config.client : config;
  const storage = createStorage({
    driver: await resolveDriver(rootConfig),
  });

  try {
    await mountNamespaces(storage, config.mounts);
  } catch (error) {
    await storage.dispose().catch(() => {});
    throw error;
  }
  return storage;
}

export async function resolveStorageRuntimeClient(
  config: FarmStorageUserConfig | undefined,
): Promise<unknown | undefined> {
  if (!config || isStorageInstance(config) || isStorageClient(config)) {
    return undefined;
  }

  const client = config.client;
  if (!client || isStorageInstance(client) || isStorageClient(client)) {
    return undefined;
  }

  return typeof client === "function" ? await client() : client;
}

export async function initStorage(config: FarmStorageUserConfig = {}): Promise<Storage> {
  globalStorage = getActiveGlobalStorage();
  const nextStorage = await createFarmStorage(config);
  const previousStorage = globalStorage;
  globalStorage = writeGlobalStorage(nextStorage);

  if (previousStorage !== nextStorage) {
    await previousStorage.dispose().catch(() => {});
  }

  return globalStorage;
}

declare global {
  namespace FarmJS {
    /** @internal Mount declarations registered by the application's generated farm.d.ts. */
    interface StorageRegistry {}
  }
}

type AppMounts = FarmJS.StorageRegistry extends { mounts: infer M } ? M : {};
type DatabaseForMount<M> = M extends { schema: infer S extends SchemaDefinition }
  ? Awaited<ReturnType<typeof managedOrm<S>>>
  : Client;
type DatabaseForName<N extends string> = N extends keyof AppMounts
  ? DatabaseForMount<AppMounts[N]>
  : Client | DatabaseForMount<AppMounts[keyof AppMounts]>;

export function getDatabase<N extends string>(name: N): Promise<DatabaseForName<N>>;
export function getDatabase(name: string, options: { raw: true }): Promise<Client>;
export function getDatabase<S extends SchemaDefinition<any>>(
  name: string,
  options: { schema: S },
): ReturnType<typeof managedOrm<S>>;
export async function getDatabase<S extends SchemaDefinition<any>>(
  name: string,
  options?: { schema: S } | { raw: true },
) {
  const key = normalizeMountKey(name);
  const mount = getActiveGlobalStorage().getMount(key);
  const driver = mount.driver as Partial<ReturnType<typeof managedSqliteDriver>>;
  if (!key || normalizeMountKey(mount.base) !== key || !driver[databaseAccessor])
    throw new TypeError(
      "Configure a managed SQLite mount named " +
        JSON.stringify(name) +
        " before calling getDatabase().",
    );
  const client = await driver[databaseAccessor]();
  if (options && "raw" in options) return client;
  const schema = options?.schema ?? driver[mountSchema];
  return schema ? managedOrm(client, schema) : client;
}

export function getStorage(namespace?: string): Storage {
  globalStorage = getActiveGlobalStorage();
  const base = normalizeMountKey(namespace);
  if (!base) {
    // A name made only of separators or spaces is not "no namespace": handing
    // back the root store would expose every other namespace's keys.
    if (namespace) {
      throw new TypeError(
        `getStorage(${JSON.stringify(namespace)}) names no namespace. ` +
          "Pass a non-empty name, or call getStorage() for the root store.",
      );
    }
    return globalStorage;
  }

  const namespaced = prefixStorage(globalStorage, base);
  // prefixStorage re-prefixes the key methods, but copies dispose/watch/getMount(s)
  // straight from the parent, so on a namespaced view they operate on the whole
  // global store: dispose() tears down every namespace, watch() sees (and leaks
  // the raw keys of) every other namespace's writes, getMounts() lists them all.
  // Scope those too, so a handle handed out as "namespace X" stays confined to X.
  const store = globalStorage;
  const prefix = `${base}:`;
  const stripPrefix = (key: string) => (key.startsWith(prefix) ? key.slice(prefix.length) : key);
  const viewUnwatchers = new Set<Awaited<ReturnType<Storage["watch"]>>>();
  const releaseViewWatchers = async () => {
    const current = [...viewUnwatchers];
    viewUnwatchers.clear();
    await Promise.all(current.map((unwatch) => unwatch()));
  };

  return {
    ...namespaced,
    // Scope the wipe to the namespace instead of the whole storage, and keep
    // the caller's base so `clear("sessions")` cannot take unrelated keys with
    // it. Dropping the argument silently widens a targeted clear into a
    // namespace-wide delete.
    async clear(base?: string, opts?: TransactionOptions) {
      const keys = await namespaced.getKeys(base);
      await Promise.all(keys.map((key) => namespaced.removeItem(key, opts)));
    },
    async watch(callback) {
      const unwatch = await store.watch((event, key) => {
        if (key.startsWith(prefix)) callback(event, stripPrefix(key));
      });
      viewUnwatchers.add(unwatch);
      return async () => {
        viewUnwatchers.delete(unwatch);
        await unwatch();
      };
    },
    async unwatch() {
      await releaseViewWatchers();
    },
    async dispose() {
      // A namespaced view shares the global store's lifecycle and owns no
      // drivers, so disposing it must not tear down the global store (that is
      // what disposeStorage is for). Release only this view's watchers.
      await releaseViewWatchers();
    },
    getMount(key = "") {
      return store.getMount(prefix + key);
    },
    getMounts(base = "", options) {
      return store
        .getMounts(prefix + base, options)
        .map((mount) => ({ ...mount, base: stripPrefix(mount.base) }));
    },
  } as Storage;
}

export async function disposeStorage(): Promise<void> {
  globalStorage = getActiveGlobalStorage();
  const previousStorage = globalStorage;
  globalStorage = writeGlobalStorage(createMemoryStorage());
  await previousStorage.dispose().catch(() => {});
}
