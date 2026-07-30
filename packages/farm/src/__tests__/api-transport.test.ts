import { describe, expect, it } from "vitest";
import {
  isJSONStreamResponse,
  jsonStream,
  multipart,
  readJSONStream,
  toFormData,
} from "../api/transport";

describe("API transports", () => {
  it("encodes typed multipart values without converting blobs to JSON", async () => {
    const attachment = new Blob(["hello"], { type: "text/plain" });
    const formData = toFormData({
      attachment,
      count: 2,
      enabled: true,
      tags: ["one", "two"],
      skipped: undefined,
    });

    expect(formData.get("attachment")).toBeInstanceOf(Blob);
    expect(formData.get("count")).toBe("2");
    expect(formData.get("enabled")).toBe("true");
    expect(formData.getAll("tags")).toEqual(["one", "two"]);
    expect(formData.has("skipped")).toBe(false);
  });

  it("marks schemas as multipart without changing their parser", () => {
    const schema = {
      parse(value: unknown) {
        return { value };
      },
    };
    const marked = multipart(schema);

    expect(marked).toBe(schema);
    expect(marked.__farmMultipartSchema).toBe(true);
    expect(marked.parse("farm")).toEqual({ value: "farm" });
  });

  it("streams and decodes typed JSON items incrementally", async () => {
    async function* events() {
      yield { phase: "accepted" as const, progress: 0 };
      yield { phase: "complete" as const, progress: 100 };
    }

    const response = jsonStream(events());
    const stream = readJSONStream<
      { phase: "accepted"; progress: number } | { phase: "complete"; progress: number }
    >(response);
    const received = [];

    expect(isJSONStreamResponse(response)).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");

    for await (const event of stream) received.push(event);

    expect(received).toEqual([
      { phase: "accepted", progress: 0 },
      { phase: "complete", progress: 100 },
    ]);
    expect(() => stream[Symbol.asyncIterator]()).toThrow(
      "Farm API streams can only be consumed once",
    );
  });

  it("cancels the source when the client no longer needs progress", async () => {
    let released = false;
    async function* events() {
      try {
        yield { progress: 10 };
        await new Promise(() => {});
      } finally {
        released = true;
      }
    }

    const stream = readJSONStream<{ progress: number }>(jsonStream(events()));
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { progress: 10 },
    });
    await stream.cancel("view closed");

    expect(released).toBe(true);
  });
});
