import assert from "node:assert/strict";

// A separate process owns the built runtime's native modules. Its exit releases
// the Windows file mappings before the parent removes the production fixture.
const server = await import(process.argv[2]);
const contextResponse = await server.default.fetch(
  new Request("http://farm.test/backend/v2/context", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }),
);
assert.deepEqual(await contextResponse.json(), { preserved: true });
const call = (title, token = "valid") =>
  server.default.fetch(
    new Request("http://farm.test/backend/v2/projects/p1/uploads/u1", {
      method: "POST",
      headers: { "content-type": "application/json", "x-token": token },
      body: JSON.stringify({ title }),
    }),
  );
const response = await call("  Hello  ");
assert.equal(response.status, 200);
assert.equal(response.headers.get("x-plugin-route"), "yes");
assert.deepEqual(await response.json(), { id: "p1/u1", title: "Hello" });
const blocked = await call("blocked");
assert.equal(blocked.status, 400);
await blocked.arrayBuffer();
const unauthorized = await call("Hello", "invalid");
assert.equal(unauthorized.status, 401);
await unauthorized.arrayBuffer();

const fetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls++;
  throw new Error("Local api must not fetch");
};
try {
  const page = await server.default.fetch(new Request("http://farm.test/server"));
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes("p1/u1"));
  const shared = await server.default.fetch(new Request("http://farm.test/backend/v2/shared"));
  assert.deepEqual(await shared.json(), {
    source: "file",
    data: { id: "p1/u1", title: "Local" },
    error: null,
  });
  const denied = await server.default.fetch(
    new Request("http://farm.test/backend/v2/shared?token=invalid"),
  );
  assert.equal((await denied.json()).error, 401);
  const invalid = await server.default.fetch(
    new Request("http://farm.test/backend/v2/shared?title=blocked"),
  );
  assert.equal((await invalid.json()).error, 400);
  const failed = await server.default.fetch(
    new Request("http://farm.test/backend/v2/shared?title=private"),
  );
  assert.equal((await failed.json()).error, 500);
  assert.equal(networkCalls, 0);
} finally {
  globalThis.fetch = fetch;
}
const sharedPost = await server.default.fetch(
  new Request("http://farm.test/backend/v2/shared", { method: "POST" }),
);
assert.deepEqual(await sharedPost.json(), { source: "plugin" });
console.log("plugin routes verified");
