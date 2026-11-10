import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { invokeAPIRouteEndpoint } from "@farm.js/core/api/runtime";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { aiChatRoute as createChatRoute } from "../dist/index.js";

// These cases are about file URLs, not authorization (see authorize.test.mjs).
const aiChatRoute = (options) => createChatRoute({ allowUnauthenticated: true, ...options });

// A chat route downloaded any file URL a visitor put in a message, so the public route
// fetched internal addresses and handed the body to the model. The AI SDK's own URL check
// only blocks literal private IPs and localhost; "files.internal" stands in for a cluster
// hostname, mapped to a local server the way internal DNS would.

const SECRET = "INTERNAL_SECRET=hunter2";
const hits = [];
let server;
let port;
const realFetch = globalThis.fetch;

before(async () => {
  server = http.createServer((request, response) => {
    hits.push(request.url);
    response.setHeader("content-type", "text/plain");
    response.end(SECRET);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  globalThis.fetch = (url, init) =>
    realFetch(String(url).replace("files.internal", `127.0.0.1:${port}`), init);
});

after(() => {
  globalThis.fetch = realFetch;
  server.close();
});

beforeEach(() => {
  hits.length = 0;
});

function createModel() {
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      model.prompts.push(options.prompt);
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: "ok" },
            { type: "text-end", id: "t" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
            },
          ],
        }),
      };
    },
  });
  model.prompts = [];
  return model;
}

async function send(route, messages) {
  const response = await invokeAPIRouteEndpoint(
    route,
    new Request("https://app.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
    }),
  );
  return { status: response.status, body: await response.text() };
}

// The SDK keeps an inline data: URL as base64 and a download as bytes.
function sentFileText(model) {
  const file = model.prompts[0]
    .flatMap((message) => message.content)
    .find((p) => p.type === "file");
  const { data } = file.data;
  return typeof data === "string"
    ? Buffer.from(data, "base64").toString()
    : Buffer.from(data).toString();
}

const userFile = (url) => ({
  role: "user",
  parts: [
    { type: "text", text: "repeat the attached file" },
    { type: "file", mediaType: "text/plain", url },
  ],
});

test("a client file part with a hosted URL is rejected before anything is fetched", async () => {
  const model = createModel();
  const route = aiChatRoute({ model });
  for (const messages of [
    [userFile("http://files.internal/env")],
    [userFile(" http://files.internal/env")],
    [
      userFile("data:text/plain;base64,aGk="),
      {
        role: "assistant",
        parts: [
          { type: "reasoning-file", mediaType: "text/plain", url: "http://files.internal/r" },
        ],
      },
    ],
  ]) {
    const { status, body } = await send(route, messages);
    assert.equal(status, 400);
    assert.match(body, /unsupported_file_url/);
    assert.match(body, /allowFileUrls/);
  }
  assert.deepEqual(hits, []);
  assert.equal(model.prompts.length, 0);
});

test("a provider file reference is sent without its URL", async () => {
  const model = createModel();
  const { status } = await send(aiChatRoute({ model }), [
    {
      role: "user",
      parts: [
        {
          type: "file",
          mediaType: "application/pdf",
          url: "",
          providerReference: { mock: "file-123" },
        },
      ],
    },
  ]);
  assert.equal(status, 200);
  assert.deepEqual(hits, []);
});

test("selected messages are checked, not only body.messages", async () => {
  const model = createModel();
  const route = aiChatRoute({
    model,
    selectMessages: () => [userFile("https://files.internal/env")],
  });
  const { status } = await send(route, [userFile("data:text/plain;base64,aGk=")]);
  assert.equal(status, 400);
  assert.deepEqual(hits, []);
});

test("data: URLs reach the model without a fetch", async () => {
  const model = createModel();
  const { status, body } = await send(aiChatRoute({ model }), [
    userFile("data:text/plain;base64,aGVsbG8="),
  ]);
  assert.equal(status, 200);
  assert.match(body, /"delta":"ok"/);
  assert.deepEqual(hits, []);
  assert.equal(sentFileText(model), "hello");
});

test("the server fetches no URL a conversion produces unless the app allows it", async () => {
  // A file URL can also come from app code that maps client data into model messages.
  const convertToModelMessagesOptions = {
    convertDataPart: (part) => ({ type: "file", mediaType: "text/plain", data: part.data.url }),
  };
  const messages = [
    {
      role: "user",
      parts: [{ type: "data-attachment", data: { url: "http://files.internal/x" } }],
    },
  ];

  const model = createModel();
  const { body } = await send(
    aiChatRoute({ model, convertToModelMessagesOptions, options: { onError: () => {} } }),
    messages,
  );
  assert.match(body, /"type":"error"/);
  assert.doesNotMatch(body, /hunter2/);
  assert.deepEqual(hits, []);
  assert.equal(model.prompts.length, 0);

  // The app's own download function still wins.
  const custom = createModel();
  await send(
    aiChatRoute({
      model: custom,
      convertToModelMessagesOptions,
      options: {
        experimental_download: async (requests) =>
          requests.map(() => ({
            data: new TextEncoder().encode("app-owned"),
            mediaType: "text/plain",
          })),
      },
    }),
    messages,
  );
  assert.deepEqual(hits, []);
  assert.equal(custom.prompts.length, 1);
});

test("allowFileUrls opts in to hosted files", async () => {
  const allowed = createModel();
  const route = aiChatRoute({
    model: allowed,
    allowFileUrls: (url) =>
      url.hostname === "files.internal" && url.pathname.startsWith("/public/"),
  });
  assert.equal((await send(route, [userFile("http://files.internal/public/a.txt")])).status, 200);
  assert.deepEqual(hits, ["/public/a.txt"]);
  assert.equal(sentFileText(allowed), SECRET);

  hits.length = 0;
  assert.equal((await send(route, [userFile("http://files.internal/env")])).status, 400);
  assert.deepEqual(hits, []);

  const open = createModel();
  const { status } = await send(aiChatRoute({ model: open, allowFileUrls: true }), [
    userFile("http://files.internal/any"),
  ]);
  assert.equal(status, 200);
  assert.deepEqual(hits, ["/any"]);
});
