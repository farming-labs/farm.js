/**
 * `@farm.js/ui` on a React Native screen. Metro resolves `@farm.js/ui` to this module through the
 * `react-native` export condition, so a screen written with `View`, `Text`, `List`, ... renders
 * native views here and DOM on the web, from the same props.
 *
 * Tokens resolve to the web build's values as numbers and colors: `padding="md"` is 12, `surface`
 * is `#f6f6f6` (a CSS theme's `--farm-color-*` overrides do not reach native screens yet). A
 * `style` prop is the web's CSS object; its simple values (lengths, colors, flex) carry over, and
 * `className` has no effect without CSS.
 */
import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  FlatList,
  Image as NativeImage,
  Pressable as NativePressable,
  Text as NativeText,
  TextInput as NativeTextInput,
  View as NativeView,
  type ImageStyle,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { toNativeStyle } from "./elements";
import { _useNavigateInScreen, serverUrl } from "./index";

type Style = Record<string, unknown>;

const SPACE: Record<string, number> = { none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32 };
const RADIUS: Record<string, number> = { none: 0, sm: 4, md: 8, lg: 12, card: 12, full: 9999 };
const COLOR: Record<string, string> = {
  background: "#ffffff",
  surface: "#f6f6f6",
  muted: "#6b7280",
  border: "#e5e7eb",
  text: "#111111",
  accent: "#2f6f4f",
  accentText: "#ffffff",
};
const TEXT_SIZE: Record<string, number> = {
  xs: 12,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  "2xl": 28,
  "3xl": 34,
};
const TEXT_WEIGHT: Record<string, string> = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
};

function length(value: number | string | undefined): number | string | undefined {
  if (value == null) return undefined;
  if (typeof value === "number") return value;
  const px = /^(-?\d*\.?\d+)px$/.exec(value.trim());
  return px ? Number(px[1]) : value;
}

/** A space token as a length: `"md"` is 12. Raw numbers and `"8px"` pass through. */
export function space(value: number | string | undefined): number | string | undefined {
  if (value == null) return undefined;
  return typeof value === "string" && value in SPACE ? SPACE[value] : length(value);
}

/** A radius token as a length: `"card"` is 12. */
export function radius(value: number | string | undefined): number | string | undefined {
  if (value == null) return undefined;
  return typeof value === "string" && value in RADIUS ? RADIUS[value] : length(value);
}

/** A color token as a color: `"surface"` is `#f6f6f6`. Raw colors pass through. */
export function color(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  return COLOR[value] ?? value;
}

interface BoxProps {
  padding?: number | string;
  paddingX?: number | string;
  paddingY?: number | string;
  margin?: number | string;
  marginX?: number | string;
  marginY?: number | string;
  gap?: number | string;
  direction?: "row" | "column";
  align?: string;
  justify?: string;
  flex?: number;
  grow?: boolean;
  wrap?: boolean;
  background?: string;
  radius?: number | string;
  borderColor?: string;
  borderWidth?: number;
  width?: number | string;
  height?: number | string;
  style?: Style;
}

/**
 * CSS alignment keywords React Native spells differently. `start` and `end` work in CSS flexbox
 * but not in Yoga, which wants `flex-start` and `flex-end`.
 */
const FLEX_ALIGN: Record<string, string> = { start: "flex-start", end: "flex-end" };

function flexAlign(value: string | undefined): string | undefined {
  return value == null ? undefined : (FLEX_ALIGN[value] ?? value);
}

/** The ARIA role a web element carries on its own, so the native view announces the same. */
const ELEMENT_ROLES: Record<string, string> = {
  nav: "navigation",
  main: "main",
  article: "article",
  aside: "complementary",
  section: "region",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
};

/** An explicit `role` wins, as on the web; otherwise the `as` element's own role. */
function roleOf(role: string | undefined, as: string | undefined): ViewProps["role"] {
  return (role ?? (as != null ? ELEMENT_ROLES[as] : undefined)) as ViewProps["role"];
}

