import type { ComponentProps, ComponentType } from "react";
import type { Attachment, Tag } from "resend";
import { api } from "@farm.js/core/client";
import {
  createPathInferredClientApi,
  type InferPathInferredClientAPI,
  type PathInferredClientOperation,
} from "@farm.js/integration-utils/integration";
import type { FarmWebhookAckResult } from "@farm.js/integration-utils/webhooks";
import type { EmailScheduleDelay, EmailScheduleWhen } from "./schedule.js";
export type { EmailScheduleDelay, EmailScheduleWhen } from "./schedule.js";

export type EmailTemplateComponent<TData> = ComponentType<TData> & {
  PreviewProps?: TData;
};

export interface EmailTemplate<TData> {
  component: EmailTemplateComponent<TData>;
  subject: string | ((data: TData) => string | Promise<string>);
  previewText?: string | ((data: TData) => string | Promise<string>);
  from?: string | ((data: TData) => string | Promise<string>);
  replyTo?: string | string[] | ((data: TData) => string | string[] | Promise<string | string[]>);
}

export type EmailTemplates = Record<string, EmailTemplate<any>>;

export type InferTemplateData<TTemplate> =
  TTemplate extends EmailTemplate<infer TData> ? TData : never;

export function template<TComponent extends EmailTemplateComponent<any>>(
  component: TComponent,
  config: Omit<EmailTemplate<ComponentProps<TComponent>>, "component">,
): EmailTemplate<ComponentProps<TComponent>> {
  return {
    component,
    ...config,
  };
}

export interface EmailSendBaseInput {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  from?: string;
  replyTo?: string | string[];
  headers?: Record<string, string>;
  tags?: Tag[];
  attachments?: Attachment[];
  topicId?: string | null;
  scheduledAt?: string;
  idempotencyKey?: string;
}

export interface EmailScheduleBaseInput extends Omit<EmailSendBaseInput, "scheduledAt"> {
  when: EmailScheduleWhen;
}

export type ResendEmailSendInput<TTemplates extends EmailTemplates> = {
  [TTemplateId in keyof TTemplates & string]: EmailSendBaseInput & {
    templateId: TTemplateId;
    data: InferTemplateData<TTemplates[TTemplateId]>;
  };
}[keyof TTemplates & string];

export type ResendEmailScheduleInput<TTemplates extends EmailTemplates> = {
  [TTemplateId in keyof TTemplates & string]: EmailScheduleBaseInput & {
    templateId: TTemplateId;
    data: InferTemplateData<TTemplates[TTemplateId]>;
  };
}[keyof TTemplates & string];

export type ResendEmailPreviewInput<TTemplates extends EmailTemplates> = {
  [TTemplateId in keyof TTemplates & string]: {
    templateId: TTemplateId;
    data: InferTemplateData<TTemplates[TTemplateId]>;
  };
}[keyof TTemplates & string];

export type ResendEmailSendResult<TTemplates extends EmailTemplates = EmailTemplates> = {
  [TTemplateId in keyof TTemplates & string]: {
    id: string;
    provider: "resend";
    templateId: TTemplateId;
    from: string;
    to: string[];
    subject: string;
    previewText: string | null;
  };
}[keyof TTemplates & string];

export type ResendEmailScheduleResult<TTemplates extends EmailTemplates = EmailTemplates> = {
  [TTemplateId in keyof TTemplates & string]: ResendEmailSendResult<TTemplates> & {
    templateId: TTemplateId;
    when: string;
  };
}[keyof TTemplates & string];

export type ResendEmailPreviewResult<TTemplates extends EmailTemplates = EmailTemplates> = {
  [TTemplateId in keyof TTemplates & string]: {
    templateId: TTemplateId;
    subject: string;
    previewText: string | null;
    html: string;
    text: string;
  };
}[keyof TTemplates & string];

export type ResendEmailTemplateInfo<TTemplates extends EmailTemplates = EmailTemplates> = {
  [TTemplateId in keyof TTemplates & string]: {
    id: TTemplateId;
    hasPreviewText: boolean;
    hasCustomFrom: boolean;
    hasCustomReplyTo: boolean;
    previewProps: InferTemplateData<TTemplates[TTemplateId]> | null;
  };
}[keyof TTemplates & string];

