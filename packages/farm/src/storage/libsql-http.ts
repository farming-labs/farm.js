/*! Includes @libsql/client/http 0.17.4, MIT License, https://github.com/tursodatabase/libsql-client-ts */
// Farm-managed storage only speaks HTTP, so core bundles this entry instead of asking apps to
// install the full client and its native SQLite binary.
export { createClient } from "@libsql/client/http";
