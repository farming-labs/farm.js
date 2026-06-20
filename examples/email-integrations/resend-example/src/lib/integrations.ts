import type { ComponentProps } from "react";
import { resend, type EmailTemplate } from "@farmjs/integrations/email";
import { InviteUserEmail } from "./emails/invite-user.tsx";
import { ResetPasswordEmail } from "./emails/reset-password.tsx";

const apiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.RESEND_FROM_EMAIL;

if (!apiKey) {
  throw new Error(
    "Resend example requires RESEND_API_KEY. Add it to examples/email-integrations/resend-example/.env.local.",
  );
}

if (!fromEmail) {
  throw new Error(
    "Resend example requires RESEND_FROM_EMAIL. Add it to examples/email-integrations/resend-example/.env.local.",
  );
}

export const inviteUser = {
  component: InviteUserEmail,
  subject: ({ orgName }) => `Join ${orgName}`,
  previewText: ({ orgName }) => `Invitation to ${orgName}`,
} satisfies EmailTemplate<ComponentProps<typeof InviteUserEmail>>;

export const resetPassword = {
  component: ResetPasswordEmail,
  subject: () => "Reset your password",
  previewText: () => "Password reset instructions",
} satisfies EmailTemplate<ComponentProps<typeof ResetPasswordEmail>>;

export const emailTemplates = {
  inviteUser,
  resetPassword,
} as const;

export const appIntegrations = {
  email: resend({
    apiKey,
    basePath: "/api/email",
    defaults: {
      from: fromEmail,
      replyTo: process.env.RESEND_REPLY_TO_EMAIL ?? fromEmail,
    },
    templates: emailTemplates,
    webhooks: {
      path: "/api/email/webhook",
      secret: process.env.RESEND_WEBHOOK_SECRET,
      async onEvent(event) {
        console.log("[resend-example:webhook]", event.type, event.id);
      },
    },
    log(event) {
      console.log("[resend-example]", event.phase, event.route?.path || "none");
    },
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
export type AppEmailTemplates = typeof emailTemplates;
