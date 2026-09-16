// @vitest-environment node
import { describe, expect, it } from "vitest";
import { signCookieValue, unsignCookieValue } from "../../../farm-integration-utils/src/cookies";

const SECRET = "a".repeat(32);

describe("integration cookie signing", () => {
  it("round-trips a payload", () => {
    const signed = signCookieValue({ state: "abc", returnTo: "/reports" }, SECRET);

    expect(unsignCookieValue<{ state: string; returnTo: string }>(signed, SECRET)).toEqual({
      state: "abc",
      returnTo: "/reports",
    });
  });

  it("rejects a payload edited in transit", () => {
    const signed = signCookieValue({ user: "alice" }, SECRET);
    const [payload, signature] = signed.split(".");
    const tampered = `${Buffer.from(JSON.stringify({ user: "attacker" }), "utf8").toString(
      "base64url",
    )}.${signature}`;

    expect(tampered).not.toBe(signed);
    expect(payload).toBeDefined();
    expect(unsignCookieValue(tampered, SECRET)).toBeNull();
  });

  it("rejects a value signed with a different secret", () => {
    const signed = signCookieValue({ user: "alice" }, "b".repeat(32));

    expect(unsignCookieValue(signed, SECRET)).toBeNull();
  });

  it("rejects missing, empty, and unsigned values", () => {
    expect(unsignCookieValue(undefined, SECRET)).toBeNull();
    expect(unsignCookieValue(null, SECRET)).toBeNull();
    expect(unsignCookieValue("", SECRET)).toBeNull();
    expect(unsignCookieValue("no-separator", SECRET)).toBeNull();
  });

  it("rejects a signature of the wrong length without throwing", () => {
    const signed = signCookieValue({ user: "alice" }, SECRET);
    const [payload] = signed.split(".");

    // timingSafeEqual throws on length mismatch, so this must be guarded.
    expect(() => unsignCookieValue(`${payload}.short`, SECRET)).not.toThrow();
    expect(unsignCookieValue(`${payload}.short`, SECRET)).toBeNull();
  });

  it("rejects a correctly signed payload that is not valid JSON", () => {
    // Sign raw bytes the same way, bypassing JSON.stringify on the way in.
    const payload = Buffer.from("not json", "utf8").toString("base64url");
    const signed = signCookieValue("placeholder", SECRET);
    const secretSignature = signed.split(".")[1];

    expect(secretSignature).toBeDefined();
    expect(unsignCookieValue(`${payload}.${secretSignature}`, SECRET)).toBeNull();
  });
});
