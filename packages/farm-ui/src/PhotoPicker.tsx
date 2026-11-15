import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

import { boxStyle, type BoxStyleProps } from "./styles";

export interface PhotoPickerProps extends BoxStyleProps {
  /** The control's content, such as `"Choose a photo"`. The picker adds no visuals of its own. */
  children?: ReactNode;
  /** Called with the picked photo's URL, which `Image` shows on the web and on native screens. */
  onPick: (uri: string) => void;
  /**
   * Picks with a native module instead of the browser: `native.Device.pickPhoto` on a web screen
   * in the app, or `Device.pickPhoto` on a native screen. Resolve null when the user backs out.
   * Without it the web build opens the browser's file picker, and the native build is disabled.
   */
  pick?: () => Promise<string | null | undefined>;
  /** Called when `pick` rejects. Without it the rejection is left unhandled. */
  onError?: (error: unknown) => void;
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
};

// Hidden but still focusable, so the label's control stays reachable from the keyboard.
const HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  border: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

/**
 * An unstyled control that picks one photo. On the web it is a label around a file input
 * (`accept="image/*"`) and hands `onPick` an object URL, which it revokes on the next pick and on
 * unmount. Given `pick`, it is a button that calls `pick` instead, which is how a web screen in
 * the app reaches a native module. Styling is the same token props as `Pressable`.
 */
export function PhotoPicker({
  children,
  onPick,
  pick,
  onError,
  disabled,
  className,
  "aria-label": ariaLabel,
  ...style
}: PhotoPickerProps) {
  // The object URL this picker created last; the browser keeps its file until it is revoked.
  const objectUrl = useRef<string | undefined>(undefined);
  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );
  const css: CSSProperties = {
    ...RESET,
    flexDirection: style.direction ?? "column",
    cursor: disabled ? "default" : "pointer",
    ...boxStyle(style),
  };

  if (pick) {
    return (
      <button
        type="button"
        className={className}
        aria-label={ariaLabel}
        disabled={disabled}
        style={css}
        onClick={() => {
          pick().then((uri) => {
            if (uri) onPick(uri);
          }, onError);
        }}
      >
        {children}
      </button>
    );
  }

  return (
    <label className={className} aria-label={ariaLabel} style={{ ...css, position: "relative" }}>
      {children}
      <input
        type="file"
        accept="image/*"
        disabled={disabled}
        style={HIDDEN}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // Picking the same photo again fires another change.
          event.currentTarget.value = "";
          if (!file) return;
          if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
          objectUrl.current = URL.createObjectURL(file);
          onPick(objectUrl.current);
        }}
      />
    </label>
  );
}
