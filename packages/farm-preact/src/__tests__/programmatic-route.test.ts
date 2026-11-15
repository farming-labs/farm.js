// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createRoute, createRouteModuleFromProgrammaticPage } from "../../../farm/src/routes";
import * as PreactServer from "../server";

const { createElement } = PreactServer;

function ProductPage({ params, data }: { params: { id: string }; data: { name: string } }) {
  return createElement("p", null, `${params.id}: ${data.name}`);
}

describe("preact programmatic routes", () => {
  it("renders a route with server data once the server has resolved its props", async () => {
    const route = createRoute("/products/[id]", {
      data: {
        main: ({ params }: { params: { id: string } }) => ({ name: `Product ${params.id}` }),
      },
      component: ProductPage as any,
    });
    const routeModule = createRouteModuleFromProgrammaticPage(route as any, PreactServer);

    // The server resolves route props before it starts rendering the page.
    const props = await (routeModule as any).__farmResolveRouteProps({
      params: { id: "7" },
      searchParams: Promise.resolve({}),
      path: "/products/7",
    });

    expect(
      await PreactServer.renderToString(createElement(routeModule.default as any, props)),
    ).toBe("<p>7: Product 7</p>");
  });
});
