/**
 * `@farm.js/native/elements`: the DOM elements of a page Farm ported to React Native. Farm's port
 * emitter renames each element of a portable `page.tsx` (`<div>` to `<FarmDom.div>`) and leaves
 * the rest of the page alone, so its hooks and handlers run unchanged; these components draw each
 * element with React Native and adapt its DOM props and events.
 *
 * The emitter only ports pages without stylesheets, so elements start from the browser's default
 * styles (Chrome's, approximated) and take the page's inline `style`. Hand-written
 * `page.native.tsx` screens use React Native's components instead.
 */
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  View,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useNavigate } from "./index";
import { FarmScreenContext } from "./runtime";

type Style = Record<string, unknown>;
type Props = Record<string, any> & { children?: ReactNode; style?: Style };

const TEXT_KEYS = new Set([
  "color",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "textAlign",
  "textDecorationLine",
  "textTransform",
]);

const BORDER_WIDTHS = [
  "borderWidth",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
];

const BASE_TEXT: Style = { color: "#000000", fontSize: 16 };
const CONTROL_TEXT: Style = { color: "#000000", fontSize: 13.33 };

/** Chrome's default styles for each element, without a stylesheet. */
const DEFAULTS: Record<string, Style> = {
  h1: { fontSize: 32, fontWeight: "700", marginTop: 21.44, marginBottom: 21.44 },
  h2: { fontSize: 24, fontWeight: "700", marginTop: 19.92, marginBottom: 19.92 },
  h3: { fontSize: 18.72, fontWeight: "700", marginTop: 18.72, marginBottom: 18.72 },
  h4: { fontSize: 16, fontWeight: "700", marginTop: 21.28, marginBottom: 21.28 },
  h5: { fontSize: 13.28, fontWeight: "700", marginTop: 22.18, marginBottom: 22.18 },
  h6: { fontSize: 10.72, fontWeight: "700", marginTop: 24.97, marginBottom: 24.97 },
  p: { marginTop: 16, marginBottom: 16 },
  ul: { marginTop: 16, marginBottom: 16, paddingLeft: 40 },
  ol: { marginTop: 16, marginBottom: 16, paddingLeft: 40 },
  figure: { marginTop: 16, marginBottom: 16, marginLeft: 40, marginRight: 40 },
  strong: { fontWeight: "700" },
  b: { fontWeight: "700" },
  em: { fontStyle: "italic" },
  i: { fontStyle: "italic" },
  small: { fontSize: 13.33 },
  code: { fontFamily: "monospace", fontSize: 13.33 },
  a: { color: "#0000ee", textDecorationLine: "underline" },
  hr: {
    marginTop: 8,
    marginBottom: 8,
    borderTopWidth: 1,
    borderStyle: "solid",
    borderColor: "#808080",
  },
  button: {
    ...CONTROL_TEXT,
    paddingTop: 1,
    paddingBottom: 1,
    paddingLeft: 6,
    paddingRight: 6,
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: "#767676",
    borderRadius: 2,
    backgroundColor: "#efefef",
    alignItems: "center",
  },
  input: {
    ...CONTROL_TEXT,
    paddingTop: 1,
    paddingBottom: 1,
    paddingLeft: 2,
    paddingRight: 2,
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: "#767676",
    backgroundColor: "#ffffff",
  },
};
DEFAULTS.textarea = DEFAULTS.input!;

/** Elements whose box a browser draws without a border style of their own. */
const NATIVE_BORDER = new Set(["button", "input", "textarea", "hr"]);

/** Elements that flow inline in text, and join their neighbours in one `Text`. */
const INLINE_TEXT = new Set(["span", "strong", "em", "b", "i", "small", "code", "label", "br"]);

function px(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const match = /^(-?\d*\.?\d+)(px)?$/.exec(value.trim());
  return match ? Number(match[1]) : value;
}

