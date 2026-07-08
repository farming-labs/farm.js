import { copyFile, readdir } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
const files = await readdir(dist);
const declaration = files.find((file) => /^index-.+\.d\.ts$/.test(file));

if (declaration) {
  await copyFile(new URL(declaration, dist), new URL("index.d.ts", dist));
}
