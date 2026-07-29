globalThis.__webpack_require__ = function benchmarkModuleLoader() {
  throw new Error("This host-only fixture cannot request Client Component modules");
};
globalThis.__webpack_require__.u = (chunkId) => String(chunkId);