function sides(style: Style, key: string, value: unknown): void {
  const parts = typeof value === "string" ? value.trim().split(/\s+/).map(px) : [value];
  const [top, right = top, bottom = top, left = right] = parts;
  Object.assign(style, {
    [`${key}Top`]: top,
    [`${key}Right`]: right,
    [`${key}Bottom`]: bottom,
    [`${key}Left`]: left,
  });
}

/**
 * A React DOM inline style as React Native style: `"8px"` lengths become numbers, shorthands with
 * several values expand, logical properties map to physical ones, and `display: flex` defaults to
 * a row, as CSS does.
 */
export function toNativeStyle(style: Style | undefined): Style {
  const out: Style = {};
  if (!style) return out;
  for (const [key, raw] of Object.entries(style)) {
    if (raw === undefined || raw === null || raw === "") continue;
    const value = px(raw);
    if (key === "padding" || key === "margin") sides(out, key, raw);
    else if (key === "paddingInline" || key === "marginInline") {
      out[`${key.slice(0, -6)}Left`] = value;
      out[`${key.slice(0, -6)}Right`] = value;
    } else if (key === "paddingBlock" || key === "marginBlock") {
      out[`${key.slice(0, -5)}Top`] = value;
      out[`${key.slice(0, -5)}Bottom`] = value;
    } else if (key === "fontWeight") out.fontWeight = String(value);
    else if (key === "display") {
      if (value === "flex" || value === "none") out.display = value;
    } else out[key] = value;
  }
  if (out.display === "flex" && out.flexDirection === undefined) out.flexDirection = "row";
  return out;
}

function split(style: Style): { box: Style; text: Style } {
  const box: Style = {};
  const text: Style = {};
  for (const [key, value] of Object.entries(style)) (TEXT_KEYS.has(key) ? text : box)[key] = value;
  return { box, text };
}

/** CSS draws no border without a border style; React Native draws one whenever it has a width. */
function dropUnstyledBorders(tag: string, style: Style): Style {
  if (NATIVE_BORDER.has(tag) || (style.borderStyle && style.borderStyle !== "none")) return style;
  const out = { ...style };
  for (const key of BORDER_WIDTHS) delete out[key];
  return out;
}

/** A unitless `line-height` multiplies the font size; React Native's is in points. */
function resolveLineHeight(style: Style): Style {
  const { lineHeight, fontSize } = style;
  if (typeof lineHeight !== "number" || lineHeight >= 4) return style;
  return { ...style, lineHeight: lineHeight * (typeof fontSize === "number" ? fontSize : 16) };
}

/** The app's CSS for each tag, resolved when Farm emitted the port; see `FarmDomScreen`. */
export type FarmDomSheet = Record<
  string,
  {
    style?: Style;
    dark?: Style;
    /** Text styles the app's CSS sets to `inherit`, such as `font: inherit` on `input`. */
    inherit?: string[];
  }
>;

interface SheetContext {
  sheet: FarmDomSheet;
  dark: boolean;
  /** Tailwind's preflight replaces the browser's default styles. */
  preflight: boolean;
}

const Sheet = createContext<SheetContext>({ sheet: {}, dark: false, preflight: false });

/** A light style with its dark changes, from the app's CSS or Tailwind classes. */
type Themed = { style?: Style; dark?: Style; inherit?: string[] } | undefined;

function themed(context: SheetContext, entry: Themed): Style {
  const style: Style = { ...entry?.style, ...(context.dark ? entry?.dark : undefined) };
  if (typeof style.fontWeight === "number") style.fontWeight = String(style.fontWeight);
  // `sans` is the system's sans-serif (`system-ui`, `sans-serif`): React Native's default font.
  if (style.fontFamily === "sans") delete style.fontFamily;
  if (style.fontFamily === "mono") style.fontFamily = "monospace";
  return style;
}

function sheetStyle(context: SheetContext, tag: string): Style {
  return themed(context, context.sheet[tag]);
}

const CONTROLS = new Set(["button", "input", "textarea"]);
const CONTROL_INHERIT = [
  "color",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
];

