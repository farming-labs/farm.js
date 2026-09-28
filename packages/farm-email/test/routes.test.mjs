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
