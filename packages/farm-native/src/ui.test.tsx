import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import * as web from "../../farm-ui/src/tokens";

// React Native's components as plain elements that keep their props, so a test reads the tree.
const handlers: Record<string, Record<string, (...args: any[]) => void>> = {};
const visits: Array<[number, string, boolean]> = [];
vi.mock("react-native", () => {
  const host =
    (name: string) =>
    ({
      children,
      style,
      data,
      renderItem,
      keyExtractor,
      ListEmptyComponent,
      ...props
    }: Record<string, any>) => {
      const label = props.accessibilityLabel ?? props.placeholder;
      if (label) {
        handlers[label] = Object.fromEntries(
          Object.entries(props).filter(([, value]) => typeof value === "function"),
        );
      }
      const resolved = typeof style === "function" ? style({ pressed: false }) : style;
      const rows = Array.isArray(data)
        ? data.length === 0
          ? ListEmptyComponent
          : data.map((item: unknown, index: number) =>
              createElement(
                "rn-row",
                { key: keyExtractor(item, index) },
                renderItem({ item, index }),
              ),
            )
        : null;
      return createElement(
        `rn-${name}`,
        {
          ...(resolved ? { "data-style": JSON.stringify(resolved) } : {}),
          ...Object.fromEntries(
            Object.entries(props)
              .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
              .map(([key, value]) => [`data-${key.toLowerCase()}`, String(value)]),
          ),
          ...(props.source ? { "data-uri": props.source.uri } : {}),
        },
        rows ?? children,
      );
    };
  return {
    View: host("view"),
    Text: host("text"),
    Pressable: host("pressable"),
    TextInput: host("textinput"),
    Image: host("image"),
    FlatList: host("flatlist"),
    NativeModules: {
      FarmShell: {
        visit: (screen: number, url: string, replace: boolean) =>
          visits.push([screen, url, replace]),
      },
    },
  };
});

const ui = await import("./ui");
const { FarmScreenContext, farmApp } = await import("./runtime");

const screen = {
  screen: 3,
  url: "https://notes.example.com/notes",
  route: "/notes",
  server: "https://notes.example.com",
  params: {},
  basePath: "",
};

function render(node: React.ReactNode, inScreen = true): string {
  return renderToStaticMarkup(
    inScreen ? createElement(FarmScreenContext.Provider, { value: screen }, node) : node,
  );
}

function styleOf(html: string, tag: string, index = 0): Record<string, unknown> {
  const matches = [...html.matchAll(new RegExp(`<rn-${tag} data-style="([^"]*)"`, "g"))];
  return JSON.parse(matches[index]![1]!.replaceAll("&quot;", '"'));
}

