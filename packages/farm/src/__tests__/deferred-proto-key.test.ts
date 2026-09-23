import { describe, expect, it } from "vitest";
import { prepareDeferredData, reviveDeferredData, snapshotDeferredData } from "../deferred";

describe("deferred data with a __proto__ own key", () => {
  // JSON.parse produces an own enumerable "__proto__" property (unlike an
  // object literal, where it sets the prototype). Encoding and reviving must
  // treat it as ordinary data, not silently drop it or mutate the prototype.
  const withProtoKey = () =>
    JSON.parse('{"__proto__":{"injected":true},"name":"a"}') as Record<string, unknown>;

  it("preserves the __proto__ entry through prepare instead of dropping it", () => {
    const prepared = prepareDeferredData({ page: withProtoKey() });
    const page = (prepared.data as { page: Record<string, unknown> }).page;

    expect(Object.getPrototypeOf(page)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(page, "__proto__")).toBe(true);
    expect((page as { injected?: unknown }).injected).toBeUndefined();
    expect(page.name).toBe("a");
  });

  it("does not pollute the revived object's prototype", () => {
    const prepared = prepareDeferredData({ page: withProtoKey() });
    const revived = reviveDeferredData(prepared.data, snapshotDeferredData(prepared.records)) as {
      page: Record<string, unknown>;
    };

    expect(Object.getPrototypeOf(revived.page)).toBe(Object.prototype);
    expect((revived.page as { injected?: unknown }).injected).toBeUndefined();
    expect(revived.page.name).toBe("a");
  });
});
