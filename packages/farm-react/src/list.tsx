import React from "react";
import { materializeIterable } from "./iterable";

export interface ListProps<Item> {
  /** Items to render. Nullish collections are treated as empty. */
  each: Iterable<Item> | null | undefined;
  /** Returns the stable React key for one item. */
  by(item: Item, index: number): React.Key;
  /** Renders one keyed row. */
  children(item: Item, index: number): React.ReactElement;
}

/**
 * An explicit keyed collection boundary for advanced list expressions.
 *
 * It behaves like ordinary React when the compiler is disabled. With the
 * experimental compiler enabled, eligible usages are isolated so local list
 * updates do not execute the surrounding user component.
 */
export function List<Item>({ each, by, children }: ListProps<Item>): React.ReactElement {
  const rows = materializeIterable(each);
  return React.createElement(
    React.Fragment,
    null,
    ...rows.map((item, index) => {
      const row = children(item, index);
      if (!React.isValidElement(row)) {
        throw new TypeError("@farm.js/react List children must return one React element.");
      }
      return React.cloneElement(row, { key: by(item, index) } as React.Attributes);
    }),
  );
}
