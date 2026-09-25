import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  conditionalRuntimeFeature,
  conditionalRangesRuntimeFeature,
  hostConditionalRuntimeFeature,
  keyedRangesRuntimeFeature,
  keyedRowsRuntimeFeature,
  mixedRangesRuntimeFeature,
  type CompilerHostElement,
  type CompilerRuntimeFeatureOwner,
} from "../compiler-runtime";

const roots = new Set<Root>();

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.clear();
  document.body.replaceChildren();
});

describe("structural block lifecycle replay", () => {
  it("moves retained conditional roots when a compatible definition shifts their block ids", async () => {
    const rootsById = new Map<number, Element>();
    const listeners = new Map<number, Parameters<CompilerRuntimeFeatureOwner["subscribe"]>[1]>();
    const owner: CompilerRuntimeFeatureOwner = {
      setRoot(id: number, root: Element | null, expectedRoot?: Element | null) {
        if (!root && expectedRoot !== undefined && rootsById.get(id) !== expectedRoot) return;
        if (root) rootsById.set(id, root);
        else rootsById.delete(id);
      },
      subscribe(id, refresh) {
        listeners.set(id, refresh);
        return () => {
          if (listeners.get(id) === refresh) listeners.delete(id);
        };
      },
    };
    const Block = conditionalRuntimeFeature.create(owner).Conditional!;
    const renderBlocks = (offset: number, replaceRoots = false) => (
      <main>
        <Block
          id={offset}
          render={() =>
            replaceRoots ? (
              <article>
                <span>First</span>
              </article>
            ) : (
              <section>
                <span>First</span>
              </section>
            )
          }
        />
        <Block
          id={offset + 1}
          render={() =>
            replaceRoots ? (
              <div>
                <span>Second</span>
              </div>
            ) : (
              <aside>
                <span>Second</span>
              </aside>
            )
          }
        />
      </main>
    );

    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    roots.add(root);
    await act(async () => root.render(renderBlocks(0)));
    const firstRoot = target.querySelector("section")!;
    const secondRoot = target.querySelector("aside")!;
    expect([...rootsById]).toEqual([
      [0, firstRoot],
      [1, secondRoot],
    ]);

    await act(async () => root.render(renderBlocks(1)));
    expect(target.querySelector("section")).toBe(firstRoot);
    expect(target.querySelector("aside")).toBe(secondRoot);
    expect([...rootsById]).toEqual([
      [1, firstRoot],
      [2, secondRoot],
    ]);
    expect([...listeners.keys()]).toEqual([1, 2]);

    await act(async () => root.render(renderBlocks(2, true)));
    const replacementFirstRoot = target.querySelector("article")!;
    const replacementSecondRoot = target.querySelector("main > div")!;
    expect([...rootsById]).toEqual([
      [2, replacementFirstRoot],
      [3, replacementSecondRoot],
    ]);
    expect([...listeners.keys()]).toEqual([2, 3]);

    await act(async () => root.unmount());
    roots.delete(root);
    expect(rootsById.size).toBe(0);
    expect(listeners.size).toBe(0);
  });

  it.each(["host", "conditional", "keyed", "rows"] as const)(
    "moves the %s listener when a compatible definition changes its block id",
    async (kind) => {
      let value = "Initial";
      const listeners = new Map<number, Parameters<CompilerRuntimeFeatureOwner["subscribe"]>[1]>();
      const owner: CompilerRuntimeFeatureOwner = {
        setRoot() {},
        subscribe(id, refresh) {
          listeners.set(id, refresh);
          return () => {
            if (listeners.get(id) === refresh) listeners.delete(id);
          };
        },
      };
      const descriptor = (): CompilerHostElement => ({
        kind: "element",
        tag: "span",
        attributes: [],
        styles: [],
        children: [value],
      });
      const branch = {
        create: descriptor,
        bindings: [{ kind: "text" as const, path: [], read: () => value }],
      };
      const render = () => (
        <section>
          <span>{value}</span>
        </section>
      );
      let renderBlock: (id: number) => React.ReactElement;
      if (kind === "host") {
        const Block = hostConditionalRuntimeFeature.create(owner).HostConditional!;
        renderBlock = (id) => <Block id={id} render={render} test={() => true} truthy={branch} />;
      } else if (kind === "conditional") {
        const Block = conditionalRangesRuntimeFeature.create(owner).ConditionalRanges!;
        renderBlock = (id) => (
          <Block
            id={id}
            render={render}
            ranges={[{ before: 0, test: () => true, truthy: branch }]}
            trailing={0}
          />
        );
      } else if (kind === "keyed") {
        const Block = keyedRangesRuntimeFeature.create(owner).KeyedRanges!;
        renderBlock = (id) => (
          <Block
            id={id}
            render={render}
            ranges={[
              {
                before: 0,
                items: () => [value],
                rowKey: () => "row",
                create: descriptor,
                bindings: branch.bindings,
              },
            ]}
            trailing={0}
          />
        );
      } else {
        const Block = keyedRowsRuntimeFeature.create(owner).KeyedRows!;
        renderBlock = (id) => (
          <Block
            id={id}
            render={render}
            items={() => [value]}
            rowKey={() => "row"}
            create={descriptor}
            bindings={branch.bindings}
          />
        );
      }

      const target = document.createElement("div");
      document.body.append(target);
      const root = createRoot(target);
      roots.add(root);
      await act(async () => root.render(renderBlock(0)));
      expect([...listeners.keys()]).toEqual([0]);

      value = "Refreshed";
      await act(async () => {
        root.render(renderBlock(1));
        await Promise.resolve();
      });
      expect([...listeners.keys()]).toEqual([1]);

      value = "Updated";
      await act(async () => listeners.get(1)!());
      expect(target.querySelector("span")?.textContent).toBe("Updated");

      await act(async () => root.unmount());
      roots.delete(root);
      expect(listeners.size).toBe(0);
    },
  );

  it.each(["host", "conditional", "keyed", "mixed"] as const)(
    "re-adopts %s roots without leaking subscriptions or detached references",
    async (kind) => {
      let value = 0;
      let renders = 0;
      let reads = 0;
      const listeners = new Map<number, Parameters<CompilerRuntimeFeatureOwner["subscribe"]>[1]>();
      const owner: CompilerRuntimeFeatureOwner = {
        setRoot() {},
        subscribe(id, refresh) {
          listeners.set(id, refresh);
          return () => {
            if (listeners.get(id) === refresh) listeners.delete(id);
          };
        },
      };
      const descriptor = (): CompilerHostElement => ({
        kind: "element",
        tag: "span",
        attributes: [],
        styles: [],
        children: [`Count ${value}`],
      });
      const branch = {
        create: descriptor,
        bindings: [
          {
            kind: "text" as const,
            path: [],
            read: () => {
              reads += 1;
              return `Count ${value}`;
            },
          },
        ],
      };
      const condition = { before: 0, test: () => true, truthy: branch };
      const render = () => {
        renders += 1;
        return (
          <section>
            <span>{`Count ${value}`}</span>
          </section>
        );
      };
      let element: React.ReactElement;
      if (kind === "host") {
        const Block = hostConditionalRuntimeFeature.create(owner).HostConditional!;
        element = <Block id={0} render={render} test={condition.test} truthy={branch} />;
      } else if (kind === "conditional") {
        const Block = conditionalRangesRuntimeFeature.create(owner).ConditionalRanges!;
        element = <Block id={0} render={render} ranges={[condition]} trailing={0} />;
      } else if (kind === "keyed") {
        const Block = keyedRangesRuntimeFeature.create(owner).KeyedRanges!;
        element = (
          <Block
            id={0}
            render={render}
            ranges={[
              {
                before: 0,
                items: () => [value],
                rowKey: () => "row",
                create: descriptor,
                bindings: branch.bindings,
              },
            ]}
            trailing={0}
          />
        );
      } else {
        const Block = mixedRangesRuntimeFeature.create(owner).MixedRanges!;
        element = (
          <Block
            id={0}
            render={render}
            create={() => ({
              kind: "element",
              tag: "section",
              attributes: [],
              styles: [],
              children: [descriptor()],
              block: {
                kind: "mixed-ranges",
                id: 0,
                ranges: [{ kind: "conditional", ...condition }],
                trailing: 0,
              },
            })}
          />
        );
      }
      interface Probe {
        root: Element | null;
        state: { fallback: boolean };
        componentWillUnmount(): void;
        componentDidMount(): void;
      }
      let instance: Probe;
      const target = document.createElement("div");
      document.body.append(target);
      const root = createRoot(target);
      roots.add(root);
      await act(async () =>
        root.render(
          React.cloneElement(element, {
            ref: (current: unknown) => {
              if (current) instance = current as Probe;
            },
          } as React.Attributes),
        ),
      );
      const container = target.querySelector("section");
      const span = target.querySelector("span");
      const initialRenders = renders;
      for (let replay = 0; replay < 3; replay += 1) {
        // Model React 18's lifecycle-only replay while the source suite uses React 19.
        // Packaged cases additionally run actual StrictMode on both peer versions.
        await act(async () => {
          instance.componentWillUnmount();
          expect(listeners.size).toBe(0);
          instance.componentDidMount();
        });
        expect(instance!.state.fallback).toBe(false);
        expect(listeners.size).toBe(1);
        await act(async () => {
          value += 1;
          listeners.get(0)!();
        });
        expect(target.querySelector("section") === container).toBe(true);
        expect(target.querySelector("span") === span).toBe(true);
        expect(span?.textContent).toBe(`Count ${value}`);
        expect(renders).toBe(initialRenders);
      }
      const staleRefresh = listeners.get(0)!;
      const beforeUnmountReads = reads;
      await act(async () => {
        root.unmount();
        roots.delete(root);
        value += 1;
        staleRefresh();
      });
      expect(instance!.root === null).toBe(true);
      expect(listeners.size).toBe(0);
      expect(reads).toBe(beforeUnmountReads);
      expect(container?.isConnected).toBe(false);
      expect(span?.textContent).toBe("Count 3");
    },
  );
});
