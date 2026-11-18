import { createHmac } from "node:crypto";
import { Webhook } from "standardwebhooks";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  github,
  signWebhook,
  verifyWebhook,
  WebhookVerificationError,
  type WebhookScheme,
} from "./index.js";

// A Standard Webhooks secret: `whsec_` and a base64 key.
const secret = `whsec_${Buffer.from("a 32 byte key for the test suite").toString("base64")}`;
const body = JSON.stringify({ type: "invoice.paid", data: { id: "inv_1", amountCents: 1200 } });

function request(headers: Record<string, string>, payload = body) {
  return new Request("https://app.example/api/hooks", { method: "POST", headers, body: payload });
}

/** Headers the reference library makes, which is what a Svix-based sender sends. */
function referenceHeaders(key: string, payload = body, id = "msg_ref", at = new Date()) {
  return {
    "webhook-id": id,
    "webhook-timestamp": String(Math.floor(at.getTime() / 1000)),
    "webhook-signature": new Webhook(key).sign(id, at, payload),
  };
}

async function refusal(promise: Promise<unknown>): Promise<WebhookVerificationError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(WebhookVerificationError);
  return error as WebhookVerificationError;
}

describe("verifyWebhook with Standard Webhooks", () => {
  it("accepts what the reference library signs", async () => {
    const event = await verifyWebhook(request(referenceHeaders(secret)), { secret });
    expect(event).toMatchObject({
      id: "msg_ref",
      type: "invoice.paid",
      payload: { type: "invoice.paid", data: { id: "inv_1", amountCents: 1200 } },
      body,
    });
    expect(event.timestamp).toBeInstanceOf(Date);
  });

  it("accepts Svix's header names", async () => {
    const headers = referenceHeaders(secret);
    const event = await verifyWebhook(
      request({
        "svix-id": headers["webhook-id"],
        "svix-timestamp": headers["webhook-timestamp"],
        "svix-signature": headers["webhook-signature"],
      }),
      { secret },
    );
    expect(event.id).toBe("msg_ref");
  });

  it("takes a body and headers that something else already read", async () => {
    const event = await verifyWebhook({ body, headers: referenceHeaders(secret) }, { secret });
    expect(event.id).toBe("msg_ref");
    const bytes = new TextEncoder().encode(body);
    expect(
      (await verifyWebhook({ body: bytes, headers: referenceHeaders(secret) }, { secret })).id,
    ).toBe("msg_ref");
  });

  it("uses a secret without the prefix as its UTF-8 bytes", async () => {
    const raw = "polar-style-raw-secret";
    // The reference library base64-decodes its key, so give it the bytes base64-encoded.
    const headers = referenceHeaders(Buffer.from(raw).toString("base64"));
    expect((await verifyWebhook(request(headers), { secret: raw })).id).toBe("msg_ref");
  });

  it("refuses a wrong secret, a changed body and a dropped signature", async () => {
    const otherSecret = `whsec_${Buffer.from("another key entirely, also 32 b").toString("base64")}`;
    expect(
      (await refusal(verifyWebhook(request(referenceHeaders(secret)), { secret: otherSecret })))
        .code,
    ).toBe("INVALID_SIGNATURE");
    expect(
      (await refusal(verifyWebhook(request(referenceHeaders(secret), `${body} `), { secret })))
        .code,
    ).toBe("INVALID_SIGNATURE");
    const headers = referenceHeaders(secret);
    expect(
      (
        await refusal(
          verifyWebhook(request({ ...headers, "webhook-signature": "v1a,abc v2,def" }), {
            secret,
          }),
        )
      ).code,
    ).toBe("INVALID_SIGNATURE");
  });

  it("refuses a stale or future timestamp", async () => {
    const old = new Date(Date.now() - 6 * 60_000);
    const future = new Date(Date.now() + 6 * 60_000);
    for (const at of [old, future]) {
      const error = await refusal(
        verifyWebhook(request(referenceHeaders(secret, body, "msg_t", at)), { secret }),
      );
      expect(error.code).toBe("TIMESTAMP_OUT_OF_RANGE");
    }
    // A wider window lets the same message through.
    const event = await verifyWebhook(request(referenceHeaders(secret, body, "msg_t", old)), {
      secret,
      toleranceSeconds: 600,
    });
    expect(event.id).toBe("msg_t");
    const headers = referenceHeaders(secret);
    expect(
      (
        await refusal(
          verifyWebhook(request({ ...headers, "webhook-timestamp": "1e9" }), { secret }),
        )
      ).code,
    ).toBe("INVALID_TIMESTAMP");
  });

  it("names every missing header", async () => {
    const error = await refusal(verifyWebhook(request({ "webhook-id": "msg_1" }), { secret }));
    expect(error.code).toBe("MISSING_HEADERS");
    expect(error.message).toContain("`webhook-timestamp`, `webhook-signature`");
  });

  it("fails closed on an empty or malformed secret", async () => {
    const headers = referenceHeaders(secret);
    for (const value of ["", [] as string[], undefined as unknown as string]) {
      expect((await refusal(verifyWebhook(request(headers), { secret: value }))).code).toBe(
        "INVALID_SECRET",
      );
    }
    expect((await refusal(verifyWebhook(request(headers), { secret: "whsec_" }))).code).toBe(
      "INVALID_SECRET",
    );
  });

  it("accepts either secret during a rotation", async () => {
    const next = `whsec_${Buffer.from("the next key after the rotation").toString("base64")}`;
    expect(
      (await verifyWebhook(request(referenceHeaders(secret)), { secret: [next, secret] })).id,
    ).toBe("msg_ref");
  });

  it("validates and types the payload with a schema", async () => {
    const schema = z.object({
      type: z.literal("invoice.paid"),
      data: z.object({ id: z.string(), amountCents: z.number() }),
    });
    const event = await verifyWebhook(request(referenceHeaders(secret)), { secret, schema });
    const amount: number = event.payload.data.amountCents;
    expect(amount).toBe(1200);

    const wrong = JSON.stringify({ type: "invoice.paid", data: { id: 1 } });
    const error = await refusal(
      verifyWebhook(request(referenceHeaders(secret, wrong), wrong), { secret, schema }),
    );
    expect(error.code).toBe("INVALID_PAYLOAD");
    expect(error.message).toContain("data.id");
    expect(error.issues?.length).toBeGreaterThan(0);
  });

  it("refuses a valid signature over a body that isn't JSON", async () => {
    const text = "not json";
    const error = await refusal(
      verifyWebhook(request(referenceHeaders(secret, text), text), { secret }),
    );
    expect(error.code).toBe("INVALID_BODY");
  });
});

