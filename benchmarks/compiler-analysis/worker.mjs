import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadavg } from "node:os";
import { pathToFileURL } from "node:url";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const config = JSON.parse(readFileSync(0, "utf8"));
assert(Number.isInteger(config.warmups) && config.warmups >= 0 && config.warmups <= 5);
const inputSource = await readFile(config.inputsPath, "utf8");
assert.equal(hash(inputSource), config.inputsHash, "Input snapshot changed");
assert.equal(
  hash(await readFile(config.compilerPath)),
  config.compilerHash,
  "Compiler snapshot changed",
);
const inputs = JSON.parse(inputSource);
assert(inputs.length > 0, "No compiler inputs");
// Import just this sample's compiler, in a new process with its own Babel/JIT/GC state.
const { compileReactModule } = await import(pathToFileURL(config.compilerPath).href);
const compile = async () => {
  const results = [];
  for (const input of inputs) {
    results.push(await compileReactModule(input.source, input.id, config.options));
  }
  return results;
};
const fingerprint = (results) => results.map((result) => hash(JSON.stringify(result)));
let expected;
for (let warmup = 0; warmup < config.warmups; warmup++) {
  const outputs = fingerprint(await compile());
  if (expected) assert.deepEqual(outputs, expected, "Output changed during warm-up");
  expected = outputs;
}
const startLoad = loadavg();
const cpuStart = process.cpuUsage();
const started = performance.now();
const results = await compile();
const elapsedMs = performance.now() - started;
const cpu = process.cpuUsage(cpuStart);
const endLoad = loadavg();
// Hashing/assertions and all imports, snapshot I/O and warm-up are outside timing.
const outputs = fingerprint(results);
if (expected) assert.deepEqual(outputs, expected, "Output changed during measurement");
process.stdout.write(
  JSON.stringify({
    pid: process.pid,
    node: process.version,
    compilerHash: config.compilerHash,
    inputsHash: config.inputsHash,
    elapsedMs,
    cpuMs: (cpu.user + cpu.system) / 1000,
    startLoad,
    endLoad,
    outputs,
  }),
);
