import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

type Message = { role: string; content?: unknown; tool_calls?: unknown };

function chunk(delta: Record<string, unknown>, finish: string | null = null) {
  return `data: ${JSON.stringify({
    id: "mock",
    object: "chat.completion.chunk",
    created: 0,
    model: "mock",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

/**
 * A stand-in for an OpenAI-compatible `/chat/completions` endpoint. The first
 * turn asks for a tool (set_accent when the user mentions a color, otherwise
 * get_farm_fact); the turn after a tool result answers in text.
 */
export async function startMockOpenAI(port = 0): Promise<{ url: string; requests: Message[][]; close: () => Promise<void> }> {
  const requests: Message[][] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (part) => (raw += part));
    req.on("end", () => {
      const body = JSON.parse(raw) as { messages: Message[] };
      requests.push(body.messages);
      const last = body.messages.at(-1)!;
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (last.role === "tool") {
        res.write(chunk({ role: "assistant", content: "" }));
        for (const word of ["Done", " with", " the", " tool."]) res.write(chunk({ content: word }));
        res.write(chunk({}, "stop"));
      } else {
        const text = JSON.stringify(last.content ?? "").toLowerCase();
        const call = /pink|green|blue|orange/.test(text)
          ? { name: "set_accent", arguments: JSON.stringify({ color: "pink" }) }
          : { name: "get_farm_fact", arguments: JSON.stringify({ topic: "renderers" }) };
        // Real providers give every tool call its own id; clients rely on that.
        const id = `call_${requests.length}`;
        res.write(chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name: call.name, arguments: "" } }] }));
        res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: call.arguments } }] }));
        res.write(chunk({}, "tool_calls"));
      }
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: boundPort } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${boundPort}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