describe("signWebhook", () => {
  it("signs what the reference library verifies", async () => {
    const headers = await signWebhook({ secret, body, id: "msg_out" });
    expect(headers["webhook-id"]).toBe("msg_out");
    expect(new Webhook(secret).verify(body, headers)).toEqual(JSON.parse(body));
  });

  it("signs with every secret during a rotation, and verifies with either", async () => {
    const old = `whsec_${Buffer.from("the old key from before rotating").toString("base64")}`;
    const headers = await signWebhook({ secret: [secret, old], body });
    expect(headers["webhook-signature"].split(" ")).toHaveLength(2);
    expect(new Webhook(old).verify(body, headers)).toEqual(JSON.parse(body));
    expect((await verifyWebhook({ body, headers }, { secret })).payload).toEqual(JSON.parse(body));
  });

  it("uses the given timestamp and makes an id by default", async () => {
    const at = new Date("2026-11-18T12:00:00Z");
    const headers = await signWebhook({ secret, body, timestamp: at });
    expect(headers["webhook-timestamp"]).toBe(String(at.getTime() / 1000));
    expect(headers["webhook-id"]).toMatch(/^msg_[0-9a-f-]{36}$/);
  });

  it("refuses to sign with an empty secret", async () => {
    await expect(signWebhook({ secret: "", body })).rejects.toThrow(TypeError);
  });
});

describe("github()", () => {
  // The example from GitHub's "Validating webhook deliveries" docs.
  const ghSecret = "It's a Secret to Everybody";
  const ghBody = "Hello, World!";
  const ghSignature = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";

  it("matches GitHub's documented test vector", () => {
    expect(`sha256=${createHmac("sha256", ghSecret).update(ghBody).digest("hex")}`).toBe(
      ghSignature,
    );
  });

  it("verifies a delivery and reads its id and event type", async () => {
    const payload = JSON.stringify({ action: "opened", number: 7 });
    const signature = `sha256=${createHmac("sha256", ghSecret).update(payload).digest("hex")}`;
    const event = await verifyWebhook(
      request(
        {
          "x-github-delivery": "72d3162e-cc78-11e3-81ab-4c9367dc0958",
          "x-github-event": "pull_request",
          "x-hub-signature-256": signature,
        },
        payload,
      ),
      { secret: ghSecret, scheme: github() },
    );
    expect(event).toMatchObject({
      id: "72d3162e-cc78-11e3-81ab-4c9367dc0958",
      type: "pull_request",
      timestamp: undefined,
      payload: { action: "opened", number: 7 },
    });
  });

  it("refuses a wrong signature and a missing one", async () => {
    const headers = {
      "x-github-delivery": "1",
      "x-github-event": "ping",
      "x-hub-signature-256": ghSignature,
    };
    expect(
      (await refusal(verifyWebhook(request(headers, "{}"), { secret: ghSecret, scheme: github() })))
        .code,
    ).toBe("INVALID_SIGNATURE");
    const { "x-hub-signature-256": _dropped, ...unsigned } = headers;
    expect(
      (
        await refusal(
          verifyWebhook(request(unsigned, "{}"), { secret: ghSecret, scheme: github() }),
        )
      ).code,
    ).toBe("MISSING_HEADERS");
  });
});

describe("a custom scheme", () => {
  it("plugs in as a plain object", async () => {
    const header: WebhookScheme = {
      name: "shared-token",
      async verify({ headers, secrets }) {
        if (!secrets.includes(headers.get("x-token") ?? "")) {
          throw new WebhookVerificationError("INVALID_SIGNATURE", "Wrong token.");
        }
        return { id: headers.get("x-id") ?? "none" };
      },
    };
    const event = await verifyWebhook(request({ "x-token": "t0k", "x-id": "42" }), {
      secret: "t0k",
      scheme: header,
    });
    expect(event.id).toBe("42");
    expect(event.type).toBe("invoice.paid");
  });
});
