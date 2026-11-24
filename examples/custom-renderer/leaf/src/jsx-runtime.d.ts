import type { AsyncComponent, Children, Component, Key, LeafElement, Ref } from "./index.js";

export { Fragment } from "./index.js";

export declare function jsx(type: unknown, props: Record<string, unknown>, key?: Key): LeafElement;
export declare const jsxs: typeof jsx;
export declare const jsxDEV: typeof jsx;

type EventHandler = (event: any) => void;

/** Attributes leaf writes as written, plus React-style names it maps (className, htmlFor). */
export interface HTMLAttributes {
  children?: Children;
  key?: Key;
  ref?: Ref<any>;
  className?: string;
  style?: string | Record<string, string | number | null | undefined>;
  dangerouslySetInnerHTML?: { __html: string };
  [attribute: `on${string}`]: EventHandler | undefined;
  [attribute: string]: unknown;
}

export declare namespace JSX {
  type Element = LeafElement;
  type ElementType = string | Component<any> | AsyncComponent<any>;
  interface ElementChildrenAttribute {
    children: {};
  }
  interface IntrinsicAttributes {
    key?: Key;
  }
  interface IntrinsicElements {
    [tag: string]: HTMLAttributes;
  }
}
