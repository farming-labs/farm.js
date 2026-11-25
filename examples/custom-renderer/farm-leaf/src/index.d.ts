import type { FarmIslandAttributes, FarmRenderer } from "@farm.js/core/renderer";

export declare function leaf(): FarmRenderer;

declare module "leaf/jsx-runtime" {
  namespace JSX {
    // `<Counter client:visible />` sets when one island starts, where it's used.
    interface IntrinsicAttributes extends FarmIslandAttributes {}
  }
}
