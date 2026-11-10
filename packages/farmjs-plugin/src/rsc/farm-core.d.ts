declare module "@farm.js/core" {
  import type { Plugin } from "vite";
  export const farmApiPlugin: (options?: {
    srcDir?: string;
    apiDir?: string;
    debug?: boolean;
    bodySizeLimit?: number | string;
    plugins?: (context: {
      root: string;
    }) => readonly { name: string }[] | Promise<readonly { name: string }[]>;
  }) => Plugin;
  export const farmMiddlewarePlugin: (options?: { srcDir?: string; debug?: boolean }) => Plugin;
}
