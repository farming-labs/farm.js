// @vitest-environment node

// The undici in Node 22.13 to 22.20 and early Node 24 cancels a request's unread body when a clone
// of it is garbage collected. Farm reads a clone to parse an endpoint's input, or to let a guard
// see the body, and hands the original on: a collection before the route read it lost the body,
// so a JSON POST reached an agent-unit route as `{}`. These collect garbage between the clone and
// the read; on a runtime without that undici they pass either way, and Farm's CI runs Node 22.13.

import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { createEndpoint } from "../api/endpoint";
import { invokeAPIRouteEndpoint } from "../api/runtime";
import { cloneFarmRequestWithContext } from "../server-http";

v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc") as () => void;

/** Collects the dropped clones and lets their finalizers run. */
async function collectGarbage() {
  for (let round = 0; round < 3; round++) {
    gc();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const BODY = JSON.stringify({ input: { orderId: "A1" } });

function post(contentType = "application/json") {
  return new Request("https://farm.test/api/agent/agents/refund/runs", {
    method: "POST",
    headers: { "content-type": contentType },
    body: BODY,
  });
}

describe("a request Farm cloned keeps its body for the route", () => {
  for (const contentType of ["application/json", "text/plain"]) {
    it(`for an endpoint that reads the raw request after an await (${contentType})`, async () => {
      // As a plugin route does: agent-unit reads the Request it is handed, after awaiting its
      // engine, not the body Farm parsed.
      const endpoint = createEndpoint({ method: "POST" }, async ({ request }) => {
        await collectGarbage();
        return { body: await request.text() };
      });

      for (let attempt = 0; attempt < 5; attempt++) {
        const response = await invokeAPIRouteEndpoint(endpoint, post(contentType));
        expect(await response.json()).toEqual({ body: BODY });
      }
    });
  }

  it("for the next handler after a clone handed to a guard is dropped", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const request = post();
      // The production entry hands integrations and the docs handler a clone; one that declines
      // drops it, and the route reads the original.
      await cloneFarmRequestWithContext(request).text();
      await collectGarbage();
      expect(await request.text()).toBe(BODY);
    }
  });
});
