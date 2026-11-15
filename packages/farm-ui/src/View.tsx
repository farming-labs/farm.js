import type { ReactNode } from "react";

import { boxStyle, type BoxStyleProps } from "./styles";

/** The HTML element `View` renders as on the web. Defaults to `div`. */
export type ViewElement =
  | "div"
  | "section"
  | "main"
  | "header"
  | "footer"
  | "nav"
  | "article"
  | "aside";

export interface ViewProps extends BoxStyleProps {
  children?: ReactNode;
  className?: string;
  id?: string;
  role?: string;
  as?: ViewElement;
}

/**
 * A layout container. On the web it is a flex box (column by default, as on
 * native), so `direction`, `gap`, `align` and `justify` behave the same here
 * and on a native screen.
 */
export function View({ children, className, id, role, as: Tag = "div", ...style }: ViewProps) {
  return (
    <Tag
      className={className}
      id={id}
      role={role}
      style={{ display: "flex", flexDirection: style.direction ?? "column", ...boxStyle(style) }}
    >
      {children}
    </Tag>
  );
}
