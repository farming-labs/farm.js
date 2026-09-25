// @vitest-environment node

import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createIntegrationClient } from "../client";
import type { FarmIntegrationHandlerContext } from "../integrations";
import {
  emailSchedule,
  resend,
  type ResendEmailScheduleInput,
  type ResendEmailSendInput,
} from "../../../farm-integrations/src/email/index";

function createRequestContextStore() {
  return {
    get() {
      return undefined;
    },
    set() {},
    has() {
      return false;
    },
    delete() {
      return false;
    },
    clear() {},
    snapshot() {
      return new Map<string, unknown>();
    },
  };
}

function createContext(
  request: Request,
  method: string,
  path: string,
  instance: unknown,
): FarmIntegrationHandlerContext {
  const req = createRequestContextStore();

  return {
    request,
    requestId: "req_test",
    url: new URL(request.url),
    pathname: new URL(request.url).pathname,
    method,
    params: {},
    input: {},
    data: {},
    integration: {
      category: "email",
      slot: "email",
      type: "resend",
      instance,
    },
    route: {
      kind: "route",
      path,
      methods: [method],
    },
    req,
    requestContext: req,
    config: {} as FarmIntegrationHandlerContext["config"],
    isDev: true,
    isProd: false,
  };
}

function InviteUserEmail(props: { orgName: string; inviteUrl: string }) {
  return (
    <html>
      <body>
        <h1>Join {props.orgName}</h1>
        <a href={props.inviteUrl}>Accept</a>
      </body>
    </html>
  );
}

function ResetPasswordEmail(props: { resetUrl: string }) {
  return (
    <html>
      <body>
        <a href={props.resetUrl}>Reset</a>
      </body>
    </html>
  );
}

InviteUserEmail.PreviewProps = {
  orgName: "Acme 01",
  inviteUrl: "https://acme.dev/invite/preview",
};

ResetPasswordEmail.PreviewProps = {
  resetUrl: "https://acme.dev/reset/preview",
};

function createResendStub() {
  return {
    emails: {
      send: vi.fn(async () => ({
        data: {
          id: "email_test_123",
        },
        error: null,
        headers: null,
      })),
    },
    webhooks: {
      verify: vi.fn(() => ({
        type: "email.delivered" as const,
        created_at: "2026-04-10T00:00:00.000Z",
        data: {
          created_at: "2026-04-10T00:00:00.000Z",
          email_id: "email_test_123",
          from: "Acme <hello@example.com>",
          to: ["person@example.com"],
          subject: "Join Acme 01",
        },
      })),
    },
  };
}

