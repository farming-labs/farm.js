import { createHmac, randomBytes } from "node:crypto";
import { dispatchIntegrationRequest } from "@farm.js/core/integrations";
import { expect, it, vi } from "vitest";
import { webhooks } from "./index";

it("authenticates the original bytes, timestamp and destination before calling the receiver", async () => {
  const key = randomBytes(32);
  const onEvent = vi.fn();
  const other = vi.fn();
  const integration = webhooks({
    stock: { path: "/stock", secret: "whsec_" + key.toString("base64"), onEvent },
    sales: {
      path: "/sales",
      secret: "whsec_" + randomBytes(32).toString("base64"),
      onEvent: other,
    },
  });
  const data = '{ "sku": "café" }\n';
  const id = "shipment-one";
  const now = Math.floor(Date.now() / 1000);
  const deliver = (path: string, body: string, timestamp = now) =>
    dispatchIntegrationRequest(
      { integration, config: {}, isDev: false, isProd: true },
      new Request("https://shop.example" + path, {
        method: "POST",
        body,
        headers: {
          "content-type": "application/json",
          "webhook-id": id,
          "webhook-timestamp": String(timestamp),
          "webhook-signature":
            "v1," +
            createHmac("sha256", key)
              .update(id + "." + timestamp + "." + data)
              .digest("base64"),
        },
      }),
    );
  expect((await deliver("/stock", data))?.status).toBe(204);
  expect((await deliver("/stock", data.trim()))?.status).toBe(403);
  expect((await deliver("/stock", data, now - 600))?.status).toBe(403);
  expect((await deliver("/sales", data))?.status).toBe(403);
  expect(onEvent).toHaveBeenCalledExactlyOnceWith({ id, data: { sku: "café" } });
  expect(other).not.toHaveBeenCalled();
});
