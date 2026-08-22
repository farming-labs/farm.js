import { createStorage, prefixStorage, builtinDrivers, type BuiltinDriverName } from "unstorage";
import type { Driver, Storage } from "unstorage";
import type { Database } from "db0";
import memoryDriver from "unstorage/drivers/memory";
import type {
  FarmStorageClient,
  FarmStorageClientConfig,
  FarmStorageConfigObject,
  FarmStorageLocalDriverConfig,
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

const loadModule: ModuleLoader = (specifier) => import(/* @vite-ignore */ specifier);

const DATABASE_CONNECTORS: {
  [K in FarmStorageDatabaseDriverName]: {
    connector: FarmStorageDatabaseDriverMap[K];
    load: () => Promise<{ default: (options?: any) => any }>;
  };
} = {
  sqlite: {
    connector: "node-sqlite",
    load: () => loadModule("db0/connectors/node-sqlite"),
  },
  "node-sqlite": {
    connector: "node-sqlite",
    load: () => loadModule("db0/connectors/node-sqlite"),
  },
  sqlite3: {
    connector: "sqlite3",
    load: () => loadModule("db0/connectors/sqlite3"),
  },
  "better-sqlite3": {
    connector: "better-sqlite3",
    load: () => loadModule("db0/connectors/better-sqlite3"),
  },
  postgres: {
    connector: "postgresql",
    load: () => loadModule("db0/connectors/postgresql"),
  },
  postgresql: {
    connector: "postgresql",
    load: () => loadModule("db0/connectors/postgresql"),
  },
  pg: {
    connector: "postgresql",
    load: () => loadModule("db0/connectors/postgresql"),
  },
  mysql: {
    connector: "mysql2",
    load: () => loadModule("db0/connectors/mysql2"),
  },
  mysql2: {
    connector: "mysql2",
    load: () => loadModule("db0/connectors/mysql2"),
  },
  pglite: {
    connector: "pglite",
    load: () => loadModule("db0/connectors/pglite"),
  },
  planetscale: {
    connector: "planetscale",
    load: () => loadModule("db0/connectors/planetscale"),
  },
  libsql: {
    connector: "libsql",
    load: () => loadModule("db0/connectors/libsql/node"),
  },
  "libsql-node": {
    connector: "libsql-node",
    load: () => loadModule("db0/connectors/libsql/node"),
  },
  "libsql-http": {
    connector: "libsql-http",
    load: () => loadModule("db0/connectors/libsql/http"),
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
    connectorEntry.load(),
    loadModule<typeof import("unstorage/drivers/db0")>("unstorage/drivers/db0"),
  ]);

  const database = createDatabase(connectorModule.default(extractDriverOptions(config) || {}));
  const driver = db0DriverModule.default({
    database,
    tableName: config.tableName,
  });

  // The db0 driver has no dispose, so this connection is Farm's to close. Databases
  // handed to `databaseStorage` stay owned by the caller and are left open.
  return {
    ...driver,
    async dispose() {
      await driver.dispose?.();
      await database.dispose();
    },
  };
}

async function resolveDriver(config?: FarmStorageMountConfig): Promise<Driver> {
  if (config && isStorageClient(config)) {
    return config.resolveDriver();
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
    return loadBuiltinDriver("fs-lite", extractDriverOptions(config as FarmStorageMountConfig));
  }

  return loadBuiltinDriver(
    driverInput as BuiltinDriverName,
    extractDriverOptions(config as FarmStorageClientConfig),
  );
}

