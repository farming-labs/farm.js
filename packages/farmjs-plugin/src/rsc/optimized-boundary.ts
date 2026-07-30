import { render, type RenderOptions, type StrataDocument } from "@farming-labs/strata";
import {
  StaticFragment,
  type StaticFragmentBoundary,
  type StaticFragmentProps,
} from "@farming-labs/strata/react-server";
import type { ReactElement } from "react";

export type {
  RenderOptions,
  StrataDocument,
  StrataElement,
  StrataNode,
  StrataTag,
  StrataText,
} from "@farming-labs/strata";

export interface OptimizedBoundaryProps extends Omit<StaticFragmentProps, "content"> {
  /**
   * Typed host-only content. Client Components, refs, effects, and event
   * handlers must remain outside the boundary.
   */
  document: StrataDocument;
  renderOptions?: RenderOptions;
}

/**
 * Render a typed host-only document with the optimized native runtime and
 * place it inside an opaque React-owned boundary.
 *
 * Enable `experimental.optimizedBoundary` before importing this component.
 */
export function OptimizedBoundary({
  document,
  renderOptions,
  ...props
}: OptimizedBoundaryProps): ReactElement {
  const content = render(document, renderOptions);
  return StaticFragment({
    ...props,
    content,
  });
}

export type OptimizedBoundaryTag = StaticFragmentBoundary;
