import { toolDefinition } from "@tanstack/ai/client";
import { z } from "zod";

// Tool definitions are shared: the route implements the server tool, the page
// implements the client tool. Only schemas live here, so the browser can import it.

export const getFarmFact = toolDefinition({
  name: "get_farm_fact",
  description: "Look up a fact about Farm.js: its renderers, deploy targets, or agent features.",
  inputSchema: z.object({ topic: z.enum(["renderers", "deploy", "agents"]) }),
  outputSchema: z.object({ topic: z.string(), fact: z.string() }),
});

export const setAccent = toolDefinition({
  name: "set_accent",
  description: "Change the accent color of the chat page in the user's browser.",
  inputSchema: z.object({ color: z.enum(["green", "blue", "orange", "pink"]) }),
  outputSchema: z.object({ applied: z.string() }),
});
