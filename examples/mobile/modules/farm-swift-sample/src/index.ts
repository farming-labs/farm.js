import FarmSwiftSample from "./NativeFarmSwiftSample";

/** The device's time zone from the module's Swift code; rejects where the module is not linked. */
export function swiftTimeZone(): Promise<string> {
  if (!FarmSwiftSample) return Promise.reject(new Error("FarmSwiftSample is not linked."));
  return FarmSwiftSample.timeZone();
}