/**
 * Tailwind 4's preflight: no margins or padding, a solid zero-width border on every element (so
 * `border` classes draw), headings and links that inherit, lists without markers, and form
 * controls that inherit the page's font and color on a transparent background.
 */
function preflightDefaults(tag: string): Style {
  const style: Style = { borderStyle: "solid" };
  if (tag === "strong" || tag === "b") style.fontWeight = "700";
  if (tag === "em" || tag === "i") style.fontStyle = "italic";
  if (tag === "code") style.fontFamily = "monospace";
  if (tag === "hr") style.borderTopWidth = 1;
  if (CONTROLS.has(tag)) style.backgroundColor = "transparent";
  // A button centers its label, as a browser's does.
  if (tag === "button") style.alignItems = "center";
  return style;
}

/**
 * An element's style: the browser's default, then the app's CSS, then its inline style. A text
 * style the app's CSS sets to `inherit` (`font: inherit` on `input`) comes from the parent, over
 * the browser's default; form controls take no font or color from their parent otherwise.
 */
function useOwn(tag: string, props: Props): Style {
  const context = useContext(Sheet);
  const inherited = useContext(InheritedText);
  const pick = (keys: readonly string[]) =>
    Object.fromEntries(keys.filter((key) => key in inherited).map((key) => [key, inherited[key]]));
  // Set by the emitter for an element with a className: its Tailwind utilities, and the app's
  // rules for its tag and classes, which replace the tag's rules in `sheet`.
  const resolved = props.__farm as { tw?: Themed; css?: Themed } | undefined;
  const css = resolved?.css ?? context.sheet[tag];
  const base = context.preflight ? preflightDefaults(tag) : DEFAULTS[tag];
  const style: Style = {
    ...base,
    ...(context.preflight && CONTROLS.has(tag) ? pick(CONTROL_INHERIT) : {}),
    ...themed(context, resolved?.tw),
    ...pick(css?.inherit ?? []),
    ...themed(context, css),
    ...toNativeStyle(props.style),
  };
  // `small` is 80% of the text around it under preflight.
  if (context.preflight && tag === "small" && style.fontSize === undefined) {
    style.fontSize = (typeof inherited.fontSize === "number" ? inherited.fontSize : 16) * 0.8;
  }
  if (tag === "hr" && style.borderColor === undefined) style.borderColor = inherited.color;
  return dropUnstyledBorders(tag, style);
}

/** Text styles inherited from the boxes above, as CSS inheritance carries them. */
const InheritedText = createContext<Style>(BASE_TEXT);
/** True inside a `Text`, where nested text inherits on its own and boxes cannot go. */
const InText = createContext(false);
/** True when the parent box lays its children out with flex. */
const InFlex = createContext(false);
const ListMarker = createContext<{ type: "disc" | "decimal"; index: number } | null>(null);

function accessibility(props: Props) {
  return {
    ...(props["aria-label"] ? { accessibilityLabel: String(props["aria-label"]) } : {}),
    ...(props["data-testid"] ? { testID: String(props["data-testid"]) } : {}),
  };
}

/** The event a DOM handler expects, with `target.value` for fields. */
function domEvent(type: string, target: Record<string, unknown>, nativeEvent?: unknown) {
  let prevented = false;
  return {
    type,
    target,
    currentTarget: target,
    nativeEvent,
    get defaultPrevented() {
      return prevented;
    },
    preventDefault() {
      prevented = true;
    },
    isDefaultPrevented: () => prevented,
    stopPropagation() {},
    isPropagationStopped: () => false,
    persist() {},
  };
}

function isInline(child: ReactNode): boolean {
  if (typeof child === "string" || typeof child === "number") return true;
  if (!isValidElement(child)) return false;
  const tag = TAGS.get(child.type as ComponentType);
  if (tag && INLINE_TEXT.has(tag)) return true;
  // A link joins the text around it unless it holds boxes.
  if (tag === "a" || child.type === Link) {
    return Children.toArray((child.props as Props).children).every(isInline);
  }
  return false;
}

