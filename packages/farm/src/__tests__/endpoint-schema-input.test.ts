// @vitest-environment node
import { expect, it } from "vitest";
import { z } from "zod";
import { createApiClients } from "../api/client";
import { createEndpoint } from "../api/endpoint";
import { invokeAPIRouteEndpoint } from "../api/runtime";
import { _runWithAPIRequestRuntime } from "../api/server-context";
import { _runWithCurrentRequest } from "../server/request";
import { multipart, toFormData } from "../api/transport";

it("validates raw input once for both HTTP and local paired callers", async () => {
  const endpoint = createEndpoint(
    {
      method: "POST",
      body: z.object({ count: z.string().transform(Number), label: z.string().default("default") }),
      query: z.object({ page: z.string().default("1").transform(Number) }),
      openapi: { security: "bearer" },
    },
    ({ body, query }) => ({ ...body, page: query.page }),
  );
  expect(endpoint.__openapi).toEqual({ security: "bearer" });
  const dispatch = (request: Request) => invokeAPIRouteEndpoint(endpoint, request);
  const { api, apiClient } = createApiClients<{ count: { post: typeof endpoint } }>({
    baseURL: "https://farm.test",
    fetch: (url, init) => dispatch(new Request(url, init)),
  });
  const input = { body: { count: "2" }, query: { page: "3" } };
  expect((await apiClient.count.post(input)).data).toEqual({ count: 2, label: "default", page: 3 });
  const request = new Request("https://farm.test/page");
  const local = await _runWithCurrentRequest(request, () =>
    _runWithAPIRequestRuntime({ basePath: "/api", dispatch }, () => api.count.post(input)),
  );
  expect(local.data).toEqual({ count: 2, label: "default", page: 3 });
});

it("retains multipart input types while passing parsed output to the handler", async () => {
  const endpoint = createEndpoint(
    { method: "POST", body: multipart(z.object({ count: z.string().transform(Number) })) },
    ({ body }) => body,
  );
  const response = await invokeAPIRouteEndpoint(
    endpoint,
    new Request("http://farm.test/api/count", { method: "POST", body: toFormData({ count: "2" }) }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ count: 2 });
});
