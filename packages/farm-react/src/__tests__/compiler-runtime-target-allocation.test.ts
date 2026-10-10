import React from "react";
import { expect, it, vi } from "vitest";
import {
  keyedRowsIdentityRuntimeFeature,
  keyedRowsIdentityFilterHintedRuntimeFeature,
  keyedRowsMapLookupRuntimeFeature,
  keyedRowsMembershipRuntimeFeature,
  keyedRowsRuntimeFeature,
  type CompilerKeyedRowsBlockProps,
  type CompilerRuntimeFeature,
} from "../compiler-runtime";

function allocatedMaps(
  feature: CompilerRuntimeFeature,
  kind: "identityTarget" | "membershipTarget" | "mapLookupTarget",
) {
  const Component = feature.create({ setRoot() {}, subscribe: () => () => {} })
    .KeyedRows as React.ComponentClass<CompilerKeyedRowsBlockProps>;
  const props = {
    bindings: [
      { kind: "text", path: [], read: () => "", [kind]: { dependency: 0, read: () => null } },
    ],
  } as CompilerKeyedRowsBlockProps;
  const NativeMap = Map;
  let count = 0;
  vi.stubGlobal(
    "Map",
    class extends NativeMap {
      constructor(...args: ConstructorParameters<typeof Map>) {
        super(...args);
        count++;
      }
    },
  );
  try {
    new Component(props);
  } finally {
    vi.unstubAllGlobals();
  }
  return count;
}

it.each([
  [keyedRowsIdentityRuntimeFeature, "identityTarget"],
  [keyedRowsIdentityFilterHintedRuntimeFeature, "identityTarget"],
  [keyedRowsMembershipRuntimeFeature, "membershipTarget"],
  [keyedRowsMapLookupRuntimeFeature, "mapLookupTarget"],
] as const)("allocates four fewer target maps with $0.name", (feature, kind) => {
  expect(allocatedMaps(keyedRowsRuntimeFeature, kind) - allocatedMaps(feature, kind)).toBe(4);
});