/** A box's children, with each run of text and inline elements in one `Text`. */
function boxChildren(children: ReactNode, text: Style): ReactNode[] {
  const out: ReactNode[] = [];
  let run: ReactNode[] = [];
  const flush = () => {
    const meaningful = run.some((child) => typeof child !== "string" || child.trim() !== "");
    if (meaningful) {
      out.push(
        <Text key={`text-${out.length}`} style={resolveLineHeight(text) as TextStyle}>
          <InText.Provider value={true}>{run}</InText.Provider>
        </Text>,
      );
    }
    run = [];
  };
  for (const child of Children.toArray(children)) {
    if (isInline(child)) run.push(child);
    else {
      flush();
      out.push(child);
    }
  }
  flush();
  return out;
}

function Box({
  tag,
  props,
  children = props.children,
}: {
  tag: string;
  props: Props;
  children?: ReactNode;
}) {
  const inherited = useContext(InheritedText);
  const inFlex = useContext(InFlex);
  const { box, text } = split(useOwn(tag, props));
  const textStyle = { ...inherited, ...text };
  const style = { ...(inFlex ? { flexShrink: 1 } : {}), ...box } as ViewStyle;
  const content = (
    <InheritedText.Provider value={textStyle}>
      <InFlex.Provider value={box.display === "flex"}>
        {boxChildren(children, textStyle)}
      </InFlex.Provider>
    </InheritedText.Provider>
  );
  if (typeof props.onClick === "function") {
    return (
      <Pressable
        {...accessibility(props)}
        style={style}
        onPress={(event) => props.onClick(domEvent("click", {}, event))}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View {...accessibility(props)} style={style}>
      {content}
    </View>
  );
}

function TextElement({ tag, props }: { tag: string; props: Props }) {
  const inherited = useContext(InheritedText);
  const inText = useContext(InText);
  const style = useOwn(tag, props);
  const onPress =
    typeof props.onClick === "function" ? () => props.onClick(domEvent("click", {})) : undefined;
  if (tag === "br") return <Text>{"\n"}</Text>;
  return (
    <Text
      {...accessibility(props)}
      style={resolveLineHeight(inText ? style : { ...inherited, ...style }) as TextStyle}
      onPress={onPress}
    >
      <InText.Provider value={true}>{props.children}</InText.Provider>
    </Text>
  );
}

function Anchor(props: Props) {
  const navigate = useNavigate();
  const inText = useContext(InText);
  const inherited = useContext(InheritedText);
  const press = () => {
    const event = domEvent("click", { href: props.href });
    if (typeof props.onClick === "function") props.onClick(event);
    if (event.defaultPrevented || typeof props.href !== "string" || props.href.startsWith("#")) {
      return;
    }
    navigate(props.href, { replace: props.replace === true });
  };
  const style = useOwn("a", props);
  if (inText || Children.toArray(props.children).every(isInline)) {
    return (
      <Text
        {...accessibility(props)}
        accessibilityRole="link"
        style={resolveLineHeight(inText ? style : { ...inherited, ...style }) as TextStyle}
        onPress={press}
      >
        <InText.Provider value={true}>{props.children}</InText.Provider>
      </Text>
    );
  }
  const { box, text } = split(style);
  const textStyle = { ...inherited, ...text };
  return (
    <Pressable
      {...accessibility(props)}
      accessibilityRole="link"
      style={box as ViewStyle}
      onPress={press}
    >
      <InheritedText.Provider value={textStyle}>
        <InFlex.Provider value={box.display === "flex"}>
          {boxChildren(props.children, textStyle)}
        </InFlex.Provider>
      </InheritedText.Provider>
    </Pressable>
  );
}

/** `Link` from `@farm.js/core/client`: an anchor that navigates through the shell. */
export function Link(props: Props) {
  return <Anchor {...props} />;
}

function Button(props: Props) {
  const inFlex = useContext(InFlex);
  const { box, text } = split(useOwn("button", props));
  const textStyle = { ...CONTROL_TEXT, ...text };
  return (
    <Pressable
      {...accessibility(props)}
      accessibilityRole="button"
      disabled={props.disabled === true}
      // A button in normal flow is as wide as its label; a flex item stretches.
      style={{ ...(inFlex ? {} : { alignSelf: "flex-start" }), ...box } as ViewStyle}
      onPress={(event) => props.onClick?.(domEvent("click", {}, event))}
    >
      <InheritedText.Provider value={textStyle}>
        {boxChildren(props.children, textStyle)}
      </InheritedText.Provider>
    </Pressable>
  );
}

const KEYBOARDS: Record<string, string> = {
  email: "email-address",
  number: "numeric",
  tel: "phone-pad",
  url: "url",
};

function Field({ tag, props }: { tag: "input" | "textarea"; props: Props }) {
  const style = useOwn(tag, props);
  const type = typeof props.type === "string" ? props.type : "text";
  const change = (value: string) => {
    const event = domEvent("change", { value, name: props.name, type });
    props.onChange?.(event);
    props.onInput?.(event);
  };
  return (
    <TextInput
      {...accessibility(props)}
      // Form controls take no font or color from the page unless its CSS sets them.
      style={resolveLineHeight(style) as TextStyle}
      value={props.value === undefined ? undefined : String(props.value)}
      defaultValue={props.defaultValue === undefined ? undefined : String(props.defaultValue)}
      placeholder={props.placeholder}
      editable={props.disabled !== true && props.readOnly !== true}
      secureTextEntry={type === "password"}
      keyboardType={(KEYBOARDS[type] ?? "default") as "default"}
      autoFocus={props.autoFocus === true}
      maxLength={typeof props.maxLength === "number" ? props.maxLength : undefined}
      multiline={tag === "textarea"}
      numberOfLines={tag === "textarea" && typeof props.rows === "number" ? props.rows : undefined}
      onChangeText={change}
      onFocus={(event) => props.onFocus?.(domEvent("focus", { value: props.value }, event))}
      onBlur={(event) => props.onBlur?.(domEvent("blur", { value: props.value }, event))}
    />
  );
}

/** The image's own size, which a browser uses when the page sets none. */
function useNaturalSize(uri: string, known: boolean): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (known) return;
    let active = true;
    Image.getSize(
      uri,
      (width, height) => active && setSize({ width, height }),
      () => {},
    );
    return () => {
      active = false;
    };
  }, [uri, known]);
  return size;
}