function boxStyle(props: BoxProps): Style {
  const style: Style = {};
  const set = (key: string, value: unknown) => {
    if (value !== undefined) style[key] = value;
  };
  set("padding", space(props.padding));
  set("paddingHorizontal", space(props.paddingX));
  set("paddingVertical", space(props.paddingY));
  set("margin", space(props.margin));
  set("marginHorizontal", space(props.marginX));
  set("marginVertical", space(props.marginY));
  set("gap", space(props.gap));
  set("flexDirection", props.direction);
  set("alignItems", flexAlign(props.align));
  set("justifyContent", flexAlign(props.justify));
  set("flex", props.flex);
  if (props.grow) style.flexGrow = 1;
  if (props.wrap) style.flexWrap = "wrap";
  set("backgroundColor", color(props.background));
  set("borderRadius", radius(props.radius));
  if (props.borderColor != null || props.borderWidth != null) {
    style.borderWidth = props.borderWidth ?? 1;
    style.borderColor = color(props.borderColor ?? "border");
  }
  set("width", length(props.width));
  set("height", length(props.height));
  return { ...style, ...toNativeStyle(props.style) };
}

function nativeChildren(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string" || typeof child === "number")
      return <NativeText>{child}</NativeText>;
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) {
      return cloneElement(child, undefined, nativeChildren(child.props.children));
    }
    return child;
  });
}

export function View(
  props: BoxProps & { children?: ReactNode; "aria-label"?: string; role?: string; as?: string },
) {
  return (
    <NativeView
      accessibilityLabel={props["aria-label"]}
      role={roleOf(props.role, props.as)}
      style={boxStyle(props) as ViewStyle}
    >
      {nativeChildren(props.children)}
    </NativeView>
  );
}

export function Text(props: {
  children?: ReactNode;
  size?: number | string;
  weight?: number | string;
  color?: string;
  align?: string;
  numberOfLines?: number;
  /** The web element; `h1` to `h6` make the native text a heading for screen readers. */
  as?: string;
  style?: Style;
}) {
  const style: Style = { ...toNativeStyle(props.style) };
  if (props.size != null) {
    style.fontSize =
      typeof props.size === "number" ? props.size : (TEXT_SIZE[props.size] ?? length(props.size));
  }
  if (props.weight != null) {
    style.fontWeight =
      typeof props.weight === "number"
        ? String(props.weight)
        : (TEXT_WEIGHT[props.weight] ?? props.weight);
  }
  if (props.color != null) style.color = color(props.color);
  if (props.align != null) style.textAlign = props.align;
  return (
    <NativeText
      role={roleOf(undefined, props.as)}
      style={style as TextStyle}
      numberOfLines={props.numberOfLines}
      ellipsizeMode={props.numberOfLines != null ? "tail" : undefined}
    >
      {props.children}
    </NativeText>
  );
}

const FIT: Record<string, "cover" | "contain" | "stretch" | "center"> = {
  cover: "cover",
  contain: "contain",
  fill: "stretch",
  none: "center",
  "scale-down": "contain",
};

/** The image's width and height in pixels, once read; undefined while loading or on failure. */
function useNaturalSize(uri: string | undefined): { width: number; height: number } | undefined {
  const [size, setSize] = useState<{ uri: string; width: number; height: number }>();
  useEffect(() => {
    if (uri == null) return;
    let current = true;
    NativeImage.getSize(
      uri,
      (width, height) => {
        if (current && width > 0 && height > 0) setSize({ uri, width, height });
      },
      // An image that cannot be read stays unsized, as it would draw nothing anyway.
      () => {},
    );
    return () => {
      current = false;
    };
  }, [uri]);
  return size && size.uri === uri ? size : undefined;
}

export function Image(props: {
  src: string;
  alt?: string;
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  fit?: string;
  style?: Style;
}) {
  // A path loads from the app's server, as the web page loads it from its own origin.
  const uri = /^[a-z][a-z\d+.-]*:/i.test(props.src) ? props.src : serverUrl(props.src);
  const style: Style = { ...toNativeStyle(props.style) };
  if (props.width != null) style.width = length(props.width);
  if (props.height != null) style.height = length(props.height);
  if (props.radius != null) style.borderRadius = radius(props.radius);
  // React Native draws a remote or file image at 0x0 until it is given a size. The web's img takes
  // its natural size, or keeps its aspect ratio when given one side, so read the size from the file.
  const sized = style.width != null && style.height != null;
  const natural = useNaturalSize(sized ? undefined : uri);
  if (natural) {
    if (style.width == null && style.height == null) {
      style.width = natural.width;
      style.height = natural.height;
    } else {
      style.aspectRatio = natural.width / natural.height;
    }
  }
  return (
    <NativeImage
      source={{ uri }}
      accessibilityLabel={props.alt || undefined}
      accessible={Boolean(props.alt)}
      resizeMode={FIT[props.fit ?? "cover"] ?? "cover"}
      style={style as ImageStyle}
    />
  );
}

