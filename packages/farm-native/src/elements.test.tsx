import { createElement, useState, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// React Native's components as plain elements that keep their props, so a test reads the tree.
const pressed: Record<string, () => void> = {};
const scheme = { current: "light" as "light" | "dark" };
const changed: Record<string, (text: string) => void> = {};
vi.mock("react-native", () => {
  const host =
    (name: string) =>
    ({
      children,
      style,
      contentContainerStyle,
      onPress,
      onChangeText,
      testID,
      ...props
    }: Record<string, any>) => {
      if (testID && onPress) pressed[testID] = onPress;
      if (testID && onChangeText) changed[testID] = onChangeText;
      return createElement(
        `rn-${name}`,
        {
          ...(style ? { "data-style": JSON.stringify(style) } : {}),
          ...(contentContainerStyle
            ? { "data-content": JSON.stringify(contentContainerStyle) }
            : {}),
          ...(testID ? { "data-testid": testID } : {}),
          ...(onPress ? { "data-press": "" } : {}),
          ...Object.fromEntries(
            Object.entries(props)
              .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
              .map(([key, value]) => [`data-${key.toLowerCase()}`, String(value)]),
          ),
        },
        children,
      );
    };
  return {
    View: host("view"),
    Text: host("text"),
    Pressable: host("pressable"),
    TextInput: host("textinput"),
    Image: Object.assign(host("image"), { getSize: () => {} }),
    ScrollView: host("scrollview"),
    useColorScheme: () => scheme.current,
    NativeModules: {},
  };
});

const { FarmDom, FarmDomScreen, Link, toNativeStyle } = await import("./elements");
const { FarmScreenContext } = await import("./runtime");

const screen = {
  screen: 1,
  url: "https://notes.example.com/lab/packing",
  route: "/lab/packing",
  server: "https://notes.example.com",
  params: {},
  basePath: "",
};

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(FarmScreenContext.Provider, { value: screen }, node));
}

function styleOf(html: string, tag: string, index = 0): Record<string, unknown> {
  const matches = [...html.matchAll(new RegExp(`<rn-${tag} data-style="([^"]*)"`, "g"))];
  return JSON.parse(matches[index]![1]!.replaceAll("&quot;", '"'));
}

const { div, p, h1, span, strong, button, input, ul, li } = FarmDom as Record<string, any>;

