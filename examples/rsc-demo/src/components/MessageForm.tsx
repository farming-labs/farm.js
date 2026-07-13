"use client";

// Client Component that calls a Server Action
// Forms can call server actions directly without needing an API route!

import React from "react";
import { useServerFn } from "@farmjs/core/server-fn/client";
import { submitMessage } from "../actions/user";

export function MessageForm() {
  const submitMessageAction = useServerFn(submitMessage, {
    optimistic({ formData }) {
      const name = String(formData?.get("name") ?? "").trim();
      const message = String(formData?.get("message") ?? "").trim();
      if (!name || !message) return undefined;

      return {
        success: true as const,
        message: {
          id: -1,
          name,
          message,
          timestamp: "pending",
        },
      };
    },
    rollbackOnError: true,
    onSuccess(result) {
      if (result?.success) {
        const form = document.getElementById("message-form") as HTMLFormElement;
        form?.reset();
        window.dispatchEvent(new CustomEvent("messages-updated"));
      }
    },
  });

  const result = submitMessageAction.result;

  return (
    <div className="bg-slate-800/50 rounded-xl p-6 border border-orange-700/50">
      <h3 className="text-xl font-semibold text-orange-400 mb-4">
        Server Action Form
      </h3>
      <p className="text-slate-400 mb-4">
        This form calls a <code className="text-orange-400">createServerFn</code>{" "}
        action directly. No API route needed!
      </p>

      <form id="message-form" action={submitMessageAction.formAction} className="space-y-4">
        <output className="sr-only" data-testid="server-action-status">
          {submitMessageAction.status}
        </output>
        <div>
          <label htmlFor="name" className="block text-sm text-slate-400 mb-1">
            Name
          </label>
          <input
            type="text"
            id="name"
            name="name"
            required
            className="w-full px-4 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-white focus:border-orange-500 focus:outline-none"
            placeholder="Enter your name"
          />
        </div>

        <div>
          <label
            htmlFor="message"
            className="block text-sm text-slate-400 mb-1"
          >
            Message
          </label>
          <textarea
            id="message"
            name="message"
            required
            rows={3}
            className="w-full px-4 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-white focus:border-orange-500 focus:outline-none resize-none"
            placeholder="Enter your message"
          />
        </div>

        <button
          type="submit"
          disabled={submitMessageAction.pending}
          className="w-full px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-orange-800 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors"
        >
          {submitMessageAction.pending ? "Submitting..." : "Submit Message"}
        </button>
      </form>

      {(result || submitMessageAction.error) && (
        <div
          data-testid="server-action-result"
          className={`mt-4 p-4 rounded-lg ${
            result?.success && !submitMessageAction.error
              ? "bg-green-900/30 border border-green-700/50"
              : "bg-red-900/30 border border-red-700/50"
          }`}
        >
          {result?.success ? (
            <p className="text-green-400">
              {submitMessageAction.pending ? "Saving" : "Saved"} message from "
              {result.message.name}".
            </p>
          ) : (
            <p className="text-red-400">
              {submitMessageAction.error?.message ?? "Unable to save this message."}
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-slate-500 mt-4">
        The submitMessage function runs on the server, but React handles calling
        it seamlessly from the client!
      </p>
    </div>
  );
}
