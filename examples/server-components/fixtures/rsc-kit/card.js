// A server component of the react-server build, reached through `export *`, that renders a
// "use client" module the package does not export.
import { createElement as h } from "react";
import { KitCopy } from "./copy.js";

export async function KitCard({ title }) {
  await Promise.resolve();
  return h(
    "div",
    { "data-testid": "kit-card" },
    h("p", null, `${title}, rendered on the server`),
    h(KitCopy, null),
  );
}
