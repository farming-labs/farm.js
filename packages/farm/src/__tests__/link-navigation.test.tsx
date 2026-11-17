/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { Link, type LinkProps } from "../client/link";
import { readFarmLinkNavigateOptions } from "../client/link-navigation";

/** The anchor a page that never hydrates ships for a `Link`: its server HTML. */
function serverAnchor(props: Partial<LinkProps>): Element {
  document.body.innerHTML = renderToString(
    createElement(Link, { href: "/about", ...props } as LinkProps, "About") as ReactElement,
  );
  return document.querySelector("a")!;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("readFarmLinkNavigateOptions", () => {
  it.each([
    [{}, { replace: false, scroll: true, viewTransition: false }],
    [{ replace: true }, { replace: true, scroll: true, viewTransition: false }],
    [{ scroll: false }, { replace: false, scroll: false, viewTransition: false }],
    [{ viewTransition: true }, { replace: false, scroll: true, viewTransition: true }],
    [{ viewTransition: "auto" }, { replace: false, scroll: true, viewTransition: "auto" }],
    [{ viewTransition: false }, { replace: false, scroll: true, viewTransition: false }],
    [
      { replace: true, scroll: false, viewTransition: "auto" },
      { replace: true, scroll: false, viewTransition: "auto" },
    ],
  ] as const)("reads back the options Link wrote for %j", (props, expected) => {
    expect(readFarmLinkNavigateOptions(serverAnchor(props as Partial<LinkProps>))).toEqual(
      expected,
    );
  });

  it("gives a plain anchor the router's defaults", () => {
    document.body.innerHTML = '<a href="/about">About</a>';
    expect(readFarmLinkNavigateOptions(document.querySelector("a")!)).toEqual({
      replace: false,
      scroll: true,
      viewTransition: false,
    });
  });
});
