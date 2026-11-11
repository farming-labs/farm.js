import { describe, expect, it } from "vitest";
import { withBotCsp } from "./csp";

const CF = "https://js.acme.example";
const acme = { "script-src": [CF], "frame-src": [CF] };
const beta = Object.fromEntries(
  ["script-src", "frame-src", "style-src", "connect-src"].map((directive) => [
    directive,
    ["https://beta.example", "https://*.beta.example"],
  ]),
);
const gamma = {
  "script-src": ["https://gamma.example/widget/", "https://static.gamma.example/widget/"],
  "frame-src": ["https://gamma.example/widget/", "https://frames.gamma.example/widget/"],
  "connect-src": ["https://gamma.example/widget/"],
};

describe("withBotCsp", () => {
  it("leaves an app without a CSP alone", () => {
    expect(withBotCsp(undefined, acme)).toBeUndefined();
    expect(withBotCsp(false, acme)).toBe(false);
  });

  it("adds the widget origin to script-src and frame-src in a policy string", () => {
    expect(withBotCsp("default-src 'self'; script-src 'self'; frame-src 'self'", acme)).toBe(
      `default-src 'self'; script-src 'self' ${CF}; frame-src 'self' ${CF}`,
    );
  });

  it("copies default-src into a missing directive instead of narrowing it", () => {
    expect(withBotCsp("default-src 'self' https:", acme)).toBe(
      `default-src 'self' https:; script-src 'self' https: ${CF}; frame-src 'self' https: ${CF}`,
    );
  });

  it("uses child-src before default-src for frames", () => {
    expect(withBotCsp("default-src 'self'; child-src 'self' blob:", acme)).toContain(
      `frame-src 'self' blob: ${CF}`,
    );
  });

  it("keeps unrestricted directives unrestricted", () => {
    expect(withBotCsp("img-src 'self'", acme)).toBe("img-src 'self'");
  });

  it("replaces 'none' and leaves '*' alone", () => {
    expect(withBotCsp("script-src *; frame-src 'none'", acme)).toBe(
      `script-src *; frame-src ${CF}`,
    );
  });

  it("also opens script-src-elem when the policy sets it", () => {
    expect(withBotCsp("script-src 'self'; script-src-elem 'self'", acme)).toBe(
      `script-src 'self' ${CF}; script-src-elem 'self' ${CF}`,
    );
  });

  it("follows the first of a repeated directive, as browsers do", () => {
    expect(withBotCsp("script-src 'self'; script-src https:", acme)).toBe(
      `script-src 'self' ${CF}`,
    );
  });

  it("does not add a source twice", () => {
    const policy = `script-src 'self' ${CF}; frame-src ${CF}`;
    expect(withBotCsp(policy, acme)).toBe(policy);
  });

  it("merges directives objects in their own key style and keeps other options", () => {
    expect(
      withBotCsp(
        {
          nonce: true,
          directives: { defaultSrc: "'self'", "script-src": ["'self'"], imgSrc: ["'self'"] },
        },
        acme,
      ),
    ).toEqual({
      nonce: true,
      directives: {
        defaultSrc: "'self'",
        "script-src": ["'self'", CF],
        imgSrc: ["'self'"],
        "frame-src": ["'self'", CF],
      },
    });
  });

  it("merges the policy and resolved value forms", () => {
    expect(withBotCsp({ policy: "script-src 'self'", reportOnly: true }, acme)).toEqual({
      policy: `script-src 'self' ${CF}`,
      reportOnly: true,
    });
    expect(withBotCsp({ value: "frame-src 'self'" }, acme)).toEqual({
      value: `frame-src 'self' ${CF}`,
    });
  });

  it("opens every directive a provider lists", () => {
    expect(withBotCsp("default-src 'self'", beta)).toBe(
      [
        "default-src 'self'",
        "script-src 'self' https://beta.example https://*.beta.example",
        "frame-src 'self' https://beta.example https://*.beta.example",
        "style-src 'self' https://beta.example https://*.beta.example",
        "connect-src 'self' https://beta.example https://*.beta.example",
      ].join("; "),
    );
  });

  it("copies default-src for any fetch directive a custom provider needs", () => {
    expect(withBotCsp("default-src 'self'", { "img-src": ["https://i.acme.example"] })).toBe(
      "default-src 'self'; img-src 'self' https://i.acme.example",
    );
    expect(withBotCsp("default-src 'self'", { "font-src": ["https://f.acme.example"] })).toBe(
      "default-src 'self'; font-src 'self' https://f.acme.example",
    );
  });

  it("follows the worker-src and script-src-elem fallback chains", () => {
    expect(
      withBotCsp("default-src 'none'; script-src 'self'", { "worker-src": ["https://w.example"] }),
    ).toBe("default-src 'none'; script-src 'self'; worker-src 'self' https://w.example");
    expect(withBotCsp("script-src 'self'", { "script-src-elem": ["https://s.example"] })).toBe(
      "script-src 'self'; script-src-elem 'self' https://s.example",
    );
  });

  it("finds a directive key however the app wrote it", () => {
    expect(
      withBotCsp(
        { directives: { "Script-Src": ["'self'"] } },
        { "script-src": ["https://a.example"] },
      ),
    ).toEqual({ directives: { "Script-Src": ["'self'", "https://a.example"] } });
  });

  it("keeps the paths a provider's sources are scoped to", () => {
    expect(withBotCsp("script-src 'self'; frame-src 'none'", gamma)).toBe(
      "script-src 'self' https://gamma.example/widget/ https://static.gamma.example/widget/; frame-src https://gamma.example/widget/ https://frames.gamma.example/widget/",
    );
  });
});
