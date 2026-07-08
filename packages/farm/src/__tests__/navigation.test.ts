import { describe, expect, it } from "vitest";
import {
  getFarmRedirectError,
  isFarmNotFoundError,
  isFarmRedirectError,
  notFound,
  permanentRedirect,
  redirect,
} from "../navigation";

describe("Next-compatible navigation helpers", () => {
  it("throws a redirect signal with location and status", () => {
    try {
      redirect("/sign-in");
    } catch (error) {
      expect(isFarmRedirectError(error)).toBe(true);
      expect(getFarmRedirectError(error)).toEqual({
        url: "/sign-in",
        status: 307,
      });
    }
  });

  it("supports permanent redirects", () => {
    try {
      permanentRedirect("/new-home");
    } catch (error) {
      expect(getFarmRedirectError(error)).toEqual({
        url: "/new-home",
        status: 308,
      });
    }
  });

  it("throws a not-found signal", () => {
    try {
      notFound();
    } catch (error) {
      expect(isFarmNotFoundError(error)).toBe(true);
      expect(isFarmRedirectError(error)).toBe(false);
    }
  });
});
