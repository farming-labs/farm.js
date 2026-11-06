import { boxStyle, type BoxStyleProps } from "./styles";

export type TextInputType = "text" | "search" | "email" | "password" | "number" | "tel" | "url";

export interface TextInputProps extends Omit<
  BoxStyleProps,
  "direction" | "gap" | "align" | "justify"
> {
  value?: string;
  defaultValue?: string;
  /** Called with the new string value (not the DOM event). */
  onChange?: (value: string) => void;
  placeholder?: string;
  type?: TextInputType;
  disabled?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  name?: string;
  className?: string;
  "aria-label"?: string;
}

/** A single-line text field. `onChange` receives the string value directly. */
export function TextInput({
  value,
  defaultValue,
  onChange,
  placeholder,
  type = "text",
  disabled,
  readOnly,
  autoFocus,
  name,
  className,
  "aria-label": ariaLabel,
  ...style
}: TextInputProps) {
  return (
    <input
      type={type}
      value={value}
      defaultValue={defaultValue}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={readOnly}
      autoFocus={autoFocus}
      name={name}
      aria-label={ariaLabel}
      className={className}
      onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      style={boxStyle(style)}
    />
  );
}
