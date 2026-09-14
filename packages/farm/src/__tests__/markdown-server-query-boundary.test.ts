// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { farmPlugin } from "../vite";

const definition = [
  'import { createServerQuery } from "@farm.js/core/server-query";',
  'export const query = createServerQuery({ handler: async () => "private" });',
].join("\n");

async function transform(source: string, id: string, ssr = false, serverActions = false) {
  const plugin = farmPlugin({ experimental: { serverActions } });
  if (typeof plugin.transform !== "function") throw new Error("Missing Farm transform");
  return plugin.transform.call(
    {
      error(message: string) {
        throw new Error(message);
      },
    } as any,
    source,
    id,
    { ssr },
  );
}

describe("Markdown server-function boundary", () => {
  it.each(["md", "mdx", "md?import"])(
    "does not execute fenced examples in %s",
    async (extension) => {
      await expect(
        transform(`# Guide\n\n\`\`\`ts\n${definition}\n\`\`\`\n`, `/app/page.${extension}`),
      ).resolves.not.toThrow();
    },
  );

  it.each([
    `~~~ts\n${definition}\n~~~`,
    `\`\`\`\`md\n\`\`\`ts\n${definition}\n\`\`\`\n\`\`\`\``,
    `> \`\`\`ts\n${definition
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}\n> \`\`\``,
    `Example: \`${definition.replaceAll("\n", " ")}\``,
  ])("ignores Markdown code nodes regardless of their fence form", async (source) => {
    await expect(transform(source, "/app/page.mdx")).resolves.not.toThrow();
  });

  it("still rejects executable MDX declarations beside an example", async () => {
    const source = `\`\`\`ts\n${definition}\n\`\`\`\n\n${definition}\n\n# Guide`;
    await expect(transform(source, "/app/page.mdx")).rejects.toThrow(
      "handlers run only on the server",
    );
  });

  it("still rejects executable MDX expressions", async () => {
    const source =
      'import { createServerQuery } from "@farm.js/core/server-query";\n\n{createServerQuery({ handler: async () => 1 })}';
    await expect(transform(source, "/app/page.mdx")).rejects.toThrow(
      "handlers run only on the server",
    );
  });

  it("ignores action examples with frontmatter and Windows line endings", async () => {
    const source = `---\ntitle: Server functions\n---\n\n\`\`\`ts\n${definition.replaceAll("createServerQuery", "createServerFn")}\n\`\`\`\n`;
    await expect(
      transform(source.replaceAll("\n", "\r\n"), "C:\\app\\page.mdx?import"),
    ).resolves.not.toThrow();
  });

  it("does not suppress a violation when Markdown parsing fails", async () => {
    await expect(transform(`${definition}\n\n<Unclosed`, "/app/page.mdx")).rejects.toThrow(
      "handlers run only on the server",
    );
  });

  it.each(["cache-ppr", "plugins/content", "renderers", "routing", "server-queries"])(
    "compiles the previously blocked %s docs source without a false boundary error",
    async (slug) => {
      const source = await readFile(
        new URL(`../../../../docs/src/app/docs/${slug}/page.md`, import.meta.url),
        "utf8",
      );
      await expect(transform(source, `/app/docs/${slug}/page.md`)).resolves.not.toThrow();
    },
  );

  it("preserves ordinary client boundaries and the existing SSR and transform opt-ins", async () => {
    await expect(transform(definition, "/app/query.ts")).rejects.toThrow(
      "handlers run only on the server",
    );
    await expect(transform(definition, "/app/page.mdx", true)).resolves.not.toThrow();
    await expect(transform(definition, "/app/page.mdx", false, true)).resolves.not.toThrow();
  });
});
