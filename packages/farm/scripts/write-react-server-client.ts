import { promises as fs } from "node:fs";
import path from "node:path";
import { init, parse } from "es-module-lexer";

/**
 * Write `@farm.js/core/client` as React Server Components resolve it (the react-server
 * condition): a `"use client"` module re-exporting the client API by name, so a server component
 * that renders Link, or a module of hooks it imports, gets client references instead of running
 * client code (React contexts, browser globals) on the server. Next.js ships next/link the same
 * way. The names are read from the built entry, so they cannot drift from it.
 */
export async function writeReactServerClientEntry(distDir: string): Promise<void> {
  await init;
  const source = await fs.readFile(path.join(distDir, "client.mjs"), "utf8");
  const [, exports] = parse(source);
  const names = exports.map((entry) => entry.n).filter((name) => name && name !== "default");
  if (names.length === 0) throw new Error("dist/client.mjs exports nothing");
  await fs.writeFile(
    path.join(distDir, "client.react-server.mjs"),
    `"use client";\nexport { ${names.join(", ")} } from "./client.mjs";\n`,
  );
}
