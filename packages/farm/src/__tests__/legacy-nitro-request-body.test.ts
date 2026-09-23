// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createFarmLegacyRequest } from "../nitro/legacy-request";

describe("legacy Nitro request forwarding", () => {
  it("forwards binary request bytes without parsing or re-serializing them", async () => {
    const bytes = Uint8Array.from([0, 255, 1, 128]);
    const event = { method: "POST" };
    const readRawBody = vi.fn(async () => bytes);

    const request = await createFarmLegacyRequest(
      event,
      "http://example.com/api/upload",
      { "content-type": "application/octet-stream" },
      readRawBody,
    );

    expect(readRawBody).toHaveBeenCalledWith(event, false);
    expect(Array.from(new Uint8Array(await request.arrayBuffer()))).toEqual([...bytes]);
  });

  it("preserves an explicitly empty request body", async () => {
    const request = await createFarmLegacyRequest(
      { method: "POST" },
      "http://example.com/api/empty",
      {},
      async () => "",
    );

    expect(await request.text()).toBe("");
  });

  it("does not read a body for GET requests", async () => {
    const readRawBody = vi.fn(async () => Uint8Array.from([1]));
    const request = await createFarmLegacyRequest(
      { method: "GET" },
      "http://example.com/api/status",
      {},
      readRawBody,
    );

    expect(readRawBody).not.toHaveBeenCalled();
    expect(request.body).toBeNull();
  });

  it("propagates request body read failures", async () => {
    const readError = new Error("request stream failed");
    const readRawBody = vi.fn(async () => {
      throw readError;
    });

    await expect(
      createFarmLegacyRequest(
        { method: "POST" },
        "https://example.test/api/upload",
        {},
        readRawBody,
      ),
    ).rejects.toBe(readError);
  });
});
