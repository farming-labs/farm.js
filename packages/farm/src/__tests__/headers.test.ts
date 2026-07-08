import { describe, expect, it } from "vitest";
import { cookies, headers } from "../headers";
import { _runWithCurrentRequest } from "../server/request";

describe("Next-compatible header helpers", () => {
  it("reads headers from the current server request", async () => {
    const request = new Request("https://farmjs.dev/dashboard", {
      headers: {
        "x-farm-test": "ok",
      },
    });

    await _runWithCurrentRequest(request, () => {
      const requestHeaders = headers();
      expect(requestHeaders.get("x-farm-test")).toBe("ok");
      expect(requestHeaders.has("x-farm-test")).toBe(true);
    });
  });

  it("reads request cookies from the current server request", async () => {
    const request = new Request("https://farmjs.dev/dashboard", {
      headers: {
        cookie: "session=abc123; theme=dark",
      },
    });

    await _runWithCurrentRequest(request, () => {
      const requestCookies = cookies();
      expect(requestCookies.get("session")).toEqual({ name: "session", value: "abc123" });
      expect(requestCookies.has("theme")).toBe(true);
      expect(requestCookies.getAll()).toEqual([
        { name: "session", value: "abc123" },
        { name: "theme", value: "dark" },
      ]);
      expect(requestCookies.toString()).toBe("session=abc123; theme=dark");
    });
  });
});
