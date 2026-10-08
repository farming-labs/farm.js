// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearReportedFarmPreloadWarnings,
  reportFarmPreloadWarnings,
  type FarmPreloadBudgetWarning,
} from "../preload";

const warning: FarmPreloadBudgetWarning[] = [{ kind: "image", count: 4, budget: 1, removed: 3 }];

afterEach(() => {
  vi.restoreAllMocks();
  clearReportedFarmPreloadWarnings();
});

describe("preload warning history", () => {
  it("does no clock or history work when both inputs and history are empty", () => {
    clearReportedFarmPreloadWarnings();
    const clock = vi.spyOn(Date, "now");
    const iterate = vi.spyOn(Map.prototype, Symbol.iterator);
    reportFarmPreloadWarnings([]);
    expect(clock).not.toHaveBeenCalled();
    expect(iterate).not.toHaveBeenCalled();
  });

  it.each([1, 256])("does not sweep %i live entries for empty or repeated warnings", (size) => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let index = 0; index < size; index++)
      reportFarmPreloadWarnings(warning, `route /${index}`);
    log.mockClear();
    const iterate = vi.spyOn(Map.prototype, Symbol.iterator);
    reportFarmPreloadWarnings([], "route /clean");
    reportFarmPreloadWarnings(warning, "route /0");
    expect(iterate).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("expires on an empty call at the exact TTL, even before the clock moves backward", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    reportFarmPreloadWarnings(warning, "route /first");
    clock.mockReturnValue(60999);
    reportFarmPreloadWarnings([], "route /clean");
    reportFarmPreloadWarnings(warning, "route /first");
    expect(log).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(61000);
    reportFarmPreloadWarnings([], "route /clean");
    clock.mockReturnValue(1000);
    reportFarmPreloadWarnings(warning, "route /first");
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("tracks earlier expiry when the clock moves backward between new warnings", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(10000);
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    reportFarmPreloadWarnings(warning, "route /later");
    clock.mockReturnValue(1000);
    reportFarmPreloadWarnings(warning, "route /earlier");
    clock.mockReturnValue(61000);
    reportFarmPreloadWarnings([]);
    clock.mockReturnValue(1000);
    reportFarmPreloadWarnings(warning, "route /earlier");
    reportFarmPreloadWarnings(warning, "route /later");
    expect(log).toHaveBeenCalledTimes(3);
    expect(log.mock.calls[2][0]).toContain("route /earlier");
  });

  it("preserves the 256-entry limit, insertion-order eviction and explicit reset", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let index = 0; index < 257; index++) reportFarmPreloadWarnings(warning, `route /${index}`);
    expect(log).toHaveBeenCalledTimes(257);
    reportFarmPreloadWarnings(warning, "route /1");
    expect(log).toHaveBeenCalledTimes(257);
    reportFarmPreloadWarnings(warning, "route /0");
    expect(log).toHaveBeenCalledTimes(258);
    clearReportedFarmPreloadWarnings();
    reportFarmPreloadWarnings(warning, "route /0");
    expect(log).toHaveBeenCalledTimes(259);
  });

  it("keeps route, budget, kind and removal count in warning identity", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    reportFarmPreloadWarnings(warning, "route /one");
    reportFarmPreloadWarnings(warning, "route /two");
    reportFarmPreloadWarnings([{ ...warning[0], budget: 2 }], "route /one");
    reportFarmPreloadWarnings([{ ...warning[0], kind: "font" }], "route /one");
    reportFarmPreloadWarnings([{ ...warning[0], removed: 0 }], "route /one");
    expect(log).toHaveBeenCalledTimes(5);
    expect(log.mock.calls[3][0]).toContain("preload: false");
    expect(log.mock.calls[4][0]).not.toContain("Removed");
  });
});
