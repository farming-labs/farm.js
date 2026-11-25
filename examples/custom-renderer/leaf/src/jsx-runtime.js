// The automatic JSX runtime: `jsxImportSource: "leaf"` compiles <p /> to jsx("p", props).

import { Fragment, createElement } from "./index.js";

export { Fragment };

export function jsx(type, props, key) {
  return createElement(type, key === undefined ? props : { ...props, key });
}

export const jsxs = jsx;
export const jsxDEV = jsx;
