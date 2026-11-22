// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { getAvailablePort } from "./dev-server-port";

afterEach(() => {
  vi.restoreAllMocks();
});

it("never hands a test server Vite's HMR WebSocket port", async () => {
  // The first draw lands on 24678, which Vite's middleware-mode servers in other suites bind.
  vi.spyOn(Math, "random").mockReturnValueOnce((24_678 - 20_000 + 0.5) / 12_768);
  expect(await getAvailablePort()).not.toBe(24_678);
});