describe("@farm.js/ui on a native screen", () => {
  it("keeps literal View, Pressable, empty-state and badge text inside native Text", () => {
    const nodes = [
      createElement(ui.View, null, "Notes", 3),
      createElement(ui.Pressable, null, createElement(Fragment, null, "Save", 2)),
      createElement(ui.List, { items: [], row: () => ({ title: "x" }), empty: "No notes" }),
      createElement(ui.List, {
        items: [1],
        row: () => ({ title: "Creek", badge: 0 }),
      }),
    ];
    for (const node of nodes) {
      const html = render(node);
      const parents: string[] = [];
      for (const token of html.matchAll(/<\/?([\w-]+)[^>]*>|([^<]+)/g)) {
        if (token[2]) {
          expect(parents.at(-1), `Raw text ${token[2]} in ${html}`).toBe("rn-text");
        } else if (token[0].startsWith("</")) parents.pop();
        else parents.push(token[1]!);
      }
    }
  });

  it("resolves the web build's tokens to numbers and colors", () => {
    // The same token tables as @farm.js/ui's web build.
    for (const token of ["none", "xs", "sm", "md", "lg", "xl", "2xl"]) {
      expect(ui.space(token)).toBe(Number.parseFloat(web.space(token)!));
    }
    for (const token of ["none", "sm", "md", "lg", "card", "full"]) {
      expect(ui.radius(token)).toBe(Number.parseFloat(web.radius(token)!));
    }
    for (const token of [
      "background",
      "surface",
      "muted",
      "border",
      "text",
      "accent",
      "accentText",
    ]) {
      expect(web.color(token)).toBe(`var(--farm-color-${token}, ${ui.color(token)})`);
    }
    expect(ui.space(10)).toBe(10);
    expect(ui.space("6px")).toBe(6);
    expect(ui.color("#ff0000")).toBe("#ff0000");
  });

  it("draws View and Text from their props", () => {
    const html = render(
      createElement(
        ui.View,
        {
          padding: "md",
          gap: "sm",
          direction: "row",
          background: "surface",
          radius: "card",
          borderWidth: 2,
        },
        createElement(
          ui.Text,
          { size: "lg", weight: "semibold", color: "muted", numberOfLines: 2 },
          "Notes",
        ),
      ),
    );
    expect(styleOf(html, "view")).toEqual({
      padding: 12,
      gap: 8,
      flexDirection: "row",
      backgroundColor: "#f6f6f6",
      borderRadius: 12,
      borderWidth: 2,
      borderColor: "#e5e7eb",
    });
    expect(styleOf(html, "text")).toEqual({ fontSize: 18, fontWeight: "600", color: "#6b7280" });
    expect(html).toContain('data-numberoflines="2" data-ellipsizemode="tail"');
  });

  it("navigates an href through the shell, and works outside a screen without one", () => {
    const onPress = vi.fn();
    render(
      createElement(ui.Pressable, { href: "/notes/7", onPress, "aria-label": "open" }, "Open"),
    );
    handlers.open!.onPress!();
    expect(onPress).toHaveBeenCalledOnce();
    expect(visits).toEqual([[3, "https://notes.example.com/notes/7", false]]);
    // A button with no href needs no screen.
    const tap = vi.fn();
    render(createElement(ui.Pressable, { onPress: tap, "aria-label": "tap" }, "Tap"), false);
    handlers.tap!.onPress!();
    expect(tap).toHaveBeenCalledOnce();
  });

  it("gives TextInput's onChange the string, as on the web", () => {
    const onChange = vi.fn();
    const html = render(
      createElement(ui.TextInput, {
        placeholder: "Search",
        type: "email",
        onChange,
        padding: "sm",
      }),
    );
    expect(html).toContain('data-keyboardtype="email-address"');
    expect(styleOf(html, "textinput")).toEqual({ padding: 8 });
    handlers.Search!.onChangeText!("ada@example.com");
    expect(onChange).toHaveBeenCalledWith("ada@example.com");
  });

  it("spells CSS start and end alignment the way Yoga reads it", () => {
    const html = render(createElement(ui.View, { align: "start", justify: "end" }));
    expect(styleOf(html, "view")).toEqual({ alignItems: "flex-start", justifyContent: "flex-end" });
    const raw = render(createElement(ui.View, { align: "center", justify: "space-between" }));
    expect(styleOf(raw, "view")).toEqual({ alignItems: "center", justifyContent: "space-between" });
  });

  it("gives native views the role their web element or role prop carries", () => {
    expect(render(createElement(ui.Text, { as: "h2" }, "Notes"))).toContain('data-role="heading"');
    expect(render(createElement(ui.Text, { as: "p" }, "Body"))).not.toContain("data-role");
    expect(render(createElement(ui.View, { as: "nav" }))).toContain('data-role="navigation"');
    // An explicit role wins over the element's, as on the web.
    expect(render(createElement(ui.View, { as: "section", role: "list" }))).toContain(
      'data-role="list"',
    );
    expect(render(createElement(ui.View, {}))).not.toContain("data-role");
  });

  it("renders List rows through a FlatList, and loads images from the app's server", () => {
    farmApp.server = "https://notes.example.com";
    const notes = [
      { id: "1", title: "Creek", image: "/creek.jpg" },
      { id: "2", title: "Ridge" },
    ];
    const html = render(
      createElement(ui.List, {
        items: notes,
        keyExtractor: (note: (typeof notes)[number]) => note.id,
        row: (note: (typeof notes)[number]) => ({
          title: note.title,
          image: note.image,
          href: `/notes/${note.id}`,
        }),
      }),
    );
    expect(html.match(/<rn-row>/g)).toHaveLength(2);
    expect(html).toContain('data-uri="https://notes.example.com/creek.jpg"');
    expect(html).toContain("Creek");
    expect(
      render(createElement(ui.List, { items: [], row: () => ({ title: "x" }), empty: "No notes" })),
    ).toContain("No notes");
  });
});
