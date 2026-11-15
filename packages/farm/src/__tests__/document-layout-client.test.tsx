// @vitest-environment jsdom

import React, { useState } from "react";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
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
