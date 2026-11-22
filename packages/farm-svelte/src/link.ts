import type { Component, Snippet } from "svelte";
import type { HTMLAnchorAttributes } from "svelte/elements";
import type { FarmLinkOptions } from "@farm.js/core/renderer-client";

/**
 * The props of the Svelte `Link`. A Svelte component's props are not generic over its `href`, so
 * `href` takes any generated route or route pattern and `params` is not checked against it, as in
 * the Vue `Link`. The React and Solid `Link`s check both.
 */
export type FarmSvelteLinkProps = Omit<FarmLinkOptions, "href" | "params"> &
  Omit<HTMLAnchorAttributes, "href" | "children"> & {
    href: FarmLinkOptions["href"];
    params?: FarmLinkOptions<string>["params"];
    children?: Snippet;
  };

/**
 * An anchor that navigates and prefetches through the FARMJS router, with the same props as the
 * React `Link`. Other attributes and event handlers go on the `<a>`.
 */
declare const Link: Component<FarmSvelteLinkProps>;
export default Link;
