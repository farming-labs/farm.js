// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  createMarkdownMirrorResponse,
  extractFarmPageActions,
  resolveMarkdownConfig,
} from "../markdown";
import { createFarmMarkdownViewResponse } from "../markdown-view";

const page = new URL("https://acme.test/contact?ref=nav");
const extract = (body: string, url = page) =>
  extractFarmPageActions(`<html><body><main>${body}</main></body></html>`, url);

describe("extractFarmPageActions", () => {
  it("describes a form's target, fields, labels, constraints, and submit button", () => {
    expect(
      extract(
        [
          '<form aria-label="Contact sales" method="post" action="/api/contact">',
          '<label for="email">Work email</label>',
          '<input id="email" name="email" type="email" required placeholder="you@company.com">',
          '<label>Message <textarea name="message" required minlength="10" maxlength="500">Hi &amp; hello</textarea></label>',
          '<select name="plan" aria-label="Plan"><option value="">Choose</option><option value="pro" selected>Pro</option><option disabled>Legacy</option></select>',
          '<input type="hidden" name="source" value="pricing &amp; plans">',
          '<input type="text" name="nickname" disabled>',
          '<button type="button">Preview</button>',
          '<button type="submit" name="intent" value="send">Send message</button>',
          "</form>",
        ].join(""),
      ),
    ).toEqual([
      {
        type: "form",
        name: "Contact sales",
        method: "POST",
        action: "/api/contact",
        enctype: "application/x-www-form-urlencoded",
        fields: [
          {
            name: "email",
            type: "email",
            label: "Work email",
            required: true,
            placeholder: "you@company.com",
          },
          {
            name: "message",
            type: "textarea",
            label: "Message",
            required: true,
            value: "Hi & hello",
            minLength: 10,
            maxLength: 500,
          },
          {
            name: "plan",
            type: "select",
            label: "Plan",
            options: [
              { value: "", label: "Choose" },
              { value: "pro", label: "Pro", selected: true },
            ],
          },
          { name: "source", type: "hidden", value: "pricing & plans" },
        ],
        submit: [{ label: "Send message", name: "intent", value: "send" }],
      },
    ]);
  });

  it("groups radio buttons and checkboxes that share a name", () => {
    const [form] = extract(
      [
        '<form method="get">',
        '<label><input type="radio" name="size" value="s" required> Small</label>',
        '<label><input type="radio" name="size" value="l" checked> Large</label>',
        '<input type="checkbox" name="terms" id="terms"><label for="terms">I agree</label>',
        "</form>",
      ].join(""),
    );
    expect(form!.fields).toEqual([
      {
        name: "size",
        type: "radio",
        required: true,
        options: [
          { value: "s", label: "Small" },
          { value: "l", label: "Large", selected: true },
        ],
      },
      { name: "terms", type: "checkbox", options: [{ value: "on", label: "I agree" }] },
    ]);
    // A GET form submits a query string, so it has no enctype, and with no
    // button it is submitted by pressing Enter.
    expect(form!.method).toBe("GET");
    expect(form!.enctype).toBeUndefined();
    expect(form!.submit).toEqual([{ label: "Submit" }]);
  });

  it("resolves targets as a browser does and marks script-only forms", () => {
    const targets = extract(
      [
        '<form><input name="q"></form>',
        '<form action="search?x=1#top"><input name="q"></form>',
        '<form action="https://payments.example.com/pay" method="post"><input name="amount"></form>',
        `<form action="javascript:throw new Error('React form unexpectedly submitted.')"><input name="q"></form>`,
      ].join(""),
    );
    expect(targets.map((form) => form.action)).toEqual([
      "/contact?ref=nav",
      "/search?x=1",
      "https://payments.example.com/pay",
      undefined,
    ]);
    expect(targets[3]!.requiresJavaScript).toBe(true);
  });

  it("reads per-button targets and React server action ids", () => {
    const [form] = extract(
      [
        '<form action="" encType="multipart/form-data" method="POST">',
        '<input type="hidden" name="$ACTION_ID_a1b2c3d4e5f6#createTodo"/>',
        '<input name="title" required/>',
        '<button formaction="/drafts" formmethod="get">Save draft</button>',
        '<input type="submit" value="Create">',
        "</form>",
      ].join(""),
    );
    expect(form!.serverAction).toEqual({ id: "a1b2c3d4e5f6#createTodo" });
    expect(form!.enctype).toBe("multipart/form-data");
    expect(form!.submit).toEqual([
      { label: "Save draft", action: "/drafts", method: "GET" },
      { label: "Create" },
    ]);
    // The hidden action field stays, so the form can be submitted without JavaScript.
    expect(form!.fields[0]).toEqual({
      name: "$ACTION_ID_a1b2c3d4e5f6#createTodo",
      type: "hidden",
      value: "",
    });

    const [bound] = extract(
      '<form method="POST"><input type="hidden" name="$ACTION_REF_R1"/><input type="hidden" name="$ACTION_R1:0" value="{&quot;id&quot;:&quot;abc#update&quot;,&quot;bound&quot;:&quot;$@1&quot;}"/><button>Save</button></form>',
    );
    expect(bound!.serverAction).toEqual({ id: "abc#update" });
  });

  it("reads only what the mirror reads and skips forms that submit nothing", () => {
    expect(
      extractFarmPageActions(
        [
          '<html><body><nav><form action="/search"><input name="q"></form></nav>',
          "<main>",
          '<form aria-hidden="true"><input name="decoy"></form>',
          '<form method="dialog"><button>Close</button></form>',
          '<form><button type="button">Toggle</button></form>',
          "<script>document.write('<form><input name=\"x\"></form>')</script>",
          "</main></body></html>",
        ].join(""),
        page,
      ),
    ).toEqual([]);
    expect(extract("<p>No forms</p>")).toEqual([]);
    // Passwords and files never echo a value.
    expect(
      extract(
        '<form method="post"><input type="password" name="pw" value="x"><input type="file" name="f" value="y" accept="image/*"></form>',
      )[0]!.fields,
    ).toEqual([
      { name: "pw", type: "password" },
      { name: "f", type: "file", accept: "image/*" },
    ]);
  });
});

