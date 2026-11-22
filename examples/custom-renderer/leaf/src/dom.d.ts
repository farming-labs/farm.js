import type { Children } from "./index.js";

export interface Root {
  render(element: Children): void;
  unmount(): void;
}

export declare function createRoot(container: Element): Root;
export declare function hydrateRoot(container: Element, element: Children): Root;