describe("resend email integration", () => {
  const resendStub = createResendStub();
  const integration = resend({
    instance: resendStub as never,
    // The mounted routes spend real credits, so they require authorization.
    // This suite's fixture authorizes every caller; the guard itself is
    // covered by its own describe block below.
    authorize: () => true,
    defaults: {
      from: "Acme <hello@example.com>",
      replyTo: "support@example.com",
    },
    templates: {
      inviteUser: {
        component: InviteUserEmail,
        subject: ({ orgName }) => `Join ${orgName}`,
        previewText: ({ orgName }) => `Invitation to ${orgName}`,
      },
      resetPassword: {
        component: ResetPasswordEmail,
        subject: () => "Reset your password",
      },
    },
    webhooks: {
      path: "/api/email/webhook",
      secret: "whsec_test",
    },
  });

  const typedApi = createIntegrationClient({
    email: integration,
  });

  if (false) {
    void typedApi.email.send({
      body: {
        templateId: "inviteUser",
        to: "person@example.com",
        data: {
          orgName: "Acme 01",
          inviteUrl: "https://acme.dev/invite/123",
        },
      },
    });

    // @ts-expect-error inviteUser does not accept resetUrl
    void typedApi.email.send({
      body: {
        templateId: "inviteUser",
        to: "person@example.com",
        data: {
          resetUrl: "https://acme.dev/reset/123",
        },
      },
    });

    void typedApi.email.schedule({
      body: {
        templateId: "resetPassword",
        to: "person@example.com",
        when: emailSchedule.after.min(1),
        data: {
          resetUrl: "https://acme.dev/reset/123",
        },
      },
    });

    void typedApi.email.schedule({
      body: {
        templateId: "inviteUser",
        to: "person@example.com",
        when: 60 * 60,
        data: {
          orgName: "Acme 01",
          inviteUrl: "https://acme.dev/invite/123",
        },
      },
    });
  }

  it("infers api.email.send input from templateId", () => {
    expectTypeOf<Parameters<typeof typedApi.email.send>[0]>().toMatchTypeOf<{
      body: ResendEmailSendInput<{
        inviteUser: {
          component: typeof InviteUserEmail;
          subject: ({ orgName }: { orgName: string; inviteUrl: string }) => string;
          previewText: ({ orgName }: { orgName: string; inviteUrl: string }) => string;
        };
        resetPassword: {
          component: typeof ResetPasswordEmail;
          subject: () => string;
        };
      }>;
    }>();
  });

  it("infers api.email.schedule input from templateId", () => {
    expectTypeOf<Parameters<typeof typedApi.email.schedule>[0]>().toMatchTypeOf<{
      body: ResendEmailScheduleInput<{
        inviteUser: {
          component: typeof InviteUserEmail;
          subject: ({ orgName }: { orgName: string; inviteUrl: string }) => string;
          previewText: ({ orgName }: { orgName: string; inviteUrl: string }) => string;
        };
        resetPassword: {
          component: typeof ResetPasswordEmail;
          subject: () => string;
        };
      }>;
    }>();
  });

  it("sends typed template data through the integration route", async () => {
    const route = integration.routes.find(
      (candidate) => candidate.path === "/api/email/send" && candidate.method === "POST",
    );
    expect(route).toBeTruthy();

    const request = new Request("http://example.com/api/email/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        templateId: "inviteUser",
        to: "person@example.com",
        data: {
          orgName: "Acme 01",
          inviteUrl: "https://acme.dev/invite/123",
        },
      }),
    });

    const response = await route!.handler(
      request,
      createContext(request, "POST", "/api/email/send", integration.instance),
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(await response.text())).toMatchObject({
      id: "email_test_123",
      provider: "resend",
      templateId: "inviteUser",
      from: "Acme <hello@example.com>",
      to: ["person@example.com"],
      subject: "Join Acme 01",
      previewText: "Invitation to Acme 01",
    });
    expect(resendStub.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Acme <hello@example.com>",
        subject: "Join Acme 01",
        to: "person@example.com",
      }),
      undefined,
    );
  });

  it("returns template metadata with React Email preview props", async () => {
    const route = integration.routes.find(
      (candidate) => candidate.path === "/api/email/templates" && candidate.method === "GET",
    );
    expect(route).toBeTruthy();

    const request = new Request("http://example.com/api/email/templates", {
      method: "GET",
    });

    const response = await route!.handler(
      request,
      createContext(request, "GET", "/api/email/templates", integration.instance),
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(await response.text())).toEqual([
      {
        id: "inviteUser",
        hasPreviewText: true,
        hasCustomFrom: false,
        hasCustomReplyTo: false,
        previewProps: {
          orgName: "Acme 01",
          inviteUrl: "https://acme.dev/invite/preview",
        },
      },
      {
        id: "resetPassword",
        hasPreviewText: false,
        hasCustomFrom: false,
        hasCustomReplyTo: false,
        previewProps: {
          resetUrl: "https://acme.dev/reset/preview",
        },
      },
    ]);
  });

  it("schedules typed template data through the integration route", async () => {
    const route = integration.routes.find(
      (candidate) => candidate.path === "/api/email/schedule" && candidate.method === "POST",
    );
    expect(route).toBeTruthy();

    const request = new Request("http://example.com/api/email/schedule", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        templateId: "resetPassword",
        to: "person@example.com",
        when: "2026-04-12T09:00:00.000Z",
        data: {
          resetUrl: "https://acme.dev/reset/123",
        },
      }),
    });

    const response = await route!.handler(
      request,
      createContext(request, "POST", "/api/email/schedule", integration.instance),
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(await response.text())).toMatchObject({
      id: "email_test_123",
      provider: "resend",
      templateId: "resetPassword",
      from: "Acme <hello@example.com>",
      to: ["person@example.com"],
      subject: "Reset your password",
      previewText: null,
      when: "2026-04-12T09:00:00.000Z",
    });
    expect(resendStub.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Acme <hello@example.com>",
        subject: "Reset your password",
        to: "person@example.com",
        scheduledAt: "2026-04-12T09:00:00.000Z",
      }),
      undefined,
    );
  });

  it("normalizes delay helpers and raw seconds for scheduling", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-11T10:00:00.000Z"));

      const route = integration.routes.find(
        (candidate) => candidate.path === "/api/email/schedule" && candidate.method === "POST",
      );
      expect(route).toBeTruthy();

      const helperRequest = new Request("http://example.com/api/email/schedule", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          templateId: "inviteUser",
          to: "person@example.com",
          when: emailSchedule.after.min(1),
          data: {
            orgName: "Acme 01",
            inviteUrl: "https://acme.dev/invite/123",
          },
        }),
      });

      const helperResponse = await route!.handler(
        helperRequest,
        createContext(helperRequest, "POST", "/api/email/schedule", integration.instance),
      );

      expect(helperResponse.status).toBe(200);
      expect(JSON.parse(await helperResponse.text())).toMatchObject({
        when: "2026-04-11T10:01:00.000Z",
      });

      const secondsRequest = new Request("http://example.com/api/email/schedule", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          templateId: "inviteUser",
          to: "person@example.com",
          when: 30 * 60,
          data: {
            orgName: "Acme 01",
            inviteUrl: "https://acme.dev/invite/123",
          },
        }),
      });

      const secondsResponse = await route!.handler(
        secondsRequest,
        createContext(secondsRequest, "POST", "/api/email/schedule", integration.instance),
      );

      expect(secondsResponse.status).toBe(200);
      expect(JSON.parse(await secondsResponse.text())).toMatchObject({
        when: "2026-04-11T10:30:00.000Z",
      });
      expect(resendStub.emails.send).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scheduledAt: "2026-04-11T10:30:00.000Z",
        }),
        undefined,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("verifies and dispatches Resend webhook events through webhooks.onEvent", async () => {
    const seen: Array<{ id: string; type: string; provider: string }> = [];
    const webhookIntegration = resend({
      instance: resendStub as never,
      templates: {
        inviteUser: {
          component: InviteUserEmail,
          subject: ({ orgName }) => `Join ${orgName}`,
        },
      },
      webhooks: {
        path: "/api/email/webhook",
        secret: "whsec_test",
        async onEvent(event) {
          seen.push({
            id: event.id,
            type: event.type,
            provider: event.provider,
          });
        },
      },
    });

    const route = webhookIntegration.routes.find(
      (candidate) => candidate.path === "/api/email/webhook" && candidate.method === "POST",
    );
    expect(route).toBeTruthy();

    const request = new Request("http://example.com/api/email/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": "msg_resend_123",
        "svix-timestamp": "1712707200",
        "svix-signature": "v1,fake",
      },
      body: JSON.stringify({
        type: "email.delivered",
      }),
    });

    const response = await route!.handler(
      request,
      createContext(request, "POST", "/api/email/webhook", webhookIntegration.instance),
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(await response.text())).toMatchObject({
      received: true,
      provider: "resend",
      webhook: "default",
      eventId: "msg_resend_123",
      type: "email.delivered",
    });
    expect(seen).toEqual([
      {
        id: "msg_resend_123",
        type: "email.delivered",
        provider: "resend",
      },
    ]);
    expect(resendStub.webhooks.verify).toHaveBeenCalledWith({
      payload: JSON.stringify({
        type: "email.delivered",
      }),
      webhookSecret: "whsec_test",
      headers: {
        id: "msg_resend_123",
        timestamp: "1712707200",
        signature: "v1,fake",
      },
    });
  });
});

