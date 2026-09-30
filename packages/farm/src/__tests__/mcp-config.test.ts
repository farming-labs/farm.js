import { describe, expect, it, vi } from "vitest";
import { resolveFarmMCPConfig } from "../mcp-config";

describe("Farm MCP config", () => {
  it("stays disabled when omitted or explicitly disabled", () => {
    expect(resolveFarmMCPConfig(undefined)).toEqual({ enabled: false });
    expect(resolveFarmMCPConfig(false)).toEqual({ enabled: false });
    expect(resolveFarmMCPConfig({ enabled: false }).enabled).toBe(false);
  });

  it("enables an MCP configuration and preserves authorization", () => {
    const authorize = vi.fn(() => ({ subject: "agent" }));
    const config = resolveFarmMCPConfig({
      authorize,
      path: "/api/agent-tools",
    });

    expect(config.enabled).toBe(true);
    expect(config.path).toBe("/api/agent-tools");
    expect(config.authorize).toBe(authorize);
  });

  it("rejects non-object configuration values", () => {
    expect(() => resolveFarmMCPConfig(true as never)).toThrow(
      "mcp must be a configuration object or false",
    );
    expect(() => resolveFarmMCPConfig([] as never)).toThrow(
      "mcp must be a configuration object or false",
    );
  });
});