describe("FarmDom", () => {
  it("reads DOM inline styles as React Native styles", () => {
    expect(
      toNativeStyle({
        display: "flex",
        padding: "8px 12px",
        marginInline: 4,
        fontWeight: 700,
        width: "50%",
        gap: "12px",
      }),
    ).toEqual({
      display: "flex",
      flexDirection: "row",
      paddingTop: 8,
      paddingRight: 12,
      paddingBottom: 8,
      paddingLeft: 12,
      marginLeft: 4,
      marginRight: 4,
      fontWeight: "700",
      width: "50%",
      gap: 12,
    });
    // `display: block` is a column of boxes, which a View already is.
    expect(toNativeStyle({ display: "block", flexDirection: "column" })).toEqual({
      flexDirection: "column",
    });
  });

  it("puts text in Text, with the box's text styles and the browser's defaults", () => {
    const html = render(
      createElement(
        div,
        { style: { color: "#555555", padding: 16 } },
        createElement(h1, null, "Packing list"),
        "3 items, ",
        createElement(strong, null, "packed"),
        createElement(p, null, "Ready"),
      ),
    );
    // The box keeps its box styles; its text styles reach the text.
    expect(styleOf(html, "view")).toEqual({
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
    });
    expect(styleOf(html, "text", 0)).toMatchObject({
      color: "#555555",
      fontSize: 32,
      fontWeight: "700",
      marginTop: 21.44,
    });
    // Text and an inline element between blocks share one Text, as a line box does.
    expect(html).toContain("3 items, <rn-text");
    expect(styleOf(html, "text", 1)).toEqual({ color: "#555555", fontSize: 16 });
    // Nested text inherits from its Text, so it carries only its own style.
    expect(styleOf(html, "text", 2)).toEqual({ fontWeight: "700" });
    expect(styleOf(html, "text", 3)).toMatchObject({ color: "#555555", marginTop: 16 });
  });

  it("draws a border only with a border style, as CSS does", () => {
    const html = render(
      createElement(
        "rn-root",
        null,
        createElement(div, { style: { borderBottomWidth: 1, borderColor: "#eeeeee" } }, "a"),
        createElement(div, { style: { borderWidth: 1, borderStyle: "solid" } }, "b"),
      ),
    );
    expect(styleOf(html, "view", 0)).toEqual({ borderColor: "#eeeeee" });
    expect(styleOf(html, "view", 1)).toEqual({ borderWidth: 1, borderStyle: "solid" });
  });

  it("runs the page's own handlers with DOM-shaped events", () => {
    function Packing() {
      const [items, setItems] = useState(["Map"]);
      const [draft, setDraft] = useState("");
      return createElement(
        div,
        { style: { display: "flex", flexDirection: "column" } },
        createElement(input, {
          value: draft,
          placeholder: "Add an item",
          "data-testid": "draft",
          onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
        }),
        createElement(
          button,
          {
            "data-testid": "add",
            onClick: () => {
              setItems([...items, draft]);
              setDraft("");
            },
          },
          "Add",
        ),
        createElement(
          ul,
          null,
          items.map((item) => createElement(li, { key: item }, item)),
        ),
      );
    }
    const html = render(createElement(Packing));
    expect(html).toContain('data-placeholder="Add an item"');
    // An unordered list marks each item with a disc outside its box.
    expect(html).toMatch(
      /&quot;position&quot;:&quot;absolute&quot;,&quot;left&quot;:-18,&quot;top&quot;:0\}">•<\/rn-text>/,
    );
    // A flex item stretches; the button's label takes the button's text style.
    expect(styleOf(html, "pressable")).not.toHaveProperty("alignSelf");
    expect(html).toMatch(
      /<rn-pressable[^>]*><rn-text data-style="\{&quot;color&quot;:&quot;#000000&quot;,&quot;fontSize&quot;:13.33\}">Add/,
    );
    // The handlers get what they read from a DOM event.
    const onChange = vi.fn();
    render(createElement(input, { "data-testid": "field", name: "title", onChange }));
    changed.field!("Headlamp");
    expect(onChange.mock.calls[0]![0].target).toEqual({
      value: "Headlamp",
      name: "title",
      type: "text",
    });
    const onClick = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    render(createElement(button, { "data-testid": "go", onClick }, "Go"));
    pressed.go!();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps a button in normal flow as wide as its label", () => {
    const html = render(createElement(div, null, createElement(button, null, "Add")));
    expect(styleOf(html, "pressable")).toMatchObject({
      alignSelf: "flex-start",
      backgroundColor: "#efefef",
    });
  });

  it("joins a text-only link to the text around it", () => {
    const html = render(
      createElement(
        div,
        null,
        "Back ",
        createElement(Link, { href: "/" }, "home"),
        createElement(span, null, "!"),
      ),
    );
    expect(html).toMatch(
      /^<rn-view[^>]*><rn-text[^>]*>Back <rn-text[^>]*data-accessibilityrole="link"[^>]*>home<\/rn-text><rn-text[^>]*>!<\/rn-text><\/rn-text><\/rn-view>$/,
    );
    expect(styleOf(html, "text", 1)).toEqual({ color: "#0000ee", textDecorationLine: "underline" });
  });

  it("scrolls the page on the browser's canvas, with the body's margin", () => {
    const html = render(createElement(FarmDomScreen, null, createElement(p, null, "Hi")));
    expect(html).toMatch(
      /^<rn-scrollview data-style="\{&quot;backgroundColor&quot;:&quot;#ffffff&quot;\}" data-content="\{&quot;paddingTop&quot;:8,&quot;paddingRight&quot;:8,&quot;paddingBottom&quot;:8,&quot;paddingLeft&quot;:8\}" data-keyboardshouldpersisttaps="handled">/,
    );
    expect(styleOf(html, "text")).toMatchObject({ color: "#000000", fontSize: 16, marginTop: 16 });
  });

  it("applies the app's CSS per tag, light and dark, and the body's canvas and margin", () => {
    const sheet = {
      html: { style: { fontFamily: "system-ui" } },
      body: {
        style: {
          marginTop: 0,
          marginRight: 0,
          marginBottom: 0,
          marginLeft: 0,
          backgroundColor: "#f7f7f4",
          color: "#1c1f1d",
        },
        dark: { backgroundColor: "#141614", color: "#e8ebe7" },
      },
      h1: { style: { fontSize: 24 } },
      input: {
        style: { backgroundColor: "#ffffff" },
        dark: { backgroundColor: "#1d211e" },
        inherit: ["fontFamily", "fontSize"],
      },
    };
    const page = createElement(
      FarmDomScreen,
      { sheet },
      createElement(h1, null, "Packing list"),
      createElement(input, { style: { padding: 8 } }),
    );
    const light = render(page);
    expect(styleOf(light, "scrollview")).toEqual({ backgroundColor: "#f7f7f4" });
    // body { margin: 0 } replaces the browser's 8px.
    expect(light).toContain(
      'data-content="{&quot;paddingTop&quot;:0,&quot;paddingRight&quot;:0,&quot;paddingBottom&quot;:0,&quot;paddingLeft&quot;:0}"',
    );
    // The app's h1 rule wins over the browser's 32px; its margins stay the browser's.
    expect(styleOf(light, "text")).toMatchObject({
      color: "#1c1f1d",
      fontFamily: "system-ui",
      fontSize: 24,
      marginTop: 21.44,
    });
    // Inline style still wins over the app's CSS; `font: inherit` takes the page's 16px font
    // over the control's 13.33px.
    expect(styleOf(light, "textinput")).toMatchObject({
      backgroundColor: "#ffffff",
      paddingTop: 8,
      fontSize: 16,
      fontFamily: "system-ui",
      color: "#000000",
    });
    scheme.current = "dark";
    try {
      const dark = render(page);
      expect(styleOf(dark, "scrollview")).toEqual({ backgroundColor: "#141614" });
      expect(styleOf(dark, "text")).toMatchObject({ color: "#e8ebe7" });
      expect(styleOf(dark, "textinput")).toMatchObject({ backgroundColor: "#1d211e" });
    } finally {
      scheme.current = "light";
    }
  });

  it("starts from Tailwind's preflight, then utilities, then the app's rules, then inline style", () => {
    const sheet = { h1: { style: { fontSize: 26 } } };
    const html = render(
      createElement(
        FarmDomScreen,
        { sheet, preflight: true },
        createElement(
          "rn-root",
          null,
          createElement(
            h1,
            { __farm: { tw: { style: { fontSize: 30, color: "#101828" } } } },
            "Notes",
          ),
          createElement(
            div,
            {
              __farm: {
                tw: {
                  style: { borderBottomWidth: 1, paddingTop: 16 },
                  dark: { backgroundColor: "#000000" },
                },
                css: { style: { paddingTop: 12 } },
              },
            },
            "Body",
          ),
          createElement(ul, null, createElement(li, null, "One")),
          createElement(input, { value: "x" }),
        ),
      ),
    );
    // No body margin; the page's text has a 1.5 line height.
    expect(html).toContain(
      'data-content="{&quot;paddingTop&quot;:0,&quot;paddingRight&quot;:0,&quot;paddingBottom&quot;:0,&quot;paddingLeft&quot;:0}"',
    );
    // The app's unlayered h1 rule beats the text-3xl utility, as cascade layers order them.
    expect(styleOf(html, "text", 0)).toMatchObject({
      fontSize: 26,
      color: "#101828",
      lineHeight: 39,
    });
    expect(styleOf(html, "text", 0)).not.toHaveProperty("marginTop");
    // Preflight's solid zero-width border lets `border-b` draw; the app's padding beats `pt-4`.
    expect(styleOf(html, "view", 0)).toMatchObject({
      borderStyle: "solid",
      borderBottomWidth: 1,
      paddingTop: 12,
    });
    // Lists have no markers; inputs take the page's font and color on a transparent background.
    expect(html).not.toContain("•");
    expect(styleOf(html, "textinput")).toMatchObject({
      backgroundColor: "transparent",
      fontSize: 16,
      color: "#000000",
      lineHeight: 24,
    });
  });
});
