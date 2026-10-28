import assert from "node:assert/strict";
import test from "node:test";

import { resend } from "../dist/index.js";

test("rejects malformed and non-object JSON before calling Resend", async () => {
  let sendCalls = 0;
  const integration = resend({
    instance: {
      emails: {
        async send() {
          sendCalls += 1;
          return { data: { id: "email_1" }, error: null };
        },
      },
      webhooks: { verify() {} },
    },
    templates: {
      welcome: {
        component() {
          return null;
        },
        subject: "Welcome",
      },
    },
    allowUnauthenticated: true,
  });

  for (const path of ["/api/email/send", "/api/email/schedule", "/api/email/preview"]) {
    const route = integration.routes.find((entry) => entry.path === path);
    assert.ok(route, `expected ${path} to be mounted`);

    for (const body of ["{", "null", "[]"]) {
      const response = await route.handler(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
        {},
      );

      assert.equal(response.status, 400, `${path} should reject ${body}`);
      assert.deepEqual(await response.json(), {
        error: "Email request body must be a valid JSON object.",
      });
    }
  }

  assert.equal(sendCalls, 0);
});

test("callers cannot set the sender or copy fields unless the app opts in", async () => {
  const sent = [];
  const create = (options = {}) =>
    resend({
      instance: {
        emails: {
          async send(payload) {
            sent.push(payload);
            return { data: { id: "email_1" }, error: null };
          },
        },
        webhooks: { verify() {} },
      },
      defaults: { from: "noreply@app.test", replyTo: "support@app.test" },
      templates: { reset: { component: () => null, subject: "Reset your password" } },
      authorize: async () => true,
      ...options,
    });
  const call = (integration, path, body) =>
    integration.routes
      .find((entry) => entry.path === path)
      .handler(
        new Request(`http://app.test${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://app.test" },
          body: JSON.stringify({ templateId: "reset", to: "user@app.test", data: {}, ...body }),
        }),
        { req: new Map() },
      );

  const integration = create();
  for (const path of ["/api/email/send", "/api/email/schedule"]) {
    const when = path.endsWith("schedule") ? { when: "in 1 hour" } : {};
    for (const field of [
      { from: "security@app.test" },
      { replyTo: "attacker@evil.test" },
      { cc: "copy@evil.test" },
      { bcc: "hidden@evil.test" },
    ]) {
      const response = await call(integration, path, { ...when, ...field });
      assert.equal(response.status, 400, `${path} should reject ${Object.keys(field)[0]}`);
    }
    const response = await call(integration, path, when);
    assert.equal(response.status, 200);
  }
  assert.equal(sent.length, 2);
  for (const payload of sent) {
    assert.equal(payload.from, "noreply@app.test");
    assert.equal(payload.replyTo, "support@app.test");
    assert.equal(payload.cc, undefined);
    assert.equal(payload.bcc, undefined);
  }

  sent.length = 0;
  const response = await call(create({ allowCallerHeaders: true }), "/api/email/send", {
    from: "team@app.test",
    bcc: "audit@app.test",
  });
  assert.equal(response.status, 200);
  assert.equal(sent[0].from, "team@app.test");
  assert.equal(sent[0].bcc, "audit@app.test");
});
