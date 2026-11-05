import { brotliCompressSync, gzipSync } from "node:zlib";

export function measureJavaScriptOutput(result) {
  const chunks = [result]
    .flat()
    .flatMap((output) => output.output)
    .filter((output) => output.type === "chunk");
  const byFile = new Map();
  for (const chunk of chunks) {
    if (byFile.has(chunk.fileName)) {
      throw new Error(
        `Duplicate JavaScript output filename: ${chunk.fileName}. Measure builds separately.`,
      );
    }
    byFile.set(chunk.fileName, chunk);
  }
  const entries = chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName);
  if (entries.length === 0) throw new Error("Size measurement requires a JavaScript entry chunk.");

  function reachable(includeDynamic) {
    const visited = new Set();
    const pending = [...entries];
    while (pending.length > 0) {
      const fileName = pending.pop();
      const chunk = byFile.get(fileName);
      // External imports and assets are outside the emitted-JavaScript budget.
      if (!chunk || visited.has(fileName)) continue;
      visited.add(fileName);
      pending.push(...chunk.imports);
      if (includeDynamic) pending.push(...chunk.dynamicImports);
    }
    return visited;
  }

  const initial = reachable(false);
  const allReachable = reachable(true);
  const empty = () => ({ raw: 0, gzip: 0, brotli: 0 });
  const total = empty();
  const chunkAccounting = { initial: empty(), deferred: empty(), unreferenced: empty(), files: [] };
  for (const chunk of chunks) {
    const bytes = Buffer.from(chunk.code);
    const measured = {
      raw: bytes.length,
      gzip: gzipSync(bytes, { level: 9 }).length,
      brotli: brotliCompressSync(bytes).length,
    };
    const loading = initial.has(chunk.fileName)
      ? "initial"
      : allReachable.has(chunk.fileName)
        ? "deferred"
        : "unreferenced";
    for (const key of ["raw", "gzip", "brotli"]) {
      total[key] += measured[key];
      chunkAccounting[loading][key] += measured[key];
    }
    chunkAccounting.files.push({ fileName: chunk.fileName, loading, ...measured });
  }
  return {
    // Concatenation is only for structural-marker checks, never byte accounting.
    code: chunks.map((chunk) => chunk.code).join("\n"),
    ...total,
    chunkAccounting,
  };
}