function Img(props: Props) {
  const screen = useContext(FarmScreenContext);
  const src = typeof props.src === "string" ? props.src : "";
  const uri = screen ? new URL(src, screen.url).href : src;
  const style = { ...sheetStyle(useContext(Sheet), "img"), ...toNativeStyle(props.style) };
  const width = style.width ?? px(props.width);
  const height = style.height ?? px(props.height);
  const natural = useNaturalSize(uri, width !== undefined && height !== undefined);
  return (
    <Image
      {...accessibility(props)}
      accessibilityLabel={typeof props.alt === "string" ? props.alt : undefined}
      source={{ uri }}
      style={
        {
          ...natural,
          ...style,
          ...(width !== undefined ? { width } : {}),
          ...(height !== undefined ? { height } : {}),
        } as ImageStyle
      }
      onLoad={() => props.onLoad?.(domEvent("load", { src: uri }))}
      onError={() => props.onError?.(domEvent("error", { src: uri }))}
    />
  );
}

function List({ tag, props }: { tag: "ul" | "ol"; props: Props }) {
  const items = Children.toArray(props.children);
  return (
    <Box
      tag={tag}
      props={props}
      children={items.map((item, index) => (
        <ListMarker.Provider
          key={isValidElement(item) && item.key !== null ? item.key : index}
          value={{ type: tag === "ol" ? "decimal" : "disc", index }}
        >
          {item}
        </ListMarker.Provider>
      ))}
    />
  );
}

