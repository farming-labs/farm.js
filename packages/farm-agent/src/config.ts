import type { AgentUnitConfig } from "agent-unit";

const AGENT_UNIT_CONFIG = Symbol.for("farm.agent.config");

type ConfigHolder = { [AGENT_UNIT_CONFIG]?: AgentUnitConfig };

/** @internal Called by `agent()` as farm.config evaluates, in Farm's process and in the server. */
export function registerAgentUnitConfig(config: AgentUnitConfig): void {
  (globalThis as ConfigHolder)[AGENT_UNIT_CONFIG] = config;
}

/**
 * The agent-unit config of the app's `agent()` integration. agent-unit's engine reads it when it is
 * first used: by then Farm's server has evaluated farm.config, so settings such as storage URLs and
 * `authorize` come from where the server runs.
 */
export default function agentUnitConfig(): AgentUnitConfig {
  const config = (globalThis as ConfigHolder)[AGENT_UNIT_CONFIG];
  if (!config) {
    throw new Error(
      "@farm.js/agent: the server has not evaluated farm.config, so the agent() settings are missing. Mount agent() under `integrations` in farm.config.",
    );
  }
  return config;
}