export function Pressable(
  props: BoxProps & {
    children?: ReactNode;
    onPress?: () => void;
    href?: string;
    disabled?: boolean;
    "aria-label"?: string;
  },
) {
  const navigate = _useNavigateInScreen();
  const press = () => {
    props.onPress?.();
    if (props.href != null) navigate(props.href);
  };
  const style = boxStyle(props);
  return (
    <NativePressable
      accessibilityRole={props.href != null ? "link" : "button"}
      accessibilityLabel={props["aria-label"]}
      disabled={props.disabled}
      onPress={press}
      // The press feedback a native control gives.
      style={({ pressed }) => ({ ...style, ...(pressed ? { opacity: 0.6 } : {}) }) as ViewStyle}
    >
      {nativeChildren(props.children)}
    </NativePressable>
  );
}

const KEYBOARDS: Record<
  string,
  "default" | "email-address" | "numeric" | "phone-pad" | "url" | "web-search"
> = {
  email: "email-address",
  number: "numeric",
  tel: "phone-pad",
  url: "url",
  search: "web-search",
};

export function TextInput(
  props: Omit<BoxProps, "direction" | "gap" | "align" | "justify"> & {
    value?: string;
    defaultValue?: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    type?: string;
    disabled?: boolean;
    readOnly?: boolean;
    autoFocus?: boolean;
    "aria-label"?: string;
  },
) {
  return (
    <NativeTextInput
      accessibilityLabel={props["aria-label"]}
      value={props.value}
      defaultValue={props.defaultValue}
      onChangeText={props.onChange}
      placeholder={props.placeholder}
      keyboardType={KEYBOARDS[props.type ?? "text"] ?? "default"}
      secureTextEntry={props.type === "password"}
      editable={props.disabled !== true && props.readOnly !== true}
      autoFocus={props.autoFocus}
      style={boxStyle(props) as TextStyle}
    />
  );
}

interface ListRow {
  title: ReactNode;
  subtitle?: ReactNode;
  image?: string;
  badge?: ReactNode;
  href?: string;
  onPress?: () => void;
}

function Row({ row }: { row: ListRow }) {
  const content = (
    <View direction="row" align="center" gap="md" paddingX="md" paddingY="sm">
      {row.image != null ? <Image src={row.image} width={40} height={40} radius="md" /> : null}
      <View flex={1} gap="xs">
        <Text weight="semibold">{row.title}</Text>
        {row.subtitle != null ? (
          <Text size="sm" color="muted">
            {row.subtitle}
          </Text>
        ) : null}
      </View>
      {row.badge != null ? <View>{row.badge}</View> : null}
    </View>
  );
  if (row.href != null || row.onPress != null) {
    return (
      <Pressable href={row.href} onPress={row.onPress}>
        {content}
      </Pressable>
    );
  }
  return content;
}

/** The web's list as a recycling `FlatList`: rows render as they scroll into view. */
export function List<T>(props: {
  items: readonly T[];
  row: (item: T, index: number) => ListRow;
  keyExtractor?: (item: T, index: number) => string | number;
  empty?: ReactNode;
  /** Reserved, as on the web: no pull-to-refresh yet. */
  refreshable?: boolean;
  /** Reserved, as on the web: no search bar yet. */
  searchable?: boolean;
}) {
  return (
    <FlatList
      data={props.items as T[]}
      keyExtractor={(item, index) =>
        String(props.keyExtractor ? props.keyExtractor(item, index) : index)
      }
      renderItem={({ item, index }) => <Row row={props.row(item, index)} />}
      ListEmptyComponent={props.empty != null ? <View>{props.empty}</View> : undefined}
    />
  );
}