export type ResendWebhookResult = FarmWebhookAckResult;

export interface ResendClientPathOptions {
  sendPath?: string;
  schedulePath?: string;
  previewPath?: string;
  templatesPath?: string;
}

type ResolvedResendClientPath<
  TPath extends string | undefined,
  TDefault extends string,
> = TPath extends string ? TPath : TDefault;

type ResendClientEntries<
  TTemplates extends EmailTemplates,
  TInput extends ResendClientPathOptions,
> = [
  PathInferredClientOperation<
    ResolvedResendClientPath<TInput["sendPath"], "/api/email/send">,
    ReturnType<typeof api.post<ResendEmailSendInput<TTemplates>, ResendEmailSendResult<TTemplates>>>
  >,
  PathInferredClientOperation<
    ResolvedResendClientPath<TInput["schedulePath"], "/api/email/schedule">,
    ReturnType<
      typeof api.post<ResendEmailScheduleInput<TTemplates>, ResendEmailScheduleResult<TTemplates>>
    >
  >,
  PathInferredClientOperation<
    ResolvedResendClientPath<TInput["previewPath"], "/api/email/preview">,
    ReturnType<
      typeof api.post<ResendEmailPreviewInput<TTemplates>, ResendEmailPreviewResult<TTemplates>>
    >
  >,
  PathInferredClientOperation<
    ResolvedResendClientPath<TInput["templatesPath"], "/api/email/templates">,
    ReturnType<typeof api.get<Array<ResendEmailTemplateInfo<TTemplates>>>>
  >,
];

export type ResendClientAPI<
  TTemplates extends EmailTemplates,
  TInput extends ResendClientPathOptions = {},
> = InferPathInferredClientAPI<ResendClientEntries<TTemplates, TInput>>;

export type ResendDefaultClientAPI<TTemplates extends EmailTemplates = EmailTemplates> =
  ResendClientAPI<TTemplates>;

export function createResendClientApi<
  TTemplates extends EmailTemplates,
>(): ResendDefaultClientAPI<TTemplates>;
export function createResendClientApi<
  TTemplates extends EmailTemplates,
  const TInput extends ResendClientPathOptions,
>(input: TInput): ResendClientAPI<TTemplates, TInput>;
export function createResendClientApi<
  TTemplates extends EmailTemplates,
  TInput extends ResendClientPathOptions,
>(input?: TInput) {
  const sendPath = (input?.sendPath ?? "/api/email/send") as ResolvedResendClientPath<
    TInput["sendPath"],
    "/api/email/send"
  >;
  const schedulePath = (input?.schedulePath ?? "/api/email/schedule") as ResolvedResendClientPath<
    TInput["schedulePath"],
    "/api/email/schedule"
  >;
  const previewPath = (input?.previewPath ?? "/api/email/preview") as ResolvedResendClientPath<
    TInput["previewPath"],
    "/api/email/preview"
  >;
  const templatesPath = (input?.templatesPath ??
    "/api/email/templates") as ResolvedResendClientPath<
    TInput["templatesPath"],
    "/api/email/templates"
  >;

  return createPathInferredClientApi(
    {
      path: sendPath,
      operation: api.post<ResendEmailSendInput<TTemplates>, ResendEmailSendResult<TTemplates>>(
        sendPath,
        {
          responseFormat: "json",
        },
      ),
    },
    {
      path: schedulePath,
      operation: api.post<
        ResendEmailScheduleInput<TTemplates>,
        ResendEmailScheduleResult<TTemplates>
      >(schedulePath, {
        responseFormat: "json",
      }),
    },
    {
      path: previewPath,
      operation: api.post<
        ResendEmailPreviewInput<TTemplates>,
        ResendEmailPreviewResult<TTemplates>
      >(previewPath, {
        responseFormat: "json",
      }),
    },
    {
      path: templatesPath,
      operation: api.get<Array<ResendEmailTemplateInfo<TTemplates>>>(templatesPath, {
        responseFormat: "json",
      }),
    },
  ) as ResendDefaultClientAPI<TTemplates> | ResendClientAPI<TTemplates, TInput>;
}

export const resendClient: ResendDefaultClientAPI = createResendClientApi<EmailTemplates>();
