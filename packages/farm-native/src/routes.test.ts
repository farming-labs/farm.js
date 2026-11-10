import { describe, expect, it } from "vitest";
import { matchFarmRoute, resolveFarmHref } from "./routes";

describe("matchFarmRoute", () => {
  it("reads params, catch-alls, and optional catch-alls", () => {
    expect(matchFarmRoute("/notes/[id]", "/notes/7")).toEqual({ id: "7" });
    expect(matchFarmRoute("/notes/[id]", "/notes/hello%20world/")).toEqual({ id: "hello world" });
    expect(matchFarmRoute("/docs/[...slug]", "/docs/a/b")).toEqual({ slug: ["a", "b"] });
    expect(matchFarmRoute("/docs/[...slug]", "/docs")).toBeNull();
    expect(matchFarmRoute("/shop/[[...rest]]", "/shop")).toEqual({ rest: [] });
    expect(matchFarmRoute("/map", "/map")).toEqual({});
    expect(matchFarmRoute("/map", "/maps")).toBeNull();
    expect(matchFarmRoute("/notes/[id]", "/notes/7/edit")).toBeNull();
  });

  it("strips the base path and a locale prefix, as the client router does", () => {
    const options = { basePath: "/app", locales: ["en", "es"] };
    expect(matchFarmRoute("/notes/[id]", "/app/notes/7", options)).toEqual({ id: "7" });
    expect(matchFarmRoute("/notes/[id]", "/app/ES/notes/7", options)).toEqual({ id: "7" });
    expect(matchFarmRoute("/notes/[id]", "/notes/7", options)).toBeNull();
    // A first segment that is a param value, not a locale prefix.
    expect(matchFarmRoute("/[lang]", "/app/es", options)).toEqual({ lang: "es" });
  });
});

describe("resolveFarmHref", () => {
  const base = "https://notes.example.com/notes/7?tab=a#top";

  it("resolves links like a browser does", () => {
    expect(resolveFarmHref("/about", base)).toBe("https://notes.example.com/about");
    expect(resolveFarmHref("edit", base)).toBe("https://notes.example.com/notes/edit");
    expect(resolveFarmHref("../map?x=1", base)).toBe("https://notes.example.com/map?x=1");
    expect(resolveFarmHref("?tab=b", base)).toBe("https://notes.example.com/notes/7?tab=b");
    expect(resolveFarmHref("#bottom", base)).toBe("https://notes.example.com/notes/7?tab=a#bottom");
    expect(resolveFarmHref("//cdn.example.com/x", base)).toBe("https://cdn.example.com/x");
    expect(resolveFarmHref("https://other.example.com/", base)).toBe("https://other.example.com/");
    expect(resolveFarmHref("mailto:a@example.com", base)).toBe("mailto:a@example.com");
    expect(resolveFarmHref("/docs/", base)).toBe("https://notes.example.com/docs/");
  });
});
