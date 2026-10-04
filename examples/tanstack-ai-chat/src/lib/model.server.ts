import { openaiText } from "@tanstack/ai-openai";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";

/**
 * The model for the chat route. OPENAI_API_KEY uses OpenAI. AI_BASE_URL points
 * at any OpenAI-compatible endpoint instead (Ollama, OpenRouter, Groq, a test
 * server), with AI_MODEL and an optional AI_API_KEY.
 */
export function chatModel() {
  const baseURL = process.env.AI_BASE_URL;
  if (baseURL) {
    return openaiCompatibleText(process.env.AI_MODEL ?? "llama3.2", {
      baseURL,
      apiKey: process.env.AI_API_KEY ?? "not-needed",
      api: "chat-completions",
    });
  }
  if (!process.env.OPENAI_API_KEY) return null;
  return openaiText("gpt-4o-mini");
}
