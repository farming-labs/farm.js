import { describe, expect, it } from "vitest";
import { _runWithCurrentRequest, getCurrentRequest } from "../server/request";

describe("server request store", () => {
  it("exposes the current request during server execution", async () => {
    const request = new Request("https://farmjs.dev/server-demo", {
      headers: {
        cookie: "demo=1",
      },
    });

    await _runWithCurrentRequest(request, async () => {
      const currentRequest = getCurrentRequest();
      expect(currentRequest.url).toBe("https://farmjs.dev/server-demo");
      expect(currentRequest.headers.get("cookie")).toBe("demo=1");
    });
  });
});
