import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveHintsOptions } from "./config.js";
import { collectDocumentHints } from "./scan.js";

const axeMock = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("axe-core", () => ({ default: { run: axeMock.run } }));

describe("accessibility hints across same-origin iframes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.lang = "en";
    document.body.innerHTML = '<iframe id="frame" srcdoc="<button></button>"></iframe>';
  });

  function node(
    target: string[],
    failureSummary = "Fix any of the following:\n  Element is missing text.",
  ) {
    return { target, html: "<button></button>", failureSummary };
  }

  function buttonNameViolation(nodes: ReturnType<typeof node>[]) {
    return {
      id: "button-name",
      impact: "critical",
      help: "Buttons must have discernible text",
      description: "Ensure that buttons have a discernible text.",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.13/button-name",
      tags: ["wcag2a", "wcag412a"],
      nodes,
    };
  }

  async function scan() {
    const issues = await collectDocumentHints(
      document,
      window,
      resolveHintsOptions({ performance: false, html: false, thirdParty: false }),
    );
    return issues.filter((issue) => issue.category === "accessibility");
  }

  it("keeps every node of one rule inside one iframe as a distinct issue (no data loss)", async () => {
    axeMock.run.mockResolvedValue({
      violations: [
        buttonNameViolation([
          node(["#frame", "button:nth-of-type(1)"]),
          node(["#frame", "button:nth-of-type(2)"]),
          node(["#frame", "button:nth-of-type(3)"]),
        ]),
      ],
    });

    const issues = await scan();
    expect(issues).toHaveLength(3);
    // client.ts stores issues in a Map keyed by id (last-write-wins), so distinct
    // ids are what prevent iframe findings from collapsing into one another.
    expect(new Set(issues.map((issue) => issue.id)).size).toBe(3);
    expect(new Map(issues.map((issue) => [issue.id, issue])).size).toBe(3);
  });

  it("does not change the id format for top-frame findings", async () => {
    axeMock.run.mockResolvedValue({
      violations: [buttonNameViolation([node(["button"])])],
    });

    const issues = await scan();
    expect(issues.map((issue) => issue.id)).toEqual(["accessibility:button-name:button"]);
  });
});
