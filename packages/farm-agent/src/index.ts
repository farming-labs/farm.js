import { defineIntegration } from "@farm.js/core";
import type { AgentFramework, AgentUnitConfig } from "agent-unit";

import { registerAgentUnitConfig } from "./config.js";
import { createAgentPlugin } from "./plugin.js";

export type { AgentFramework };

/**
 * agent-unit's settings, minus what Farm owns: the host (`deploy.target`), the server and the
 * Nitro and Workers settings, which belong in farm.config.
 */
export interface AgentOptions extends Omit<
  AgentUnitConfig,
  "server" | "preset" | "runtime" | "cloudflare" | "nitro"
> {
  /** Where the agent API is mounted, under `/api`. It owns every path under it. Default `/api/agent`. */
  basePath?: string;
  /** The folder of agent files, relative to the app root. Default `agents` in `srcDir`. */
  agentsDir?: string;
}

export interface AgentInstance {
  readonly basePath: string;
  readonly framework?: AgentFramework;
}

const DEFAULT_BASE_PATH = "/api/agent";

function normalizeBasePath(value: string): string {
  if (!value.startsWith("/")) {
    throw new Error(`@farm.js/agent: basePath must start with "/", got "${value}".`);
  }
  const basePath = value.replace(/\/+$/, "");
  // The agents are API routes, so Farm's middleware and guards run for them.
  if (basePath !== "/api" && !basePath.startsWith("/api/")) {
    throw new Error(`@farm.js/agent: basePath must be under /api, got "${value}".`);
  }
  return basePath;
}

/**
 * Durable agents in a Farm app: the agents in `src/agents`, written with the AI SDK, Mastra,
 * LangGraph, the OpenAI Agents SDK or agent-unit's `defineAgent`, served under `basePath` in
 * `farm dev` and built by agent-unit into every deployment target.
 *
 * @example
 * integrations: { agent: agent({ framework: "ai-sdk", storage: { driver: "redis", url: process.env.REDIS_URL } }) }
 */
export function agent(options: AgentOptions = {}) {
  const basePath = normalizeBasePath(options.basePath ?? DEFAULT_BASE_PATH);
  const config: AgentUnitConfig & { basePath: string } = { ...options, basePath };
  const instance: AgentInstance = { basePath, framework: options.framework };
  // agent-unit's engine reads it from the server that evaluates farm.config (see ./config).
  registerAgentUnitConfig(config);

  return defineIntegration({
    category: "agent",
    type: "agent-unit",
    instance,
    plugins: [createAgentPlugin(config)],
  });
}
