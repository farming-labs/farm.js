import type { ConnectorOptions } from "db0";
import type { BuiltinDriverName, BuiltinDriverOptions, Driver, Storage } from "unstorage";

type ObjectShape<T> = T extends object ? T : Record<string, never>;

type FarmStorageBuiltinDriverWithoutDB0 = Exclude<
  Extract<BuiltinDriverName, keyof BuiltinDriverOptions>,
  "db0"
>;

type FarmStorageBuiltinDriverConfigMap = {
  [K in FarmStorageBuiltinDriverWithoutDB0]: {
    driver: K;
    options?: BuiltinDriverOptions[K];
  } & Partial<ObjectShape<BuiltinDriverOptions[K]>>;
};

export type FarmStorageDatabaseDriverMap = {
  sqlite: "node-sqlite";
  "node-sqlite": "node-sqlite";
  sqlite3: "sqlite3";
  "better-sqlite3": "better-sqlite3";
  postgres: "postgresql";
  postgresql: "postgresql";
  pg: "postgresql";
  mysql: "mysql2";
  mysql2: "mysql2";
  pglite: "pglite";
  planetscale: "planetscale";
  libsql: "libsql";
  "libsql-node": "libsql-node";
  "libsql-http": "libsql-http";
};

export type FarmStorageDatabaseDriverName = keyof FarmStorageDatabaseDriverMap;

type FarmStorageDatabaseConfigMap = {
  [K in FarmStorageDatabaseDriverName]: {
    driver: K;
    options?: ConnectorOptions[FarmStorageDatabaseDriverMap[K]];
    tableName?: string;
  } & Partial<ObjectShape<ConnectorOptions[FarmStorageDatabaseDriverMap[K]]>>;
};

export type FarmStorageMemoryDriverConfig = {
  driver?: "memory";
};

export type FarmStorageLocalDriverConfig = {
  driver: "local";
  options?: BuiltinDriverOptions["fs-lite"];
} & Partial<ObjectShape<BuiltinDriverOptions["fs-lite"]>>;

export type FarmStorageDB0DriverConfig = {
  driver: "db0";
  options: BuiltinDriverOptions["db0"];
};

export type FarmStorageBuiltinDriverConfig =
  | FarmStorageMemoryDriverConfig
  | FarmStorageLocalDriverConfig
  | FarmStorageDB0DriverConfig
  | FarmStorageBuiltinDriverConfigMap[FarmStorageBuiltinDriverWithoutDB0];

export interface FarmStorageClient extends Storage {
  readonly kind: "farm-storage-client";
  ready(): Promise<Storage>;
  createStorage(): Promise<Storage>;
  resolveDriver(): Promise<Driver>;
}

export interface FarmStorageCustomDriverConfig {
  driver: Driver | (() => Driver | Promise<Driver>);
}

export type FarmStorageDatabaseConfig = FarmStorageDatabaseConfigMap[FarmStorageDatabaseDriverName];

export type FarmStorageClientConfig =
  | FarmStorageBuiltinDriverConfig
  | FarmStorageDatabaseConfig
  | FarmStorageCustomDriverConfig;

export type FarmStorageMountConfig = FarmStorageClientConfig | FarmStorageClient;

export type FarmStorageMounts = Record<string, FarmStorageMountConfig>;

export type FarmStorageConfigObject = FarmStorageClientConfig & {
  client?: FarmStorageClient;
  mounts?: FarmStorageMounts;
};

export type FarmStorageUserConfig = FarmStorageConfigObject | FarmStorageClient;
