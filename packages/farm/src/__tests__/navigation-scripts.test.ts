// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { FARM_NAVIGATION_SCRIPT_SOURCE } from "../client/navigation-scripts";

type NavigationScripts = {
  createFarmNavigationScript(script: Element): HTMLScriptElement;
  revealFarmStreamedContent(root: ParentNode): void;
};

/** Evaluates the source as the client entry does: once, with the document as it is now. */
function load(): NavigationScripts {
  return new Function(
    `${FARM_NAVIGATION_SCRIPT_SOURCE}\nreturn { createFarmNavigationScript, revealFarmStreamedContent };`,
  )();
}

function boot(nonce: string) {
  const script = document.createElement("script");
  script.setAttribute("data-farm-runtime", "/farm-client.js");
  script.nonce = nonce;
  document.head.append(script);
}

function navigationScripts(html: string): Element[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  return Array.from(template.content.querySelectorAll("script"));
}

afterEach(() => {
  document.head.innerHTML = "";
});

describe("navigation scripts", () => {
  it("run a script the navigation response nonced with the page's nonce", () => {
    boot("page-nonce");
    const { createFarmNavigationScript } = load();
    const [reveal] = navigationScripts(
      '<script nonce="response-nonce" data-kind="reveal">$RC("B:0","S:0")</script>',
    );
    const script = createFarmNavigationScript(reveal!);
    expect(script.nonce).toBe("page-nonce");
    expect(script.getAttribute("nonce")).not.toBe("response-nonce");
    expect(script.getAttribute("data-kind")).toBe("reveal");
    expect(script.textContent).toBe('$RC("B:0","S:0")');
  });

  it("keep a script the response left without a nonce without one", () => {
    boot("page-nonce");
    const { createFarmNavigationScript } = load();
    const [injected] = navigationScripts("<script>alert(1)</script>");
    const script = createFarmNavigationScript(injected!);
    expect(script.nonce).toBe("");
    expect(script.getAttribute("nonce")).toBeNull();
  });

  it("keep the nonce the page loaded with after a navigation adds scripts with another", () => {
    boot("page-nonce");
    const { createFarmNavigationScript } = load();
    const later = document.createElement("script");
    later.nonce = "response-nonce";
    document.head.prepend(later);
    const [reveal] = navigationScripts('<script nonce="next-nonce">x()</script>');
    expect(createFarmNavigationScript(reveal!).nonce).toBe("page-nonce");
  });

  it("copy scripts as they are without a nonce policy", () => {
    const { createFarmNavigationScript } = load();
    const [module] = navigationScripts('<script type="module" src="/island.js"></script>');
    const script = createFarmNavigationScript(module!);
    expect(script.type).toBe("module");
    expect(script.getAttribute("src")).toBe("/island.js");
    expect(script.nonce).toBe("");
  });
});

describe("streamed content in a parsed page", () => {
  it("moves each revealed segment into place and drops the calls it made", () => {
    const { revealFarmStreamedContent } = load();
    const root = document.createElement("div");
    // A boundary whose content holds a placeholder that a later segment fills, as React streams it.
    root.innerHTML =
      '<section><!--$?--><template id="B:0"></template><p>Loading</p><!--/$--></section>' +
      '<div hidden id="S:0"><f-island><template id="P:1"></template></f-island></div>' +
      '<div hidden id="S:1"><p data-note>note</p></div>' +
      '<script>$RS=function(a,b){};$RS("S:1","P:1")</script>' +
      '<script>$RC=function(a,b){};$RC("B:0","S:0")</script>' +
      '<script>$RX("B:9","","")</script>';
    revealFarmStreamedContent(root);
    expect(root.querySelector("section")!.innerHTML).toBe(
      '<!--$--><f-island><p data-note="">note</p></f-island><!--/$-->',
    );
    expect(root.querySelector('[id^="S:"], [id^="P:"], [id^="B:"]')).toBeNull();
    const scripts = Array.from(root.querySelectorAll("script"), (script) => script.textContent);
    expect(scripts).toEqual(["$RS=function(a,b){};", "$RC=function(a,b){};", '$RX("B:9","","")']);
  });

  it("leaves a call whose segment has not arrived", () => {
    const { revealFarmStreamedContent } = load();
    const root = document.createElement("div");
    root.innerHTML =
      '<!--$?--><template id="B:0"></template><p>Loading</p><!--/$--><script>$RC("B:0","S:0")</script>';
    revealFarmStreamedContent(root);
    expect(root.querySelector("p")!.textContent).toBe("Loading");
    expect(root.querySelector("script")!.textContent).toBe('$RC("B:0","S:0")');
  });
});
