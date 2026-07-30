import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createAPIClient } from "../api/client";
import {
  jsonStream,
  toFormData,
  type FarmAPIStream,
  type FarmStreamResponse,
  type TypedFormData,
} from "../api/transport";

type UploadBody = {
  title: string;
  attachment: Blob;
};

type UploadEvent = { phase: "accepted"; title: string } | { phase: "complete"; assetId: string };

type APIRouter = {
  uploads: {
    post: {
      __types: {
        body: UploadBody;
        inputBody: TypedFormData<UploadBody>;
        query: never;
        response: FarmStreamResponse<UploadEvent>;
      };
    };
  };
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("API client transports", () => {
  it("sends FormData directly and exposes a typed async response stream", async () => {
    const fetchMock = vi.fn(async () =>
      jsonStream<UploadEvent>([
        { phase: "accepted", title: "Farm report" },
        { phase: "complete", assetId: "asset-1" },
      ]),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    const api = createAPIClient<APIRouter>({
      baseURL: "https://farm.test",
    });

    const result = await api.uploads.post({
      body: toFormData({
        title: "Farm report",
        attachment: new Blob(["report"]),
      }),
    });
    expectTypeOf(result.data).toEqualTypeOf<FarmAPIStream<UploadEvent> | undefined>();

    const events = [];
    for await (const event of result.data!) events.push(event);

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(init?.body).toBeInstanceOf(FormData);
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain("content-type");
    expect(events).toEqual([
      { phase: "accepted", title: "Farm report" },
      { phase: "complete", assetId: "asset-1" },
    ]);
  });
});
