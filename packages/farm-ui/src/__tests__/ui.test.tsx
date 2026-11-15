import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Image, List, Pressable, Text, TextInput, View } from "../index";

describe("@farm.js/ui web rendering", () => {
  it("View renders a flex div with token padding", () => {
    const html = renderToStaticMarkup(
      <View padding="md">
        <Text>hi</Text>
      </View>,
    );
    expect(html).toContain("<div");
    expect(html).toContain("display:flex");
    expect(html).toContain("padding:12px");
    expect(html).toContain("<span");
    expect(html).toContain("hi");
  });

  it("View maps direction, gap and background tokens", () => {
    const html = renderToStaticMarkup(
      <View direction="row" gap="sm" background="surface" radius="card" />,
    );
    expect(html).toContain("flex-direction:row");
    expect(html).toContain("gap:8px");
    expect(html).toContain("--farm-color-surface");
    expect(html).toContain("border-radius:12px");
  });

  it("Text applies size, weight and color", () => {
    const html = renderToStaticMarkup(
      <Text size="lg" weight="semibold" color="muted">
        title
      </Text>,
    );
    expect(html).toContain("font-size:18px");
    expect(html).toContain("font-weight:600");
    expect(html).toContain("--farm-color-muted");
  });

  it("Pressable renders an anchor when given href", () => {
    const html = renderToStaticMarkup(<Pressable href="/notes/7">open</Pressable>);
    expect(html).toContain("<a ");
    expect(html).toContain('href="/notes/7"');
    expect(html).toContain("open");
  });

  it("Pressable renders a button otherwise", () => {
    const html = renderToStaticMarkup(<Pressable>tap</Pressable>);
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
  });

  it("TextInput renders an input with placeholder", () => {
    const html = renderToStaticMarkup(<TextInput value="" placeholder="Search" />);
    expect(html).toContain("<input");
    expect(html).toContain('placeholder="Search"');
  });

  it("Image renders an img with alt and radius", () => {
    const html = renderToStaticMarkup(<Image src="/a.png" alt="A" radius="md" />);
    expect(html).toContain("<img");
    expect(html).toContain('alt="A"');
    expect(html).toContain('src="/a.png"');
    expect(html).toContain("border-radius:8px");
  });

  it("List renders rows from a template, with links", () => {
    const items = [
      { id: "1", t: "First" },
      { id: "2", t: "Second" },
    ];
    const html = renderToStaticMarkup(
      <List
        items={items}
        keyExtractor={(x) => x.id}
        row={(x) => ({ title: x.t, href: `/i/${x.id}` })}
      />,
    );
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html).toContain("First");
    expect(html).toContain("Second");
    expect(html).toContain('href="/i/1"');
  });

  it("List shows the empty state when there are no items", () => {
    const html = renderToStaticMarkup(
      <List items={[]} row={() => ({ title: "" })} empty={<Text>Nothing here</Text>} />,
    );
    expect(html).toContain("Nothing here");
    expect(html).not.toContain("<ul");
  });
});
