// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockOpenAI } from "./mock-openai";

let mock: Awaited<ReturnType<typeof startMockOpenAI>>;

beforeAll(async () => {
  mock = await startMockOpenAI();
  process.env.AI_BASE_URL = mock.url;
});
afterAll(async () => {
  delete process.env.AI_BASE_URL;
  await mock.close();
});

function runRequest(content: string) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      threadId: "thread-1",
      runId: `run-${Math.random()}`,
      messages: [{ id: "m1", role: "user", content }],
      tools: [],
      context: [],
      state: {},
      forwardedProps: {},
    }),
  });
}

async function events(response: Response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .map((block) => block.replace(/^data: /, "").trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { type: string; [key: string]: unknown });
}

describe("chat route", () => {
  it("runs the server tool and streams the answer as server-sent events", async () => {
    const { POST } = await import("../src/app/api/chat/route");
    const response = await POST(runRequest("What renderers does Farm support?"));

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const stream = await events(response);
    const types = stream.map((event) => event.type);
    expect(types).toContain("TOOL_CALL_START");
    expect(types).toContain("TOOL_CALL_RESULT");
    expect(types.at(-1)).toBe("RUN_FINISHED");
    const text = stream
      .filter((event) => event.type === "TEXT_MESSAGE_CONTENT")
      .map((event) => event.delta)
      .join("");
    expect(text).toBe("Done with the tool.");
    // The model's second turn received the server tool's output.
    expect(JSON.stringify(mock.requests.at(-1))).toContain("Preact, Solid, Vue and Svelte");
  });

  it("hands a client tool back to the browser instead of running it", async () => {
    const { POST } = await import("../src/app/api/chat/route");
    const stream = await events(await POST(runRequest("Make the page pink")));
    const call = stream.find((event) => event.type === "TOOL_CALL_START");
    expect(call?.toolCallName ?? call?.toolName).toBe("set_accent");
    expect(stream.some((event) => event.type === "TOOL_CALL_RESULT")).toBe(false);
  });

  it("answers 503 when no model is configured", async () => {
    const saved = process.env.AI_BASE_URL;
    delete process.env.AI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    const { POST } = await import("../src/app/api/chat/route");
    expect((await POST(runRequest("hi"))).status).toBe(503);
    process.env.AI_BASE_URL = saved;
  });
});
