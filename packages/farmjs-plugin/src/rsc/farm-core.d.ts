declare module "@farm.js/core" {
  import type { Plugin } from "vite";
  export const farmApiPlugin: (options?: { srcDir?: string; debug?: boolean }) => Plugin;
  export const farmMiddlewarePlugin: (options?: { srcDir?: string; debug?: boolean }) => Plugin;
}
