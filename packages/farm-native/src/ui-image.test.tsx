import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Image's size lookup, run without a renderer: one state slot and its effect, run on demand.
const hooks = vi.hoisted(() => ({
  state: undefined as unknown,
  effect: undefined as (() => (() => void) | void) | undefined,
  sizes: [] as Array<{ uri: string; success: (width: number, height: number) => void }>,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: () => [hooks.state, (next: unknown) => (hooks.state = next)],
  useEffect: (effect: () => (() => void) | void) => {
    hooks.effect = effect;
  },
}));
vi.mock("react-native", () => {
  const Image = () => null;
  Image.getSize = (uri: string, success: (width: number, height: number) => void) =>
    hooks.sizes.push({ uri, success });
  return {
    FlatList: () => null,
    Image,
    Pressable: () => null,
    Text: () => null,
    TextInput: () => null,
    View: () => null,
    NativeModules: {},
  };
});

const ui = await import("./ui");

type Props = Record<string, any>;
const styleOf = (props: Parameters<typeof ui.Image>[0]) =>
  (ui.Image(props) as ReactElement<Props>).props.style;

afterEach(() => {
  hooks.state = undefined;
  hooks.effect = undefined;
  hooks.sizes.length = 0;
});

describe("Image on a native screen", () => {
  it("takes the file's natural size when given none, as the web's img does", () => {
    const src = "file:///data/user/0/app/cache/farm-files/photo.jpg";
    expect(styleOf({ src })).toEqual({});
    hooks.effect!();
    expect(hooks.sizes.map((size) => size.uri)).toEqual([src]);
    hooks.sizes[0]!.success(1200, 800);
    expect(styleOf({ src })).toEqual({ width: 1200, height: 800 });
  });

  it("keeps the aspect ratio when given one side", () => {
    const src = "https://notes.example.com/creek.jpg";
    styleOf({ src, height: 160 });
    hooks.effect!();
    hooks.sizes[0]!.success(1200, 800);
    expect(styleOf({ src, height: 160 })).toEqual({ height: 160, aspectRatio: 1.5 });
  });

  it("reads nothing when both sides are set, and ignores an answer after unmount", () => {
    styleOf({ src: "file:///a.jpg", width: 40, height: 40 });
    hooks.effect!();
    expect(hooks.sizes).toEqual([]);

    styleOf({ src: "file:///b.jpg" });
    const cleanup = hooks.effect!() as () => void;
    cleanup();
    hooks.sizes[0]!.success(10, 10);
    expect(hooks.state).toBeUndefined();
  });

  it("drops a size read for another src", () => {
    styleOf({ src: "file:///a.jpg" });
    hooks.effect!();
    hooks.sizes[0]!.success(10, 20);
    expect(styleOf({ src: "file:///b.jpg" })).toEqual({});
  });
});
