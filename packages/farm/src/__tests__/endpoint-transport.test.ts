/**
 * @vitest-environment node
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import type { RouteAPIClient } from "../api/client";
import { createEndpoint } from "../api/endpoint";
import { invokeAPIRouteEndpoint } from "../api/runtime";
import {
  jsonStream,
  multipart,
  readJSONStream,
  toFormData,
  type FarmAPIStream,
  type FarmStreamResponse,
  type TypedFormData,
} from "../api/transport";

const uploadSchema = multipart(
  z.object({
    title: z.string().min(1),
    attachment: z.custom<Blob>((value) => value instanceof Blob),
    tags: z.array(z.string()),
  }),
);

type UploadBody = z.output<typeof uploadSchema>;
type UploadEvent =
  | { phase: "accepted"; title: string; bytes: number }
  | { phase: "complete"; tags: string[] };

const uploadEndpoint = createEndpoint(
  {
    method: "POST",
    body: uploadSchema,
  },
  async ({ body }): Promise<FarmStreamResponse<UploadEvent>> => {
    expectTypeOf(body).toEqualTypeOf<z.output<typeof uploadSchema>>();

    return jsonStream([
      {
        phase: "accepted",
        title: body.title,
        bytes: body.attachment.size,
      },
      {
        phase: "complete",
        tags: body.tags,
      },
    ] satisfies UploadEvent[]);
  },
);

type UploadClient = RouteAPIClient<{
  uploads: {
    post: typeof uploadEndpoint;
  };
}>;
type UploadClientInput = Parameters<UploadClient["uploads"]["post"]>[0];
type UploadClientData = Awaited<ReturnType<UploadClient["uploads"]["post"]>>["data"];

describe("endpoint multipart and stream transport", () => {
  it("validates multipart uploads and preserves repeated fields", async () => {
    const body = toFormData({
      title: "Quarterly import",
      attachment: new Blob(["farm"], { type: "text/plain" }),
      tags: ["reports", "finance"],
    });
    expectTypeOf(body).toEqualTypeOf<TypedFormData<UploadBody>>();
    expectTypeOf<UploadClientInput>().toEqualTypeOf<{
      body: TypedFormData<UploadBody>;
    }>();
    expectTypeOf<UploadClientData>().toEqualTypeOf<FarmAPIStream<UploadEvent> | undefined>();

    const request = new Request("https://farm.test/api/uploads", {
      method: "POST",
      body,
    });
    const response = await invokeAPIRouteEndpoint(uploadEndpoint, request);
    const stream = readJSONStream<UploadEvent>(response);
    const events = [];

    for await (const event of stream) events.push(event);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(events).toEqual([
      {
        phase: "accepted",
        title: "Quarterly import",
        bytes: 4,
      },
      {
        phase: "complete",
        tags: ["reports", "finance"],
      },
    ]);
  });
});
