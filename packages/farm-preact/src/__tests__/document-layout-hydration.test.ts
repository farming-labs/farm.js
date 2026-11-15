// @vitest-environment jsdom

import { useState } from "preact/hooks";
import { describe, expect, it } from "vitest";
import { FARM_LAYOUT_ELEMENT_CLIENT_SOURCE } from "../../../farm/src/document-layout-client";
import { extractFarmFullDocument } from "../../../farm/src/server/full-document";
import PreactClient, { hydrateRoot } from "../client";
import PreactServer, { renderToString } from "../server";

// Evaluate the shared client source the way the generated entries do, with the
// renderer's compat runtime in scope as `React`.
function loadCreateLayoutElement() {
  return new Function(
    "React",
    `${FARM_LAYOUT_ELEMENT_CLIENT_SOURCE}\nreturn createFarmLayoutElement;`,
  )(PreactClient);
}

// A Next.js-style root layout: a whole document, with state of its own.
function DocumentLayout({ children }: { children?: unknown }) {
  const [count, setCount] = useState(0);
  return PreactClient.createElement(
    "html",
    { lang: "en" },
    PreactClient.createElement("head", null),
    PreactClient.createElement(
      "body",
      null,
      PreactClient.createElement(
        "header",
        null,
        PreactClient.createElement(
          "button",
          { id: "layout", onClick: () => setCount(count + 1) },
          `layout ${count}`,
        ),
      ),
      children,
    ),
  );
}

const pageBoundaryProps = {
  id: "__farm_page__",
  "data-farm-segment": "page",
  "data-farm-client": "false",
  "data-farm-layout-client": "true",
  "data-farm-island": "page",
  "data-farm-island-strategy": "load",
};

describe("preact document layout hydration", () => {
  it("hydrates a root layout that returns its own <html> document", async () => {
    // The tree the server renderer builds for a page under a hydrated layout.
    const markup = await renderToString(
      PreactServer.createElement(
        "div",
        {
          "data-farm-layout-boundary": "true",
          "data-farm-layout-pattern": "/",
          style: { display: "contents" },
        },
        PreactServer.createElement(
          DocumentLayout,
          { params: {} },
          PreactServer.createElement("div", pageBoundaryProps, "page"),
        ),
      ),
    );
    const document_ = extractFarmFullDocument(markup);
    expect(document_).not.toBeNull();

    // The server sends the document's body content as #root.
    const container = document.createElement("div");
    container.innerHTML = new DOMParser().parseFromString(document_!, "text/html").body.innerHTML;
    document.body.append(container);
    const serverHeader = container.querySelector("header");
    expect(serverHeader).toBeTruthy();

    const createFarmLayoutElement = loadCreateLayoutElement();
    hydrateRoot(
      container,
      createFarmLayoutElement(
        DocumentLayout,
        "/",
        PreactClient.createElement("div", pageBoundaryProps, "page"),
        {},
      ),
    );

    expect(container.querySelector("header")).toBe(serverHeader);
    (container.querySelector("#layout") as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector("#layout")?.textContent).toBe("layout 1");

    container.remove();
  });
});
