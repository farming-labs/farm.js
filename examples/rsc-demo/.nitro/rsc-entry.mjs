globalThis.__VITE_RSC_LOAD_SSR__ = () => import("./vite/dist/ssr/index.js");
import * as entryExports from "./vite/dist/rsc/index.js";
import { fromWebHandler } from "h3";

function getFetchHandler(exports) {
  const def = exports?.default;
  if (def && typeof def === "object" && "fetch" in def && typeof def.fetch === "function") return def.fetch;
  if (typeof def === "function") return def;
  throw new Error("Invalid RSC server handler: expected default.fetch or default function");
}

const handler = getFetchHandler(entryExports);
export default fromWebHandler(handler);