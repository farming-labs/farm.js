import { chat, chatParamsFromRequest, maxIterations, toServerSentEventsResponse } from "@tanstack/ai";
import { chatModel } from "../../../lib/model.server";
import { getFarmFact, setAccent } from "../../../lib/tools";

const FACTS = {
  renderers: "Farm.js renders with React by default, and also Preact, Solid, Vue and Svelte.",
  deploy: "Farm.js builds through Nitro to Vercel, Netlify, Cloudflare, Node and more.",
  agents: "Farm.js apps serve Markdown mirrors and llms.txt, and expose API routes as MCP tools.",
} as const;

const getFarmFactServer = getFarmFact.server(async ({ topic }) => ({ topic, fact: FACTS[topic] }));

// A plain web-standard handler: TanStack AI reads the Request and returns a
// streaming Response, which is exactly the shape of a Farm API route.
export async function POST(request: Request) {
  const adapter = chatModel();
  if (!adapter) {
    return Response.json(
      { error: "Set OPENAI_API_KEY, or AI_BASE_URL for an OpenAI-compatible endpoint." },
      { status: 503 },
    );
  }
  const { messages, threadId, runId } = await chatParamsFromRequest(request);
  const stream = chat({
    adapter,
    messages,
    threadId,
    runId,
    systemPrompts: ["You are a concise assistant on a Farm.js demo page. Use tools when they help."],
    // A bare definition is a client tool: the model calls it, the browser runs it.
    tools: [getFarmFactServer, setAccent],
    agentLoopStrategy: maxIterations(5),
    abortController: abortOn(request.signal),
  });
  return toServerSentEventsResponse(stream);
}

function abortOn(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  return controller;
}
