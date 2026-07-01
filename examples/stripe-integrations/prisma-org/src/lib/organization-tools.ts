import { defineIntegration, integrationRoute } from "@farmjs/core";
import { api as clientApi } from "@farmjs/core/client";
import {
  getAuthSession,
  insertDemoProject,
  insertDemoTokenUsage,
  setOrganizationSeatAllowanceOverride,
} from "./organization-server.ts";

export interface DemoProjectInput {
  name?: string;
}

export interface DemoProjectResult {
  organizationId: string;
  projectId: string;
  name: string;
}

export interface DemoTokenUsageInput {
  tokens: number;
}

export interface DemoTokenUsageResult {
  organizationId: string;
  usageId: string;
  tokens: number;
}

export interface DemoSeatOverrideInput {
  seatAllowanceOverride: number | null;
}

export interface DemoSeatOverrideResult {
  organizationId: string;
  seatAllowanceOverride: number | null;
}

export const organizationToolsIntegration = defineIntegration({
  category: "example",
  type: "organization-tools",
  instance: {},
  api: {
    createProject: clientApi.post<DemoProjectInput, DemoProjectResult>(
      "/organization/demo/project",
      {
        responseFormat: "json",
      },
    ),
    recordTokenUsage: clientApi.post<DemoTokenUsageInput, DemoTokenUsageResult>(
      "/organization/demo/tokens",
      {
        responseFormat: "json",
      },
    ),
    setSeatOverride: clientApi.post<DemoSeatOverrideInput, DemoSeatOverrideResult>(
      "/organization/demo/billing/seats/override",
      {
        responseFormat: "json",
      },
    ),
  },
  routes: [
    integrationRoute.post<
      "/organization/demo/project",
      DemoProjectInput,
      DemoProjectResult
    >("/organization/demo/project", {
      responseFormat: "json",
      async handler(request) {
        const session = await getAuthSession(request.headers);
        const organizationId = session?.session.activeOrganizationId;

        if (!session?.user.id || !organizationId) {
          return Response.json(
            {
              error: "Create or activate an organization before creating demo projects.",
            },
            {
              status: 401,
            },
          );
        }

        const body = await request.json().catch(() => null);
        const name =
          body && typeof body === "object" && typeof body.name === "string"
            ? body.name.trim()
            : "";

        if (!name) {
          return Response.json(
            {
              error: "Demo project creation requires a name.",
            },
            {
              status: 400,
            },
          );
        }

        const project = await insertDemoProject(organizationId, name);

        return Response.json({
          organizationId,
          projectId: project.id,
          name: project.name,
        } satisfies DemoProjectResult);
      },
    }),
    integrationRoute.post<
      "/organization/demo/tokens",
      DemoTokenUsageInput,
      DemoTokenUsageResult
    >("/organization/demo/tokens", {
      responseFormat: "json",
      async handler(request) {
        const session = await getAuthSession(request.headers);
        const organizationId = session?.session.activeOrganizationId;

        if (!session?.user.id || !organizationId) {
          return Response.json(
            {
              error: "Create or activate an organization before recording token usage.",
            },
            {
              status: 401,
            },
          );
        }

        const body = await request.json().catch(() => null);
        const tokens =
          body && typeof body === "object" && typeof body.tokens === "number"
            ? body.tokens
            : Number.NaN;

        if (!Number.isFinite(tokens) || tokens <= 0) {
          return Response.json(
            {
              error: "Demo token usage requires a positive token amount.",
            },
            {
              status: 400,
            },
          );
        }

        const usage = await insertDemoTokenUsage(organizationId, Math.round(tokens));

        return Response.json({
          organizationId,
          usageId: usage.id,
          tokens: usage.tokens,
        } satisfies DemoTokenUsageResult);
      },
    }),
    integrationRoute.post<
      "/organization/demo/billing/seats/override",
      DemoSeatOverrideInput,
      DemoSeatOverrideResult
    >("/organization/demo/billing/seats/override", {
      responseFormat: "json",
      async handler(request) {
        const session = await getAuthSession(request.headers);
        const organizationId = session?.session.activeOrganizationId;

        if (!session?.user.id || !organizationId) {
          return Response.json(
            {
              error: "Create or activate an organization before editing seat overrides.",
            },
            {
              status: 401,
            },
          );
        }

        const body = await request.json().catch(() => null);
        const rawValue =
          body && typeof body === "object" && "seatAllowanceOverride" in body
            ? body.seatAllowanceOverride
            : null;

        const seatAllowanceOverride =
          rawValue === null
            ? null
            : typeof rawValue === "number" && Number.isInteger(rawValue) && rawValue >= 0
              ? rawValue
              : Number.NaN;

        if (Number.isNaN(seatAllowanceOverride)) {
          return Response.json(
            {
              error:
                "Seat override must be null or a whole number greater than or equal to zero.",
            },
            {
              status: 400,
            },
          );
        }

        const nextOverride = await setOrganizationSeatAllowanceOverride(
          organizationId,
          seatAllowanceOverride,
        );

        return Response.json({
          organizationId,
          seatAllowanceOverride: nextOverride,
        } satisfies DemoSeatOverrideResult);
      },
    }),
  ],
});
