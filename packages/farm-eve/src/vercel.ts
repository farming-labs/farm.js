import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const EVE_VERCEL_RUNNER = `
import { withEve } from "eve/next";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const options = JSON.parse(
  Buffer.from(process.argv[1], "base64url").toString("utf8"),
);
const projectPath = join(process.cwd(), ".vercel", "project.json");
let createdProjectMarker = false;

try {
  await readFile(projectPath, "utf8");
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  await mkdir(join(process.cwd(), ".vercel"), { recursive: true });
  await writeFile(projectPath, "{}\\n");
  createdProjectMarker = true;
}

try {
  const resolveConfig = withEve({}, options);
  await resolveConfig("phase-production-build", {});
} finally {
  if (createdProjectMarker) await rm(projectPath, { force: true });
}
`;

export interface EveVercelOutputOptions {
  root: string;
  agentRoot: string;
  servicePrefix?: string;
  buildCommand?: string;
  nodePath?: string;
  onOutput?(line: string, stream: "stdout" | "stderr"): void;
}

export async function writeEveVercelOutput(options: EveVercelOutputOptions): Promise<void> {
  const root = resolve(options.root);
  const outputConfigPath = join(root, ".vercel", "output", "config.json");
  await assertFarmVercelOutput(outputConfigPath);

  const serializedOptions = Buffer.from(
    JSON.stringify({
      eveRoot: resolve(root, options.agentRoot),
      ...(options.servicePrefix ? { servicePrefix: options.servicePrefix } : {}),
      ...(options.buildCommand ? { eveBuildCommand: options.buildCommand } : {}),
    }),
  ).toString("base64url");

  await runEveVercelAdapter({
    command: options.nodePath || process.execPath,
    cwd: root,
    encodedOptions: serializedOptions,
    onOutput: options.onOutput,
  });
  await assertEveService(outputConfigPath);
}

async function assertFarmVercelOutput(configPath: string): Promise<void> {
  try {
    await readFile(configPath, "utf8");
  } catch {
    throw new Error(
      `Farm Vercel output was not found at ${configPath}. Build with the vercel preset before composing Eve.`,
    );
  }
}

async function assertEveService(configPath: string): Promise<void> {
  const config = JSON.parse(await readFile(configPath, "utf8")) as {
    services?: Record<string, { framework?: string }> | Array<{ framework?: string }>;
  };
  const services = Array.isArray(config.services)
    ? config.services
    : Object.values(config.services || {});
  if (!services.some((service) => service.framework === "eve")) {
    throw new Error("Eve did not add its service to Farm's Vercel output.");
  }
}

async function runEveVercelAdapter(input: {
  command: string;
  cwd: string;
  encodedOptions: string;
  onOutput?: EveVercelOutputOptions["onOutput"];
}): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(
      input.command,
      ["--input-type=module", "--eval", EVE_VERCEL_RUNNER, input.encodedOptions],
      {
        cwd: input.cwd,
        env: {
          ...process.env,
          VERCEL: process.env.VERCEL || "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";

    const onData = (chunk: Buffer, stream: "stdout" | "stderr") => {
      const text = chunk.toString("utf8");
      output = `${output}${text}`.slice(-16_384);
      for (const line of text.split(/\r?\n/)) {
        if (line) input.onOutput?.(line, stream);
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => onData(chunk, "stdout"));
    child.stderr?.on("data", (chunk: Buffer) => onData(chunk, "stderr"));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      reject(
        new Error(
          `Eve Vercel output adapter failed (code ${String(code)}, signal ${String(signal)}).${output ? `\n${output.trim()}` : ""}`,
        ),
      );
    });
  });
}
