// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { APIRouteManager, invokeAPIRouteEndpoint } from "../api/route-manager";
import { aiChatRequestBodySchema, aiChatRoute } from "../../../farm-integrations/src/ai/index";

const chatMessages = [
  {
    id: "msg_1",
    role: "user",
    parts: [
      {
        type: "text",
        text: "Hello",
      },
    ],
  },
] as const;

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("ai integration", () => {
  it("creates a Next-style chat route that streams an AI SDK UI response", async () => {
    const streamTextCalls: unknown[] = [];
    const POST = aiChatRoute({
      model: "openai/gpt-4o-mini",
      system: "You are a helpful Farm.js assistant.",
      convertToModelMessages: async (messages) => {
        expect(messages).toEqual(chatMessages);
        return [
          {
            role: "user",
            content: "Hello",
          },
        ] as any;
      },
      streamText: ((input: unknown) => {
        streamTextCalls.push(input);
        return {
          toUIMessageStreamResponse(init?: ResponseInit) {
            return new Response("mock-ui-stream", {
              status: init?.status ?? 200,
              headers: {
                "content-type": "text/event-stream",
                "x-farm-ai": "route",
              },
            });
          },
        };
      }) as any,
      responseOptions: {
        status: 202,
      },
      prepare({ body }) {
        return {
          temperature: Number(body.temperature),
        } as any;
      },
    });

    const response = await invokeAPIRouteEndpoint(
      POST,
      new Request("http://example.com/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: chatMessages,
          temperature: 0.2,
        }),
      }),
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("x-farm-ai")).toBe("route");
    await expect(response.text()).resolves.toBe("mock-ui-stream");
    expect(streamTextCalls).toEqual([
      expect.objectContaining({
        model: "openai/gpt-4o-mini",
        system: "You are a helpful Farm.js assistant.",
        temperature: 0.2,
        messages: [
          {
            role: "user",
            content: "Hello",
          },
        ],
      }),
    ]);
  });

  it("is discoverable from a Next-style src/app/api/chat/route.ts export", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-ai-route-"));
    tempDirs.push(root);

    const appDir = path.join(root, "src", "app");
    const routeDir = path.join(appDir, "api", "chat");
    fs.mkdirSync(routeDir, { recursive: true });
    const routeFile = path.join(routeDir, "route.ts");
    fs.writeFileSync(routeFile, "export {};\n");

    const streamTextCalls: unknown[] = [];
    const manager = new APIRouteManager(appDir, {
      ssrLoadModule: async (filePath: string) => {
        expect(filePath).toBe(routeFile);
        return {
          POST: aiChatRoute({
            model: "openai/gpt-4o-mini",
            convertToModelMessages: async (messages) => {
              expect(messages).toEqual(chatMessages);
              return [
                {
                  role: "user",
                  content: "Hello",
                },
              ] as any;
            },
            streamText: ((input: unknown) => {
              streamTextCalls.push(input);
              return {
                toUIMessageStreamResponse() {
                  return new Response("next-ai-stream", {
                    headers: {
                      "content-type": "text/event-stream",
                    },
                  });
                },
              };
            }) as any,
          }),
        };
      },
    } as any);

    await manager.discoverRoutes();
    const handler = manager.getHandler();

    expect(handler).toBeTypeOf("function");
    expect(Array.from(manager.getRoutes().keys())).toEqual(["/api/chat"]);

    const response = await handler!(
      new Request("http://example.com/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: chatMessages,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    await expect(response.text()).resolves.toBe("next-ai-stream");
    expect(streamTextCalls).toEqual([
      expect.objectContaining({
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: "Hello",
          },
        ],
      }),
    ]);
  });

  it("returns 400 for invalid chat route request bodies", async () => {
    const POST = aiChatRoute({
      model: "openai/gpt-4o-mini",
      streamText: (() => {
        throw new Error("streamText should not run for invalid input.");
      }) as any,
    });

    const response = await invokeAPIRouteEndpoint(
      POST,
      new Request("http://example.com/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prompt: "missing messages",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid request body",
      details: [
        {
          path: ["messages"],
          message: "Expected messages to be an array.",
        },
      ],
    });
  });

  it("exposes a reusable chat request schema", () => {
    expect(aiChatRequestBodySchema.safeParse({ messages: chatMessages }).success).toBe(true);
    expect(
      aiChatRequestBodySchema.safeParse({
        messages: [
          {
            role: "user",
            parts: [{}],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
