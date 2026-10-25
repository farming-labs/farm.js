// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFarmImageConfig } from "../image-config";
import { resolveFarmImageProviderForRuntime } from "../image-runtime";
import { logger } from "../utils";
import { withoutNodePath } from "./without-node-path";

const SHARP_HINT = 'Install "sharp" to optimize images: pnpm add sharp';

describe("sharp as an optional peer", () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-sharp-missing-"));
    await fs.writeFile(path.join(root, "package.json"), "{}");
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to original image URLs for the auto provider", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    const images = resolveFarmImageConfig({ formats: ["image/webp"] });

    const resolved = await withoutNodePath(() =>
      resolveFarmImageProviderForRuntime(images, { root, preset: "node-server" }),
    );

    expect(resolved).toEqual({ ...images, provider: "none" });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(info).toHaveBeenCalledWith(
      `Image optimization is off because sharp is not installed; images use their original URLs. ${SHARP_HINT}, or set images.provider to "none".`,
    );
    // Raw user config without an images block behaves like auto.
    await withoutNodePath(() =>
      expect(resolveFarmImageProviderForRuntime(undefined, { root, dev: true })).toEqual({
        provider: "none",
      }),
    );
  });

  it("fails when the node provider is explicit", async () => {
    const images = resolveFarmImageConfig({ provider: "node" });

    await withoutNodePath(() => {
      expect(() =>
        resolveFarmImageProviderForRuntime(images, { root, preset: "node-server" }),
      ).toThrow(
        `images.provider "node" optimizes images with sharp, which is not installed. ${SHARP_HINT}`,
      );
      expect(() => resolveFarmImageProviderForRuntime(images, { root, dev: true })).toThrow(
        SHARP_HINT,
      );
    });
  });

  it("keeps providers that do not need sharp", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    const auto = resolveFarmImageConfig({});
    const cloudflare = resolveFarmImageConfig({ provider: "cloudflare" });
    const none = resolveFarmImageConfig({ provider: "none" });

    await withoutNodePath(() => {
      expect(resolveFarmImageProviderForRuntime(auto, { root, preset: "cloudflare-module" })).toBe(
        auto,
      );
      expect(resolveFarmImageProviderForRuntime(cloudflare, { root, preset: "cloudflare" })).toBe(
        cloudflare,
      );
      expect(resolveFarmImageProviderForRuntime(none, { root, dev: true })).toBe(none);
      // Development optimizes with Sharp for every provider, Cloudflare included.
      expect(resolveFarmImageProviderForRuntime(cloudflare, { root, dev: true })?.provider).toBe(
        "none",
      );
    });
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("keeps the configured provider when sharp is installed", () => {
    const images = resolveFarmImageConfig({ provider: "node" });

    expect(
      resolveFarmImageProviderForRuntime(images, { root: process.cwd(), preset: "node-server" }),
    ).toBe(images);
  });
});
