"use client";

import { useEffect, useRef, useState } from "react";
import { apiClient } from "../lib/api";

type TemplateState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      templates: Array<{
        id: string;
        hasPreviewText: boolean;
        hasCustomFrom: boolean;
        hasCustomReplyTo: boolean;
      }>;
    };

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      subject: string;
      previewText: string | null;
      html: string;
      text: string;
    };

type SendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      id: string;
      templateId: string;
      subject: string;
      from: string;
      to: string[];
    };

export function HomeClient(props: {
  defaultFrom?: string;
  defaultTo?: string;
  webhookPath?: string;
} = {}) {
  const previewRequestId = useRef(0);
  const defaultFrom = props.defaultFrom?.trim() || "Configured on server via RESEND_FROM_EMAIL";
  const defaultTo = props.defaultTo?.trim() || "person@example.com";
  const webhookPath = props.webhookPath?.trim() || "/api/email/webhook";
  const [templates, setTemplates] = useState<TemplateState>({ status: "loading" });
  const [templateId, setTemplateId] = useState<"inviteUser" | "resetPassword">("inviteUser");
  const [to, setTo] = useState(defaultTo);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [sendState, setSendState] = useState<SendState>({ status: "idle" });
  const [inviteData, setInviteData] = useState({
    orgName: "Acme 01",
    inviteUrl: "https://acme.dev/invite/123",
  });
  const [resetData, setResetData] = useState({
    resetUrl: "https://acme.dev/reset/123",
  });

  useEffect(() => {
    let cancelled = false;

    async function loadTemplates() {
      const result = await apiClient.email.templates();

      if (cancelled) {
        return;
      }

      if (result.error) {
        setTemplates({ status: "error", message: result.error.message });
        return;
      }

      setTemplates({
        status: "ready",
        templates: Array.isArray(result.data) ? result.data : [],
      });
    }

    void loadTemplates();

    return () => {
      cancelled = true;
    };
  }, []);

  function currentBody() {
    if (templateId === "inviteUser") {
      return {
        templateId,
        data: inviteData,
      } as const;
    }

    return {
      templateId,
      data: resetData,
    } as const;
  }

  async function requestPreview() {
    const requestId = ++previewRequestId.current;
    setPreview({ status: "loading" });
    const result = await apiClient.email.preview({
      body: currentBody(),
    });

    if (requestId !== previewRequestId.current) {
      return;
    }

    if (result.error) {
      setPreview({ status: "error", message: result.error.message });
      return;
    }

    if (!result.data) {
      setPreview({ status: "error", message: "No preview returned." });
      return;
    }

    setPreview({
      status: "ready",
      subject: result.data.subject,
      previewText: result.data.previewText,
      html: result.data.html,
      text: result.data.text,
    });
  }

  useEffect(() => {
    if (templates.status !== "ready" || templates.templates.length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void requestPreview();
    }, 120);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    templateId,
    templates.status,
    templates.status === "ready" ? templates.templates.length : 0,
    inviteData.orgName,
    inviteData.inviteUrl,
    resetData.resetUrl,
  ]);

  async function handleSend() {
    setSendState({ status: "sending" });
    const payload =
      templateId === "inviteUser"
        ? {
            templateId,
            to,
            data: inviteData,
          }
        : {
            templateId,
            to,
            data: resetData,
          };

    const result = await apiClient.email.send({
        body: payload      
    });

    if (result.error) {
      setSendState({ status: "error", message: result.error.message });
      return;
    }

    if (!result.data) {
      setSendState({ status: "error", message: "No send result returned." });
      return;
    }

    setSendState({
      status: "ready",
      id: result.data.id,
      templateId: result.data.templateId,
      subject: result.data.subject,
      from: result.data.from,
      to: result.data.to,
    });
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <span className="eyebrow">Resend Email</span>
        <h1>Typed Email Integration</h1>
        <p>
          Choose a template, preview the rendered HTML and plain text, then send it through
          Resend using `apiClient.email.send(...)`.
        </p>
      </section>

      <section className="grid">
        <section className="card">
          <h2>Setup</h2>
          <div className="stack">
            <div className="line">
              <strong>From</strong>
              <span>{defaultFrom}</span>
            </div>
            <div className="line">
              <strong>Webhook</strong>
              <span>{webhookPath}</span>
            </div>
            <div className="line">
              <strong>Typed Call</strong>
              <span>
                <code>apiClient.email.send(&#123; body: &#123; templateId, data, to &#125; &#125;)</code>
              </span>
            </div>
          </div>
          {templates.status === "loading" ? <p>Loading templates…</p> : null}
          {templates.status === "error" ? <p>{templates.message}</p> : null}
          {templates.status === "ready" ? (
            templates.templates.length > 0 ? (
              <>
                <p className="helper-copy">The preview panel updates automatically for the selected template.</p>
                <ul className="template-list">
                  {templates.templates.map((item) => (
                    <li key={item.id}>
                      <strong>{item.id}</strong>
                      <span>
                        preview: {item.hasPreviewText ? "yes" : "no"} | from override:{" "}
                        {item.hasCustomFrom ? "yes" : "no"}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>No email templates are configured for this integration.</p>
            )
          ) : null}
        </section>

        <section className="card">
          <h2>Compose</h2>
          <label className="field">
            <span>Template</span>
            <select
              onChange={(event) => setTemplateId(event.target.value as "inviteUser" | "resetPassword")}
              value={templateId}
            >
              <option value="inviteUser">inviteUser</option>
              <option value="resetPassword">resetPassword</option>
            </select>
          </label>

          <label className="field">
            <span>Recipient</span>
            <input onChange={(event) => setTo(event.target.value)} value={to} />
          </label>

          {templateId === "inviteUser" ? (
            <div className="stack">
              <label className="field">
                <span>Organization Name</span>
                <input
                  onChange={(event) =>
                    setInviteData((current) => ({ ...current, orgName: event.target.value }))
                  }
                  value={inviteData.orgName}
                />
              </label>
              <label className="field">
                <span>Invite URL</span>
                <input
                  onChange={(event) =>
                    setInviteData((current) => ({ ...current, inviteUrl: event.target.value }))
                  }
                  value={inviteData.inviteUrl}
                />
              </label>
            </div>
          ) : null}

          {templateId === "resetPassword" ? (
            <label className="field">
              <span>Reset URL</span>
              <input
                onChange={(event) =>
                  setResetData((current) => ({ ...current, resetUrl: event.target.value }))
                }
                value={resetData.resetUrl}
              />
            </label>
          ) : null}

          <div className="actions">
            <button onClick={() => void requestPreview()} type="button">
              {preview.status === "loading" ? "Refreshing Preview…" : "Refresh Preview"}
            </button>
            <button className="primary" onClick={() => void handleSend()} type="button">
              {sendState.status === "sending" ? "Sending…" : "Send Email"}
            </button>
          </div>
        </section>
      </section>

      <section className="grid">
        <section className="card">
          <h2>Preview Result</h2>
          {preview.status === "idle" ? <p>Preparing the selected template preview…</p> : null}
          {preview.status === "loading" ? <p>Rendering the selected template…</p> : null}
          {preview.status === "error" ? <p>{preview.message}</p> : null}
          {preview.status === "ready" ? (
            <div className="stack">
              <div className="line">
                <strong>Subject</strong>
                <span>{preview.subject}</span>
              </div>
              <div className="line">
                <strong>Preview Text</strong>
                <span>{preview.previewText || "None"}</span>
              </div>
              <div className="field">
                <span>Rendered Email</span>
                <iframe
                  className="preview-frame"
                  srcDoc={preview.html}
                  title={`${preview.subject} rendered email preview`}
                />
              </div>
              <label className="field">
                <span>Plain Text</span>
                <textarea readOnly rows={8} value={preview.text} />
              </label>
              <label className="field">
                <span>HTML</span>
                <textarea readOnly rows={12} value={preview.html} />
              </label>
            </div>
          ) : null}
        </section>

        <section className="card">
          <h2>Send Result</h2>
          {sendState.status === "idle" ? <p>No email sent yet.</p> : null}
          {sendState.status === "error" ? <p>{sendState.message}</p> : null}
          {sendState.status === "ready" ? (
            <div className="stack">
              <div className="line">
                <strong>Email ID</strong>
                <span>{sendState.id}</span>
              </div>
              <div className="line">
                <strong>Template</strong>
                <span>{sendState.templateId}</span>
              </div>
              <div className="line">
                <strong>From</strong>
                <span>{sendState.from}</span>
              </div>
              <div className="line">
                <strong>To</strong>
                <span>{sendState.to.join(", ")}</span>
              </div>
              <div className="line">
                <strong>Subject</strong>
                <span>{sendState.subject}</span>
              </div>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