function Item(props: Props) {
  const marker = useContext(ListMarker);
  const inherited = useContext(InheritedText);
  const { preflight } = useContext(Sheet);
  const style = useOwn("li", props);
  // Preflight lists have no markers.
  if (!marker || preflight) return <Box tag="li" props={props} />;
  // An outside marker sits left of the item's box, on its first line.
  const top =
    (typeof style.paddingTop === "number" ? style.paddingTop : 0) +
    (typeof style.borderTopWidth === "number" ? style.borderTopWidth : 0);
  return (
    <View style={{ position: "relative" }}>
      <Text
        style={
          { ...inherited, ...split(style).text, position: "absolute", left: -18, top } as TextStyle
        }
      >
        {marker.type === "decimal" ? `${marker.index + 1}.` : "•"}
      </Text>
      <Box tag="li" props={props} />
    </View>
  );
}

const TAGS = new Map<ComponentType, string>();

function element(tag: string, render: (props: Props) => ReactElement | null): ComponentType<Props> {
  const component = (props: Props) => render(props);
  component.displayName = `FarmDom.${tag}`;
  TAGS.set(component, tag);
  return component;
}

const BOX_TAGS = "div section main article header footer nav aside figure hr".split(" ");
const TEXT_TAGS = "p h1 h2 h3 h4 h5 h6 span strong em b i small code label br".split(" ");

/** Each DOM element a port renders, keyed by tag. */
export const FarmDom: Record<string, ComponentType<Props>> = {
  ...Object.fromEntries(
    BOX_TAGS.map((tag) => [tag, element(tag, (props) => <Box tag={tag} props={props} />)]),
  ),
  ...Object.fromEntries(
    TEXT_TAGS.map((tag) => [tag, element(tag, (props) => <TextElement tag={tag} props={props} />)]),
  ),
  a: element("a", (props) => <Anchor {...props} />),
  button: element("button", (props) => <Button {...props} />),
  input: element("input", (props) => <Field tag="input" props={props} />),
  textarea: element("textarea", (props) => <Field tag="textarea" props={props} />),
  img: element("img", (props) => <Img {...props} />),
  ul: element("ul", (props) => <List tag="ul" props={props} />),
  ol: element("ol", (props) => <List tag="ol" props={props} />),
  li: element("li", (props) => <Item {...props} />),
};

const SIDES = ["Top", "Right", "Bottom", "Left"] as const;

/**
 * The screen around a ported page: it scrolls like the document. The canvas, the inherited text
 * style, and the body's margin come from the app's CSS for `html` and `body` (`sheet`, which
 * Farm's emitter resolves), over the browser's white canvas, black text, and 8px margin. Dark
 * rules apply when the device is in dark mode.
 */
export function FarmDomScreen({
  children,
  sheet = {},
  preflight = false,
}: {
  children?: ReactNode;
  sheet?: FarmDomSheet;
  /** The app's CSS imports Tailwind, whose preflight replaces the browser's defaults. */
  preflight?: boolean;
}) {
  const context = { sheet, dark: useColorScheme() === "dark", preflight };
  const html = sheetStyle(context, "html");
  const body = sheetStyle(context, "body");
  const text = {
    ...BASE_TEXT,
    ...(preflight ? { lineHeight: 1.5 } : {}),
    ...split(html).text,
    ...split(body).text,
  };
  const padding: Style = {};
  for (const side of SIDES) {
    const margin = body[`margin${side}`] ?? (preflight ? 0 : 8);
    const inner = body[`padding${side}`] ?? 0;
    padding[`padding${side}`] =
      (typeof margin === "number" ? margin : 0) + (typeof inner === "number" ? inner : 0);
  }
  return (
    <Sheet.Provider value={context}>
      <ScrollView
        style={
          {
            backgroundColor: body.backgroundColor ?? html.backgroundColor ?? "#ffffff",
          } as ViewStyle
        }
        contentContainerStyle={padding as ViewStyle}
        // A tap on a button acts at once, as in a browser, even while the keyboard is open.
        keyboardShouldPersistTaps="handled"
      >
        <InheritedText.Provider value={text}>{boxChildren(children, text)}</InheritedText.Provider>
      </ScrollView>
    </Sheet.Provider>
  );
}
