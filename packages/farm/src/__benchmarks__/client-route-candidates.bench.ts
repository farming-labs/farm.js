import { bench, describe, expect } from "vitest";
import { ClientRouteManifest } from "../api/client-routes";
import { ClientRouteManifest as Previous } from "./controls/client-route-manifest";

for (const count of [1, 1_000, 10_000])
  describe(`${count} client routes`, () => {
    const routes = [
      { path: "/api/health", methods: ["GET"] },
      ...Array.from({ length: count }, (_, i) => ({
        path: `/api/resource-${i}/[id]`,
        methods: ["GET"],
      })),
    ];
    const previous = new Previous(routes);
    const indexed = new ClientRouteManifest(routes);
    const call = (manifest: Previous | ClientRouteManifest) => {
      manifest.resolve("/api/health", "GET", {});
      manifest.bind("/api/resource-0", { id: "one" });
    };
    expect(indexed.resolve("/api/health", "GET", {})).toBe(
      previous.resolve("/api/health", "GET", {}),
    );
    expect(indexed.bind("/api/resource-0", { id: "one" })).toEqual(
      previous.bind("/api/resource-0", { id: "one" }),
    );
    bench("previous static resolve + binding", () => call(previous));
    bench("indexed static resolve + binding", () => call(indexed));
    if (count === 1_000) {
      bench("previous construction", () => {
        new Previous(routes);
      });
      bench("indexed construction", () => {
        new ClientRouteManifest(routes);
      });
    }
  });
