import { describe, expect, it, vi } from "vitest";
import { createWebVitalsCollector } from "./collector.js";

const NOW = 1_791_000_000_000;

function lcp(startTime: number): PerformanceEntry {
  return { entryType: "largest-contentful-paint", startTime } as unknown as PerformanceEntry;
}

function shift(value: number, hadRecentInput = false): PerformanceEntry {
  return {
    entryType: "layout-shift",
    value,
    hadRecentInput,
  } as unknown as PerformanceEntry;
}

function interaction(duration: number, interactionId = 7): PerformanceEntry {
  return { entryType: "event", duration, interactionId } as unknown as PerformanceEntry;
}

function navigation(responseStart: number, startTime = 0): PerformanceEntry {
  return {
    entryType: "navigation",
    responseStart,
    startTime,
  } as unknown as PerformanceEntry;
}

function paint(): PerformanceEntry {
  return { entryType: "paint", startTime: 100 } as unknown as PerformanceEntry;
}

describe("createWebVitalsCollector", () => {
  it("batches lcp, cls, inp and ttfb per route through onReport", () => {
    const onReport = vi.fn();
    const collector = createWebVitalsCollector({ onReport, now: () => NOW });
    const home = { pathname: "/" };

    collector.record(navigation(120), home);
    collector.record(lcp(900), home);
    collector.record(lcp(1400), home);
    collector.record(shift(0.05), home);
    collector.record(shift(0.02), home);
    collector.record(shift(0.5, true), home);
    collector.record(interaction(80), home);
    collector.record(interaction(200), home);
    collector.record(paint(), home);
    collector.flush();

    expect(onReport).toHaveBeenCalledOnce();
    expect(onReport).toHaveBeenCalledWith({
      route: "/",
      lcp: 1400,
      cls: 0.07,
      inp: 200,
      ttfb: 120,
      collectedAt: NOW,
    });
  });

  it("flushes the previous route when the pathname changes", () => {
    const onReport = vi.fn();
    const collector = createWebVitalsCollector({ onReport, now: () => NOW });

    collector.record(lcp(800), { pathname: "/a" });
    collector.record(lcp(500), { pathname: "/b" });
    collector.flush();

    expect(onReport).toHaveBeenCalledTimes(2);
    expect(onReport).toHaveBeenNthCalledWith(1, {
      route: "/a",
      lcp: 800,
      collectedAt: NOW,
    });
    expect(onReport).toHaveBeenNthCalledWith(2, {
      route: "/b",
      lcp: 500,
      collectedAt: NOW,
    });
  });

  it("emits nothing when no metric arrived before the flush", () => {
    const onReport = vi.fn();
    const collector = createWebVitalsCollector({ onReport, now: () => NOW });

    collector.record(paint(), { pathname: "/" });
    collector.record(shift(0.5, true), { pathname: "/" });
    collector.record(interaction(50, 0), { pathname: "/" });
    collector.record(navigation(0), { pathname: "/" });
    collector.flush();

    expect(onReport).not.toHaveBeenCalled();
  });

  it("falls back to sendBeacon with the endpoint when no onReport is given", () => {
    const beacon = vi.fn().mockReturnValue(true);
    const collector = createWebVitalsCollector({
      endpoint: "/__farm/vitals",
      beacon,
      now: () => NOW,
    });

    collector.record(lcp(700), { pathname: "/pricing" });
    collector.flush();

    expect(beacon).toHaveBeenCalledOnce();
    expect(beacon).toHaveBeenCalledWith(
      "/__farm/vitals",
      JSON.stringify({ route: "/pricing", lcp: 700, collectedAt: NOW }),
    );
  });

  it("prefers onReport over the beacon endpoint", () => {
    const onReport = vi.fn();
    const beacon = vi.fn().mockReturnValue(true);
    const collector = createWebVitalsCollector({
      endpoint: "/__farm/vitals",
      onReport,
      beacon,
      now: () => NOW,
    });

    collector.record(lcp(700), { pathname: "/" });
    collector.flush();

    expect(onReport).toHaveBeenCalledOnce();
    expect(beacon).not.toHaveBeenCalled();
  });

  it("drops the batch silently with no sink configured", () => {
    const collector = createWebVitalsCollector({ now: () => NOW });

    expect(() => {
      collector.record(lcp(700), { pathname: "/" });
      collector.flush();
    }).not.toThrow();
  });

  it("flushes on close", () => {
    const onReport = vi.fn();
    const collector = createWebVitalsCollector({ onReport, now: () => NOW });

    collector.record(navigation(90), { pathname: "/" });
    collector.close();

    expect(onReport).toHaveBeenCalledWith({
      route: "/",
      ttfb: 90,
      collectedAt: NOW,
    });
  });

  it("does not let a throwing beacon break the app", () => {
    const beacon = vi.fn().mockImplementation(() => {
      throw new Error("beacon down");
    });
    const collector = createWebVitalsCollector({
      endpoint: "/__farm/vitals",
      beacon,
      now: () => NOW,
    });

    expect(() => {
      collector.record(lcp(700), { pathname: "/" });
      collector.flush();
    }).not.toThrow();
  });
});
