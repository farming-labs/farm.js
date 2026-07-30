import type { ParsedRoute } from "../types";
import { parseRoutePath } from "../utils";

export type RouteSlotConvention = {
  name: string;
  ownerRoute: ParsedRoute;
  route: ParsedRoute;
  interception: boolean;
  fallback: boolean;
};

const SLOT_SEGMENT = /^@([A-Za-z][A-Za-z0-9_-]*)$/;

/**
 * Parse a page nested below an `@slot` directory without adding the slot name
 * or interception marker to its public URL.
 */
export function parseRouteSlotFile(filePath: string): RouteSlotConvention | null {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const fileName = parts.at(-1) ?? "";
  const baseName = fileName.replace(/\.(tsx?|jsx?)$/, "");
  if (baseName !== "page" && baseName !== "default") return null;

  const slotIndex = parts.findIndex((part) => SLOT_SEGMENT.test(part));
  if (slotIndex < 0) return null;
  if (parts.slice(slotIndex + 1, -1).some((part) => SLOT_SEGMENT.test(part))) {
    throw new Error(`Nested route slots are not supported in "${filePath}"`);
  }

  const slotMatch = parts[slotIndex]!.match(SLOT_SEGMENT);
  const name = slotMatch?.[1];
  if (!name) return null;

  const ownerParts = parts.slice(0, slotIndex);
  const contentParts = parts.slice(slotIndex + 1, -1);
  const marker = parseInterceptionMarker(contentParts[0]);
  let targetBase = ownerParts;
  let targetParts = contentParts;

  if (marker) {
    targetBase =
      marker.root === true ? [] : ownerParts.slice(0, Math.max(0, ownerParts.length - marker.up));
    targetParts = [...(marker.remainder ? [marker.remainder] : []), ...contentParts.slice(1)];
  }

  const ownerFile = [...ownerParts, "layout.tsx"].join("/");
  const routeFile = [
    ...(baseName === "default" ? ownerParts : targetBase),
    ...(baseName === "default" ? [] : targetParts),
    "page.tsx",
  ].join("/");

  return {
    name,
    ownerRoute: parseRoutePath(ownerFile || "layout.tsx"),
    route: parseRoutePath(routeFile || "page.tsx"),
    interception: marker !== null,
    fallback: baseName === "default",
  };
}

export function createRouteSlotContainerId(name: string, ownerPattern: string): string {
  const owner =
    ownerPattern === "/"
      ? "root"
      : ownerPattern
          .replace(/^\//, "")
          .replace(/[^A-Za-z0-9_-]+/g, "-")
          .replace(/^-+|-+$/g, "");
  return `__farm_slot_${name}_${owner || "root"}__`;
}

function parseInterceptionMarker(
  segment: string | undefined,
): { up: number; root?: boolean; remainder: string } | null {
  if (!segment) return null;
  if (segment.startsWith("(...)")) {
    return {
      up: 0,
      root: true,
      remainder: segment.slice(5),
    };
  }
  if (segment.startsWith("(.)")) {
    return {
      up: 0,
      remainder: segment.slice(3),
    };
  }

  let remainder = segment;
  let up = 0;
  while (remainder.startsWith("(..)")) {
    up += 1;
    remainder = remainder.slice(4);
  }
  return up > 0 ? { up, remainder } : null;
}
