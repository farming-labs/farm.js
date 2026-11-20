// @vitest-environment jsdom

import React, { useState } from "react";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToReadableStream, renderToString } from "react-dom/server";
import { installFarmIslandsServer } from "../client/islands-server";
import { createIsland } from "../islx/react";
import {
  createFarmServerTreeLayout,
  renderFarmServerTreeLayout,
  wrapFarmIsolatedClientGraph,
} from "../client/islands-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FARM_LAYOUT_ELEMENT_CLIENT_SOURCE } from "../document-layout-client";
import { composeFarmFullDocument, extractFarmFullDocument } from "../server/full-document";

type CreateLayoutElement = (
  Component: unknown,
  pattern: string,
  children: React.ReactNode,
  params: Record<string, string>,
) => React.ReactElement;

// Evaluate the shared client source the way the generated entries do, with React in scope.
function loadCreateLayoutElement(): CreateLayoutElement {
  return new Function(
    "React",
    `${FARM_LAYOUT_ELEMENT_CLIENT_SOURCE}\nreturn createFarmLayoutElement;`,
  )(React);
}

function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <nav>
      <button id="nav" onClick={() => setOpen((value) => !value)}>
        menu: {open ? "open" : "closed"}
      </button>
    </nav>
  );
}

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button id="counter" onClick={() => setCount((value) => value + 1)}>
      count: {count}
    </button>
  );
}

function Page() {
  return (
    <div id="__farm_page__">
      <Counter />
    </div>
  );
}

// A Next.js-style root layout: a whole document, with a client component of its own.
function DocumentLayout({ children }: { children?: React.ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}

function FragmentLayout({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <Nav />
      {children}
    </>
  );
}

afterEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
  vi.restoreAllMocks();
});

describe("client layout elements", () => {
  it("hydrates a full-document root layout from the markup the server composes", async () => {
    // What the server sends: the layout's document inside Farm's layout boundary,
    // composed so the body's content sits in #root.
    const serverTree = (
      <div
        data-farm-layout-boundary="true"
        data-farm-layout-pattern="/"
        style={{ display: "contents" }}
      >
        <DocumentLayout>
          <Page />
        </DocumentLayout>
      </div>
    );
    const composed = composeFarmFullDocument(extractFarmFullDocument(renderToString(serverTree))!, {
      headAssets: "",
      bodyFooter: "",
    });
    const parsed = new DOMParser().parseFromString(composed, "text/html");
    document.body.innerHTML = parsed.body.innerHTML;
    const container = document.getElementById("root")!;
    expect([...container.children].map((element) => element.tagName)).toEqual(["NAV", "DIV"]);

    const recoverable = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const createLayoutElement = loadCreateLayoutElement();
    await act(async () => {
      hydrateRoot(container, createLayoutElement(DocumentLayout, "/", <Page />, {}), {
        onRecoverableError: recoverable,
      });
    });

    expect(recoverable).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    await act(async () => {
      document.getElementById("nav")!.click();
      document.getElementById("counter")!.click();
    });
    expect(document.getElementById("nav")!.textContent).toBe("menu: open");
    expect(document.getElementById("counter")!.textContent).toBe("count: 1");
  });

  it.each([true, false])(
    "keeps a nested server-tree layout's useId when the document has a head: %s",
    async (withHead) => {
      installFarmIslandsServer();
      const clientIds: string[] = [];
      function Menu() {
        const id = React.useId();
        return (
          <button aria-controls={id} onClick={() => clientIds.push(id)}>
            Menu
          </button>
        );
      }
      const Header = createIsland(Menu, "/menu.tsx", "Menu", "load");
      function Section({ children }: { children?: React.ReactNode }) {
        return (
          <section>
            <Header />
            {children}
          </section>
        );
      }
      function Document({ children }: { children?: React.ReactNode }) {
        const body = (
          <body>
            <a href="#page">Skip</a>
            {children}
          </body>
        );
        return withHead ? (
          <html>
            <head />
            {body}
          </html>
        ) : (
          <html>{body}</html>
        );
      }
      const page = <main id="page" />;
      const section = await renderFarmServerTreeLayout(Section, {}, { children: page }, "/(home)");
      const outer = await renderFarmServerTreeLayout(
        Document,
        {},
        { children: <div>{section}</div> },
        "/",
      );
      const wrap = (content: React.ReactNode) => wrapFarmIsolatedClientGraph(React, content);
      const stream = await renderToReadableStream(wrap(outer));
      await stream.allReady;
      const html = await new Response(stream).text();
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const container = document.createElement("div");
      container.innerHTML = parsed.body.innerHTML;
      document.body.append(container);
      const button = container.querySelector("button")!;
      const serverId = button.getAttribute("aria-controls");
      expect(serverId).toBeTruthy();

      const options = { load: async () => ({ Menu }), ServerHtml: () => null };
      const nested = (await createFarmServerTreeLayout(React, container, "/(home)", options))!;
      const rootLayout = (await createFarmServerTreeLayout(React, container, "/", options))!;
      const createLayout = loadCreateLayoutElement();
      const tree = createLayout(
        () =>
          rootLayout.render({
            children: <div>{nested.render({ children: page })}</div>,
          }),
        "/",
        null,
        {},
      );
      const root = await act(async () => hydrateRoot(container, wrap(tree)));
      try {
        await act(async () => button.click());
        expect(clientIds).toEqual([serverId]);
      } finally {
        await act(async () => root.unmount());
        rootLayout.dispose();
        nested.dispose();
      }
    },
  );

  it("keeps the layout boundary for a layout that returns its children", () => {
    const createLayoutElement = loadCreateLayoutElement();
    const markup = renderToString(createLayoutElement(FragmentLayout, "/", <Page />, {}));
    const serverMarkup = renderToString(
      <div
        data-farm-layout-boundary="true"
        data-farm-layout-pattern="/"
        style={{ display: "contents" }}
      >
        <FragmentLayout>
          <Page />
        </FragmentLayout>
      </div>,
    );

    expect(markup).toBe(serverMarkup);
  });

  it("renders a document layout's body content when it has no <body>", () => {
    function BodylessLayout({ children }: { children?: React.ReactNode }) {
      return (
        <html>
          <head />
          {children}
        </html>
      );
    }
    const createLayoutElement = loadCreateLayoutElement();

    expect(renderToString(createLayoutElement(BodylessLayout, "/", <Page />, {}))).toBe(
      renderToString(<Page />),
    );
  });
});