describe("email route authorization", () => {
  function createGuardedIntegration(
    options: Parameters<typeof resend>[0] extends never ? never : Record<string, unknown> = {},
  ) {
    const resendStub = createResendStub();
    const integration = resend({
      instance: resendStub as never,
      defaults: { from: "Acme <hello@example.com>" },
      templates: {
        inviteUser: {
          component: InviteUserEmail,
          subject: ({ orgName }) => `Join ${orgName}`,
        },
      },
      ...options,
    } as never);
    return { integration, resendStub };
  }

  function sendRequest(headers: Record<string, string> = {}) {
    return new Request("http://example.com/api/email/send", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        templateId: "inviteUser",
        to: "victim@example.com",
        data: { orgName: "Acme", inviteUrl: "https://acme.dev/i/1" },
      }),
    });
  }

  function invoke(integration: { routes: any[]; instance: unknown }, request: Request) {
    const route = integration.routes.find(
      (candidate) => candidate.path === "/api/email/send" && candidate.method === "POST",
    );
    return route!.handler(
      request,
      createContext(request, "POST", "/api/email/send", integration.instance),
    );
  }

  it("refuses an anonymous caller instead of spending the account's credits", async () => {
    // The route is mounted the moment the integration is configured, so an
    // unconfigured guard must fail closed rather than relay mail for anyone.
    const { integration, resendStub } = createGuardedIntegration();

    const response = await invoke(integration, sendRequest());

    expect(response.status).toBe(401);
    expect(JSON.parse(await response.text()).error).toMatch(/authorize/);
    expect(resendStub.emails.send).not.toHaveBeenCalled();
  });

  it("refuses a cross-site caller even when authorization would pass", async () => {
    // A session-cookie `authorize` would otherwise accept a forged POST from
    // any page the victim visits.
    const { integration, resendStub } = createGuardedIntegration({ authorize: () => true });

    const response = await invoke(
      integration,
      sendRequest({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }),
    );

    expect(response.status).toBe(403);
    expect(resendStub.emails.send).not.toHaveBeenCalled();
  });

  it("honors an authorize decision, including a caller-supplied Response", async () => {
    const denied = createGuardedIntegration({ authorize: () => false });
    expect((await invoke(denied.integration, sendRequest())).status).toBe(401);
    expect(denied.resendStub.emails.send).not.toHaveBeenCalled();

    const custom = createGuardedIntegration({
      authorize: () => new Response("nope", { status: 402 }),
    });
    expect((await invoke(custom.integration, sendRequest())).status).toBe(402);

    const allowed = createGuardedIntegration({ authorize: () => true });
    expect((await invoke(allowed.integration, sendRequest())).status).toBe(200);
    expect(allowed.resendStub.emails.send).toHaveBeenCalledTimes(1);
  });

  it("serves an explicit allowUnauthenticated opt-in", async () => {
    const { integration, resendStub } = createGuardedIntegration({ allowUnauthenticated: true });

    expect((await invoke(integration, sendRequest())).status).toBe(200);
    expect(resendStub.emails.send).toHaveBeenCalledTimes(1);
  });

  it("never forwards caller-supplied email headers to the provider", async () => {
    const { integration, resendStub } = createGuardedIntegration({ authorize: () => true });
    const request = new Request("http://example.com/api/email/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        templateId: "inviteUser",
        to: "person@example.com",
        headers: { "Reply-To": "attacker@evil.example", "List-Unsubscribe": "<x>" },
        data: { orgName: "Acme", inviteUrl: "https://acme.dev/i/1" },
      }),
    });

    expect((await invoke(integration, request)).status).toBe(200);
    expect(resendStub.emails.send.mock.calls[0]![0]).not.toHaveProperty("headers");
  });
});