function createStorageClientFromResolver(resolveDriver: DriverResolver): FarmStorageClient {
  let driverPromise: Promise<Driver> | undefined;
  let storagePromise: Promise<Storage> | undefined;

  const ensureDriver = async () => {
    driverPromise ??= Promise.resolve(resolveDriver());
    return driverPromise;
  };

  const ensureStorage = async () => {
    storagePromise ??= ensureDriver().then((driver) =>
      createStorage({
        driver,
      }),
    );
    return storagePromise;
  };

  const target = {
    kind: "farm-storage-client" as const,
    ready: ensureStorage,
    createStorage: ensureStorage,
    resolveDriver: ensureDriver,
  };

  return new Proxy(target as FarmStorageClient, {
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
              storagePromise = undefined;
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

export function createStorageClient(config: FarmStorageClientConfig): FarmStorageClient {
  return defineStorageClient(() => resolveDriver(config));
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
  return defineStorageClient(async () => {
    const db0DriverModule =
      await loadModule<typeof import("unstorage/drivers/db0")>("unstorage/drivers/db0");
    return db0DriverModule.default({
      database,
      tableName: options.tableName,
    });
  });
}

export function memoryStorage(): FarmStorageClient {
  return createStorageClient({ driver: "memory" });
}

export function localStorage(options: Omit<FarmStorageLocalDriverConfig, "driver"> = {}) {
  return createStorageClient({
    driver: "local",
    ...options,
  });
}

export function sqliteStorage(options: Omit<FarmStorageDatabaseConfig, "driver">) {
  return createStorageClient({
    driver: "sqlite",
    ...options,
  });
}

export function mysqlStorage(options: Omit<FarmStorageDatabaseConfig, "driver">) {
  return createStorageClient({
    driver: "mysql",
    ...options,
  });
}

export function mysql2Storage(options: Omit<FarmStorageDatabaseConfig, "driver">) {
  return mysqlStorage(options);
}

export function postgresStorage(options: Omit<FarmStorageDatabaseConfig, "driver">) {
  return createStorageClient({
    driver: "postgres",
    ...options,
  });
}

export function pgStorage(options: Omit<FarmStorageDatabaseConfig, "driver">) {
  return postgresStorage(options);
}

export function pgliteStorage(options: Omit<FarmStorageDatabaseConfig, "driver">) {
  return createStorageClient({
    driver: "pglite",
    ...options,
  });
}

export function planetscaleStorage(options: Omit<FarmStorageDatabaseConfig, "driver">) {
  return createStorageClient({
    driver: "planetscale",
    ...options,
  });
}

export function libsqlStorage(options: Omit<FarmStorageDatabaseConfig, "driver">) {
  return createStorageClient({
    driver: "libsql",
    ...options,
  });
}

export function redisStorage(
  options: Omit<Extract<FarmStorageClientConfig, { driver: "redis" }>, "driver">,
) {
  return createStorageClient({
    driver: "redis",
    ...options,
  });
}

export function s3Storage(
  options: Omit<Extract<FarmStorageClientConfig, { driver: "s3" }>, "driver">,
) {
  return createStorageClient({
    driver: "s3",
    ...options,
  });
}

export function mongodbStorage(
  options: Omit<Extract<FarmStorageClientConfig, { driver: "mongodb" }>, "driver">,
) {
  return createStorageClient({
    driver: "mongodb",
    ...options,
  });
}

export function upstashStorage(
  options: Omit<Extract<FarmStorageClientConfig, { driver: "upstash" }>, "driver">,
) {
  return createStorageClient({
    driver: "upstash",
    ...options,
  });
}

export function netlifyBlobsStorage(
  options: Omit<Extract<FarmStorageClientConfig, { driver: "netlify-blobs" }>, "driver">,
) {
  return createStorageClient({
    driver: "netlify-blobs",
    ...options,
  });
}

export function vercelKVStorage(
  options: Omit<Extract<FarmStorageClientConfig, { driver: "vercel-kv" }>, "driver">,
) {
  return createStorageClient({
    driver: "vercel-kv",
    ...options,
  });
}

export function vercelBlobStorage(
  options: Omit<Extract<FarmStorageClientConfig, { driver: "vercel-blob" }>, "driver">,
) {
  return createStorageClient({
    driver: "vercel-blob",
    ...options,
  });
}

async function mountNamespaces(storage: Storage, mounts?: FarmStorageMounts): Promise<void> {
  if (!mounts) {
    return;
  }

  for (const [base, config] of Object.entries(mounts)) {
    storage.mount(normalizeMountKey(base), await resolveDriver(config));
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

  await mountNamespaces(storage, config.mounts);
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

export function getStorage(namespace?: string): Storage {
  globalStorage = getActiveGlobalStorage();
  const base = normalizeMountKey(namespace);
  if (!base) {
    return globalStorage;
  }

  const namespaced = prefixStorage(globalStorage, base);
  return {
    ...namespaced,
    async clear() {
      const keys = await namespaced.getKeys();
      await Promise.all(keys.map((key) => namespaced.removeItem(key)));
    },
  } as Storage;
}

export async function disposeStorage(): Promise<void> {
  globalStorage = getActiveGlobalStorage();
  const previousStorage = globalStorage;
  globalStorage = writeGlobalStorage(createMemoryStorage());
  await previousStorage.dispose().catch(() => {});
}