describe("Markdown mirror actions", () => {
  const html =
    '<html><body><main><h1>Contact</h1><form method="post"><input name="email" type="email" required><button>Send</button></form></main></body></html>';
  const mirror = (url: string, body = html, init: RequestInit = {}) => {
    const rendered: string[] = [];
    return createMarkdownMirrorResponse({
      request: new Request(url, init),
      config: resolveMarkdownConfig({ expose: ["/contact", "/about"] }),
      renderPage: async (request) => {
        rendered.push(request.url);
        return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      },
    }).then((response) => ({ response: response!, rendered }));
  };

  it("lists the actions view in the mirror of a page with forms", async () => {
    const { response } = await mirror("https://acme.test/contact.md");
    const markdown = await response.text();
    expect(markdown).toContain("Source: /contact\n\nActions: /contact.md?actions\n");
    expect(markdown).toContain("# Contact");

    const plain = await (
      await mirror(
        "https://acme.test/about.md",
        "<html><body><main><p>About</p></main></body></html>",
      )
    ).response.text();
    expect(plain).not.toContain("Actions:");
  });

  it("answers ?actions with the forms as JSON, with an ETag", async () => {
    const { response, rendered } = await mirror("https://acme.test/contact.md?actions&ref=nav");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    // The view parameter is the agent's; the page renders, and forms resolve, without it.
    expect(rendered).toEqual(["https://acme.test/contact?ref=nav"]);
    const body = await response.json();
    expect(body).toEqual({
      page: "/contact",
      markdown: "/contact.md",
      actions: [
        {
          type: "form",
          method: "POST",
          action: "/contact?ref=nav",
          enctype: "application/x-www-form-urlencoded",
          fields: [{ name: "email", type: "email", required: true }],
          submit: [{ label: "Send" }],
        },
      ],
    });

    const etag = response.headers.get("etag")!;
    const cached = await mirror("https://acme.test/contact.md?actions&ref=nav", html, {
      headers: { "if-none-match": etag },
    });
    expect(cached.response.status).toBe(304);
  });

  it.each(["GET", "HEAD"])(
    "skips Markdown-only conversion for successful %s actions views",
    async (method) => {
      // Observe the converter's code-block pass without replacing its behavior.
      // The ordinary mirror is a positive control for this work counter.
      const replace = vi.spyOn(String.prototype, "replace");
      const conversions = () =>
        replace.mock.calls.filter(
          ([pattern]) => pattern instanceof RegExp && pattern.source.startsWith("<pre\\b"),
        ).length;
      try {
        await mirror("https://acme.test/contact.md", html, { method });
        expect(conversions()).toBeGreaterThan(0);
        replace.mockClear();
        const { response } = await mirror(
          "https://acme.test/contact.md?actions&outline&section=missing&max_tokens=invalid",
          html,
          { method },
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
        const body = await response.text();
        expect(method === "HEAD" ? body : JSON.parse(body).actions[0].fields[0].name).toBe(
          method === "HEAD" ? "" : "email",
        );
        expect(conversions()).toBe(0);
      } finally {
        replace.mockRestore();
      }
    },
  );

  it.each([200, 201])(
    "keeps streamed forms, identity, and metadata on a %s actions response",
    async (status) => {
      const body =
        '<html><head><meta name="robots" content="noindex"><link rel="canonical" href="/contact"></head>' +
        '<body><main><!--$?--><template id="B:0"></template><p>Loading</p><!--/$--></main>' +
        '<div hidden id="S:0"><form method="post"><input name="email" required><button>Send</button></form>' +
        '<form hidden><input name="secret"></form></div>' +
        '<script>$RC("B:0","S:0")</script></body></html>';
      for (const suffix of [".md", ""]) {
        const response = await createMarkdownMirrorResponse({
          request: new Request(`https://acme.test/contact${suffix}?actions&ref=one&ref=two`, {
            headers: { accept: "text/markdown", cookie: "session=reader" },
          }),
          config: resolveMarkdownConfig({ cache: 300 }),
          renderPage: (request) => {
            expect(request.url).toBe("https://acme.test/contact?ref=one&ref=two");
            expect(request.headers.get("cookie")).toBe("session=reader");
            return new Response(body, {
              status,
              headers: {
                "content-type": "text/html",
                "set-cookie": "session=renewed; HttpOnly",
                vary: "Cookie",
                "x-robots-tag": "nofollow",
              },
            });
          },
        });
        expect(response!.status).toBe(status);
        expect(response!.headers.get("content-location")).toBe("/contact.md");
        expect(response!.headers.get("cache-control")).toBe("private, no-store");
        expect(response!.headers.get("set-cookie")).toBe("session=renewed; HttpOnly");
        expect(response!.headers.get("vary")).toBe(suffix ? "Cookie" : "Accept, Cookie");
        expect(response!.headers.get("x-robots-tag")).toBe("nofollow, noindex");
        expect(response!.headers.get("link")).toBe('<https://acme.test/contact>; rel="canonical"');
        expect(await response!.json()).toEqual({
          page: "/contact",
          markdown: "/contact.md",
          actions: [
            {
              type: "form",
              method: "POST",
              action: "/contact?ref=one&ref=two",
              enctype: "application/x-www-form-urlencoded",
              fields: [{ name: "email", type: "text", required: true }],
              submit: [{ label: "Send" }],
            },
          ],
        });
      }
    },
  );

  it("answers ?actions for a Markdown source with no actions", async () => {
    const response = createFarmMarkdownViewResponse({
      request: new Request("https://acme.test/guide.md?actions"),
      markdown: "# Guide\n",
      status: 200,
      headers: new Headers({ "Content-Type": "text/markdown; charset=utf-8" }),
      markdownPath: "/guide.md",
    });
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await response.json()).toEqual({ page: "/guide", markdown: "/guide.md", actions: [] });
  });
});
