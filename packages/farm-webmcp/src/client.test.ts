import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defineWebMCPTool,
  registerWebMCPTool,
  registerWebMCPTools,
  startWebMCPRuntime,
  WebMCPInputError,
  type WebMCPJSONValue,
  type WebMCPStandardSchema,
} from "./client.js";
import { webmcp } from "./index.js";

interface NativeTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: object, options: { signal: AbortSignal }): Promise<WebMCPJSONValue>;
}

const cleanups: Array<() => void> = [];
let runtime: Awaited<ReturnType<typeof startWebMCPRuntime>> | undefined;

beforeEach(() => {
  vi.stubGlobal("window", {});
});

afterEach(() => {
  runtime?.close();
  runtime = undefined;
  while (cleanups.length) cleanups.pop()?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function register(definition: Parameters<typeof registerWebMCPTool>[0]): () => void {
  const cleanup = registerWebMCPTool(definition);
  cleanups.push(cleanup);
  return cleanup;
}

function installModelContext() {
  const tools = new Map<string, NativeTool>();
  const registrationSignals = new Map<string, AbortSignal>();
  const registerTool = vi.fn(
    async (tool: NativeTool, options: { signal?: AbortSignal } = {}): Promise<undefined> => {
      if (tools.has(tool.name)) throw new DOMException("Duplicate tool", "InvalidStateError");
      tools.set(tool.name, tool);
      if (options.signal) {
        registrationSignals.set(tool.name, options.signal);
        options.signal.addEventListener(
          "abort",
          () => {
            if (tools.get(tool.name) === tool) tools.delete(tool.name);
          },
          { once: true },
        );
      }
      return undefined;
    },
  );

  vi.stubGlobal("document", { modelContext: { registerTool } });
  return { tools, registrationSignals, registerTool };
}

function searchTool(execute = vi.fn(async ({ query }: { query: string }) => ({ query }))) {
  return defineWebMCPTool<{ query: string }>({
    name: "search_products",
    description: "Search the visible product catalog.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute,
  });
}

describe("webmcp client runtime", () => {
  it("registers only explicit tools and executes them through the native API", async () => {
    const native = installModelContext();
    const execute = vi.fn(async ({ query }: { query: string }) => ({ matches: [query] }));
    register(searchTool(execute));

    runtime = await startWebMCPRuntime();

    expect(native.registerTool).toHaveBeenCalledOnce();
    expect(runtime.getTools()).toEqual([
      expect.objectContaining({ name: "search_products", annotations: { readOnlyHint: true } }),
    ]);
    const signal = new AbortController().signal;
    await expect(
      native.tools.get("search_products")?.execute({ query: "tractor" }, { signal }),
    ).resolves.toEqual({ matches: ["tractor"] });
    expect(execute).toHaveBeenCalledWith({ query: "tractor" }, { signal });
  });

  it("validates input before calling the application handler", async () => {
    const native = installModelContext();
    const execute = vi.fn(async ({ count }: { count: number }) => ({ count }));
    const validate = {
      safeParse(value: unknown) {
        if (
          value &&
          typeof value === "object" &&
          "count" in value &&
          typeof value.count === "number"
        ) {
          return { success: true as const, data: { count: value.count } };
        }
        return {
          success: false as const,
          error: { issues: [{ path: ["count"], message: "Expected a number" }] },
        };
      },
    };
    const tool = defineWebMCPTool({
      name: "set_quantity",
      description: "Set the quantity for the selected cart line.",
      inputSchema: {
        type: "object",
        properties: { count: { type: "number" } },
        required: ["count"],
      },
      validate,
      execute,
    });
    register(tool);
    runtime = await startWebMCPRuntime();

    const invoke = native.tools.get("set_quantity")?.execute;
    const signal = new AbortController().signal;
    await expect(invoke?.({ count: "two" }, { signal })).rejects.toMatchObject({
      name: "WebMCPInputError",
      message: expect.stringContaining("count: Expected a number"),
    });
    expect(execute).not.toHaveBeenCalled();
    await expect(invoke?.({ count: 2 }, { signal })).resolves.toEqual({ count: 2 });
  });

  it("supports Standard Schema validation and transformed input", async () => {
    const native = installModelContext();
    const validator: WebMCPStandardSchema<{ id: number }> = {
      "~standard": {
        version: 1,
        vendor: "test",
        types: undefined as unknown as { input: unknown; output: { id: number } },
        validate(value) {
          const id = Number((value as { id?: unknown }).id);
          return Number.isInteger(id) && id > 0
            ? { value: { id } }
            : { issues: [{ path: ["id"], message: "Expected a positive integer" }] };
        },
      },
    };
    const tool = defineWebMCPTool({
      name: "get_order",
      description: "Read an order by its numeric ID.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", pattern: "^[1-9][0-9]*$" } },
        required: ["id"],
      },
      validate: validator,
      async execute({ id }) {
        return { id, receivedType: typeof id };
      },
    });
    register(tool);
    runtime = await startWebMCPRuntime();

    await expect(
      native.tools
        .get("get_order")
        ?.execute({ id: "42" }, { signal: new AbortController().signal }),
    ).resolves.toEqual({ id: 42, receivedType: "number" });
  });

  it("forwards browser cancellation to the handler", async () => {
    const native = installModelContext();
    let receivedSignal: AbortSignal | undefined;
    register(
      defineWebMCPTool({
        name: "wait_for_inventory",
        description: "Wait for the current inventory request.",
        inputSchema: { type: "object", additionalProperties: false },
        async execute(_input, { signal }) {
          receivedSignal = signal;
          return { cancelled: signal.aborted };
        },
      }),
    );
    runtime = await startWebMCPRuntime();

    const controller = new AbortController();
    await native.tools.get("wait_for_inventory")?.execute({}, { signal: controller.signal });
    expect(receivedSignal).toBe(controller.signal);
  });

  it("uses the latest route registration and restores the previous tool on cleanup", async () => {
    const native = installModelContext();
    const firstCleanup = register(
      defineWebMCPTool({
        name: "page_action",
        description: "Run the action for the first route.",
        inputSchema: { type: "object" },
        async execute() {
          return "first";
        },
      }),
    );
    runtime = await startWebMCPRuntime();

    const secondCleanup = register(
      defineWebMCPTool({
        name: "page_action",
        description: "Run the action for the next route.",
        inputSchema: { type: "object" },
        async execute() {
          return "second";
        },
      }),
    );
    await runtime.sync();
    const signal = new AbortController().signal;
    await expect(native.tools.get("page_action")?.execute({}, { signal })).resolves.toBe("second");

    secondCleanup();
    await runtime.sync();
    await expect(native.tools.get("page_action")?.execute({}, { signal })).resolves.toBe("first");
    firstCleanup();
  });

  it("aborts native registrations and removes the debug inspector on close", async () => {
    const native = installModelContext();
    register(searchTool());
    runtime = await startWebMCPRuntime({ debug: true });
    const registrationSignal = native.registrationSignals.get("search_products");

    expect(window.__FARM_WEBMCP__).toBe(runtime);
    runtime.close();

    expect(registrationSignal?.aborted).toBe(true);
    expect(native.tools.size).toBe(0);
    expect(window.__FARM_WEBMCP__).toBeUndefined();
  });

  it("cleans up the runtime when initial native registration fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const registrationSignals: AbortSignal[] = [];
    const registerTool = vi.fn(
      async (_tool: NativeTool, options: { signal?: AbortSignal } = {}) => {
        if (options.signal) registrationSignals.push(options.signal);
        throw new Error("Native registration failed");
      },
    );
    vi.stubGlobal("document", { modelContext: { registerTool } });
    register(searchTool());

    await expect(startWebMCPRuntime({ debug: true })).rejects.toThrow("Native registration failed");

    expect(registrationSignals).toHaveLength(1);
    expect(registrationSignals[0]?.aborted).toBe(true);
    expect(window.__FARM_WEBMCP__).toBeUndefined();
    expect(errorLog).toHaveBeenCalledOnce();

    register(searchTool());
    await Promise.resolve();
    expect(registerTool).toHaveBeenCalledOnce();
  });

  it("supports ignore, warning, and error behavior in browsers without WebMCP", async () => {
    vi.stubGlobal("document", {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    runtime = await startWebMCPRuntime({ unsupported: "warn" });
    expect(runtime.supported).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("document.modelContext"));
    runtime.close();
    runtime = undefined;

    await expect(startWebMCPRuntime({ unsupported: "error" })).rejects.toThrow(
      "document.modelContext",
    );
    expect(warn).toHaveBeenCalledOnce();
  });

  it("rejects invalid definitions and non-JSON tool results", async () => {
    expect(() =>
      defineWebMCPTool({
        name: "spaces are invalid",
        description: "Invalid name.",
        inputSchema: { type: "object" },
        async execute() {
          return null;
        },
      }),
    ).toThrow("1 to 128 ASCII");

    const native = installModelContext();
    register(
      defineWebMCPTool({
        name: "bad_result",
        description: "Return an invalid result for the test.",
        inputSchema: { type: "object" },
        execute: async () => ({ value: undefined }) as unknown as WebMCPJSONValue,
      }),
    );
    runtime = await startWebMCPRuntime();

    await expect(
      native.tools.get("bad_result")?.execute({}, { signal: new AbortController().signal }),
    ).rejects.toThrow("must be JSON-serializable");
  });

  it("does not partially register a list containing an invalid definition", async () => {
    expect(() =>
      registerWebMCPTools([
        searchTool(),
        {
          ...searchTool(),
          name: "invalid tool name",
        },
      ]),
    ).toThrow("1 to 128 ASCII");

    vi.stubGlobal("document", {});
    runtime = await startWebMCPRuntime();
    expect(runtime.getTools()).toEqual([]);
  });
});

describe("webmcp Farm plugin", () => {
  it("uses development-safe defaults without serializing undefined values", () => {
    const plugin = webmcp();
    expect(plugin.name).toBe("farm:webmcp");
    expect(plugin.client?.public).toEqual({
      enabled: true,
      unsupported: null,
      debug: null,
    });
    expect(plugin.client?.setup?.toString()).toContain("startWebMCPRuntime");
  });

  it("validates plugin options", () => {
    expect(() => webmcp({ unsupported: "silent" as "ignore" })).toThrow(
      'unsupported must be "ignore", "warn", or "error"',
    );
    expect(() => webmcp({ debug: "yes" as unknown as boolean })).toThrow("debug must be boolean");
  });
});

it("exposes validation failures as a named public error", () => {
  const error = new WebMCPInputError("search_products", [{ path: ["query"], message: "Required" }]);
  expect(error).toBeInstanceOf(TypeError);
  expect(error.message).toContain("query: Required");
});
