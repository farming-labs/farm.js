import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The picker's handlers, run without a DOM: its two hooks hold one ref and one unmount cleanup.
const hooks = vi.hoisted(() => ({
  ref: { current: undefined as string | undefined },
  cleanups: [] as Array<() => void>,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: () => hooks.ref,
  useEffect: (effect: () => (() => void) | void) => {
    const cleanup = effect();
    if (cleanup) hooks.cleanups.push(cleanup);
  },
}));

const { PhotoPicker } = await import("../index");

type Props = Record<string, any>;
const element = (props: Parameters<typeof PhotoPicker>[0]) =>
  PhotoPicker(props) as ReactElement<Props>;

afterEach(() => {
  hooks.ref.current = undefined;
  hooks.cleanups.length = 0;
  vi.unstubAllGlobals();
});

describe("PhotoPicker on the web", () => {
  it("renders a label around an image-only file input, styled by token props", () => {
    const html = renderToStaticMarkup(
      <PhotoPicker onPick={() => {}} padding="sm" radius="md" background="accent">
        Choose a photo
      </PhotoPicker>,
    );
    expect(html).toMatch(/^<label/);
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/*"');
    expect(html).toContain("padding:8px");
    expect(html).toContain("border-radius:8px");
    expect(html).toContain("--farm-color-accent");
    expect(html).toContain("Choose a photo");
  });

  it("hands onPick an object URL and revokes the previous one and the last on unmount", () => {
    let next = 0;
    const revoked: string[] = [];
    vi.stubGlobal("URL", {
      createObjectURL: () => `blob:photo-${++next}`,
      revokeObjectURL: (url: string) => revoked.push(url),
    });
    const picked: string[] = [];
    const label = element({ onPick: (uri) => picked.push(uri) });
    const input = (label.props.children as ReactElement<Props>[])[1]!;
    const change = (file?: object) => {
      const target = { files: file ? [file] : [], value: "C:\\fakepath\\photo.jpg" };
      input.props.onChange({ currentTarget: target });
      return target;
    };

    expect(change({ name: "a.jpg" }).value).toBe("");
    change({ name: "b.jpg" });
    change();
    expect(picked).toEqual(["blob:photo-1", "blob:photo-2"]);
    expect(revoked).toEqual(["blob:photo-1"]);
    hooks.cleanups.forEach((cleanup) => cleanup());
    expect(revoked).toEqual(["blob:photo-1", "blob:photo-2"]);
  });

  it("with pick, is a button that calls it, skips a cancel, and routes a rejection to onError", async () => {
    const picked: string[] = [];
    const errors: unknown[] = [];
    const results = [
      Promise.resolve("/__farm/files/abc"),
      Promise.resolve(null),
      Promise.reject(new Error("no_activity")),
    ];
    const button = element({
      pick: () => results.shift()!,
      onPick: (uri) => picked.push(uri),
      onError: (error) => errors.push(error),
    });
    expect(button.type).toBe("button");
    for (let i = 0; i < 3; i++) button.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(picked).toEqual(["/__farm/files/abc"]);
    expect(errors).toEqual([new Error("no_activity")]);
  });

  it("passes disabled to the control", () => {
    expect(renderToStaticMarkup(<PhotoPicker onPick={() => {}} disabled />)).toContain("disabled");
    expect(
      renderToStaticMarkup(
        <PhotoPicker onPick={() => {}} pick={async () => null} disabled>
          x
        </PhotoPicker>,
      ),
    ).toContain('<button type="button" disabled');
  });
});
