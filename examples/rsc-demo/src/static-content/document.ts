import type {
  StrataDocument,
  StrataElement,
  StrataNode,
  StrataTag,
} from "@farm.js/plugin/rsc/optimized-boundary";

const concepts = [
  "streaming",
  "serialization",
  "caching",
  "composition",
  "reconciliation",
  "invalidation",
] as const;

function text(value: string): StrataNode {
  return { type: "text", value };
}

function element(
  tag: StrataTag,
  children: StrataNode[] = [],
  attributes?: Record<string, string>,
): StrataElement {
  return {
    type: "element",
    tag,
    ...(attributes ? { attributes } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

function section(index: number): StrataElement {
  const concept = concepts[index % concepts.length];
  const number = index + 1;

  return element(
    "section",
    [
      element("h2", [text(`${number}. ${concept} without React-owned interior nodes`)]),
      element("p", [
        text(`This host-only section keeps ${concept} content inside one opaque boundary. `),
        element("strong", [text("React still owns the surrounding application")]),
        text(", including the interactive counter beside this document."),
      ]),
      element("p", [
        text("The server sends sanitized HTML through Flight instead of serializing every "),
        element("code", [text(`<section_${number}>`)]),
        text(" host element as an independently reconcilable React record."),
      ]),
      element(
        "pre",
        [
          element("code", [
            text(
              [
                `export const section_${number} = {`,
                `  representation: "static-fragment",`,
                `  concept: "${concept}",`,
                `  reactOwnedInterior: false`,
                `}`,
              ].join("\n"),
            ),
          ]),
        ],
        { "data-language": "typescript" },
      ),
      element("ul", [
        element("li", [text(`Measure ${concept} server work.`)]),
        element("li", [text("Compare Flight payload bytes.")]),
        element("li", [text("Preserve client state outside the boundary.")]),
      ]),
    ],
    {
      class: "space-y-3 border-b border-slate-700/70 pb-8",
      "data-section": String(number),
    },
  );
}

export function createStaticContentDocument(sectionCount = 36): StrataDocument {
  return {
    type: "document",
    children: [
      element("header", [
        element("h1", [text("Representation-aware static content")]),
        element("p", [
          text(
            "The same typed document can be rendered as a normal React host tree or through one optimized boundary.",
          ),
        ]),
        element("p", [
          text("Escaping check: <script>globalThis.__strataInjected = true</script> & \"quotes\"."),
        ]),
        element(
          "a",
          [text("Read the Strata source")],
          {
            href: "https://github.com/farming-labs/strata",
            rel: "noopener noreferrer",
            target: "_blank",
          },
        ),
      ]),
      ...Array.from({ length: sectionCount }, (_, index) => section(index)),
      element("footer", [
        element("p", [
          text(
            "Client Components, event handlers, effects, refs, Suspense slots, and independently updating state must remain outside this boundary.",
          ),
        ]),
      ]),
    ],
  };
}
