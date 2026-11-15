import type { CSSProperties, ReactNode } from "react";

import { boxStyle, type BoxStyleProps } from "./styles";

export interface PressableProps extends BoxStyleProps {
  children?: ReactNode;
  /** Called on tap/click. */
  onPress?: () => void;
  /** When set, renders an anchor and the tap navigates to this URL. */
  href?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

const RESET: CSSProperties = {
  display: "flex",
  background: "none",
  border: "none",
  padding: 0,
  margin: 0,
  font: "inherit",
  color: "inherit",
  textAlign: "inherit",
  textDecoration: "none",
};

/**
 * A tappable element. Renders an anchor when given `href` (so it is a real
 * link), otherwise a button. `onPress` is the tap handler on both.
 */
export function Pressable({
  children,
  onPress,
  href,
  disabled,
  className,
  "aria-label": ariaLabel,
  ...style
}: PressableProps) {
  const css: CSSProperties = {
    ...RESET,
    flexDirection: style.direction ?? "column",
    cursor: disabled ? "default" : "pointer",
    ...boxStyle(style),
  };

  if (href != null) {
    return (
      <a
        href={href}
        className={className}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        style={css}
        onClick={
          disabled ? (event) => event.preventDefault() : onPress ? () => onPress() : undefined
        }
      >
        {children}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel}
      disabled={disabled}
      style={css}
      onClick={disabled ? undefined : onPress}
    >
      {children}
    </button>
  );
}
