import { readFile, writeFile } from "node:fs/promises";
import wabt from "wabt";

// This demo compiles a tiny, reviewable fixture. The Farm plugin consumes
// prebuilt Wasm modules; it does not install Rust or compile application Rust.
const source = new URL("../src/wasm/math.wat", import.meta.url);
const compiler = await wabt();
const module = compiler.parseWat("math.wat", await readFile(source, "utf8"));
try {
  await writeFile(new URL("../src/wasm/math.wasm", import.meta.url), module.toBinary({}).buffer);
} finally {
  module.destroy();
}
