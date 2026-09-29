import assert from "node:assert/strict";
import test from "node:test";

import { supabase } from "../dist/index.js";

test("rejects malformed and non-object JSON before creating a Supabase client", async () => {
  let clientCreations = 0;
  const integration = supabase({
    appBaseUrl: "http://localhost",
    instance() {
      clientCreations += 1;
      return { auth: {} };
    },
  });

  for (const path of ["/auth/login", "/auth/signup", "/auth/logout"]) {
    const route = integration.routes.find((entry) => entry.path === path);
    assert.ok(route, `expected ${path} to be mounted`);

    for (const body of ["{", "null", "[]"]) {
      const request = new Request(`http://localhost${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body,
      });
      const response = await route.handler(request, {
        request,
        url: new URL(request.url),
      });

      assert.equal(response.status, 400, `${path} should reject ${body}`);
      assert.deepEqual(await response.json(), {
        error: "Supabase auth request body must be a valid JSON object.",
      });
    }
  }

  assert.equal(clientCreations, 0);
});

test("rejects unreadable form bodies before creating a Supabase client", async () => {
  let clientCreations = 0;
  const integration = supabase({
    appBaseUrl: "http://localhost",
    instance() {
      clientCreations += 1;
      return { auth: {} };
    },
  });

  for (const path of ["/auth/login", "/auth/signup"]) {
    const route = integration.routes.find((entry) => entry.path === path);
    assert.ok(route, `expected ${path} to be mounted`);

    for (const contentType of ["text/plain", "multipart/form-data; boundary=missing"]) {
      const request = new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": contentType, origin: "http://localhost" },
        body: "email=user@example.com",
      });
      const response = await route.handler(request, {
        request,
        url: new URL(request.url),
      });

      assert.equal(response.status, 400, `${path} should reject ${contentType}`);
      assert.deepEqual(await response.json(), {
        error: "Supabase auth request body must be form data or a JSON object.",
      });
    }
  }

  assert.equal(clientCreations, 0);
});
