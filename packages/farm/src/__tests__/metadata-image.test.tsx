// @vitest-environment node

import React from "react";
import { imageSize } from "image-size";
import { describe, expect, it } from "vitest";
import { createFarmMetadataImageResponse } from "../metadata-image";

function ProductCard({ id }: { id: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-black text-white">
      <span className="text-2xl text-emerald-400">Farm.js</span>
      <span className="mt-4 text-6xl font-bold">Product {id}</span>
    </div>
  );
}

describe("generated metadata images", () => {
  it("renders stateless JSX with className utilities to a PNG", async () => {
    const response = await createFarmMetadataImageResponse(<ProductCard id="42" />, {
      size: { width: 600, height: 315 },
      revalidate: 60,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    expect(response.headers.get("etag")).toMatch(/^"[a-f0-9]{32}"$/);

    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(imageSize(bytes)).toMatchObject({ width: 600, height: 315, type: "png" });
  });

  it("supports HEAD and conditional requests without returning an image body", async () => {
    const first = await createFarmMetadataImageResponse(
      <div className="flex h-full w-full bg-black text-white">Farm.js</div>,
      { size: { width: 120, height: 63 } },
    );
    const etag = first.headers.get("etag");

    const head = await createFarmMetadataImageResponse(
      <div className="flex h-full w-full bg-black text-white">Farm.js</div>,
      { size: { width: 120, height: 63 } },
      { method: "HEAD" },
    );
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(first.headers.get("content-length"));
    expect((await head.arrayBuffer()).byteLength).toBe(0);

    const notModified = await createFarmMetadataImageResponse(
      <div className="flex h-full w-full bg-black text-white">Farm.js</div>,
      { size: { width: 120, height: 63 } },
      { ifNoneMatch: etag },
    );
    expect(notModified.status).toBe(304);
    expect((await notModified.arrayBuffer()).byteLength).toBe(0);

    const wildcardNotModified = await createFarmMetadataImageResponse(
      <div className="flex h-full w-full bg-black text-white">Farm.js</div>,
      { size: { width: 120, height: 63 } },
      { ifNoneMatch: "*" },
    );
    expect(wildcardNotModified.status).toBe(304);
    expect((await wildcardNotModified.arrayBuffer()).byteLength).toBe(0);
  });

  it("keeps explicit SVG and Response handlers as escape hatches", async () => {
    const svg = await createFarmMetadataImageResponse(
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <text>Farm</text>
      </svg>,
      { contentType: "image/svg+xml" },
    );
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    expect(await svg.text()).toContain("<svg");

    const custom = new Response("custom", {
      status: 202,
      headers: { "Content-Type": "image/custom" },
    });
    const response = await createFarmMetadataImageResponse(custom, {});
    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).toBe("image/custom");
    expect(await response.text()).toBe("custom");
  });

  it("cancels a custom image response body that HEAD discards", async () => {
    let cancelled = false;
    const custom = new Response(
      new ReadableStream({
        pull() {},
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "Content-Type": "image/custom" } },
    );

    const response = await createFarmMetadataImageResponse(custom, {}, { method: "HEAD" });

    expect(response.body).toBeNull();
    expect(response.headers.get("content-type")).toBe("image/custom");
    expect(cancelled).toBe(true);
  });
});

function createLazyDiv(label = "Lazy") {
  return React.lazy(async () => ({
    default: function LazyInner() {
      return <div className="flex h-full w-full bg-black text-white">{label}</div>;
    },
  }));
}

describe("lazy metadata images", () => {
  it("renders a React.lazy component to a PNG on the first (cold-start) request", async () => {
    const LazyDiv = createLazyDiv("Cold start");

    const response = await createFarmMetadataImageResponse(<LazyDiv />, {
      size: { width: 120, height: 63 },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(imageSize(bytes)).toMatchObject({ width: 120, height: 63, type: "png" });
  });

  it("renders all concurrent cold-start React.lazy requests to PNGs", async () => {
    const LazyDiv = createLazyDiv("Concurrent");

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        createFarmMetadataImageResponse(<LazyDiv />, { size: { width: 120, height: 63 } }),
      ),
    );

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const responses = results.map((r) => (r as PromiseFulfilledResult<Response>).value);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }
  });

  it("surfaces a rejected React.lazy import as an error without masking it", async () => {
    const LazyFail = React.lazy(async () => {
      throw new Error("import failed");
    });

    let caught: unknown;
    try {
      await createFarmMetadataImageResponse(<LazyFail />, { size: { width: 120, height: 63 } });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("import failed");
  });
});

describe("wrapped metadata images", () => {
  it("unwraps a React.lazy component nested under React.memo", async () => {
    const LazyInner = createLazyDiv("Nested");
    const Wrapped = React.memo(function LazyWrapper() {
      return <LazyInner />;
    });

    const response = await createFarmMetadataImageResponse(<Wrapped />, {
      size: { width: 120, height: 63 },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });
});
