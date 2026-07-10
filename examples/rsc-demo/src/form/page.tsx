// Form page - Server Actions Demo
// Shows how to use createServerFn functions from Client Components

import React from "react";
import { MessageForm } from "../components/MessageForm";
import { MessagesList } from "../components/MessagesList";

export const metadata = {
  title: "Form | Farm.js RSC Demo",
  description: "Server Actions demo with forms",
};

export default function FormPage() {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-4">Server Actions</h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto">
          Use <code className="text-orange-400">createServerFn</code> to create
          validated functions that run on the server but can be called from forms.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Client Component with form */}
        <MessageForm />

        {/* Client Component that fetches and displays messages */}
        <MessagesList />
      </div>

      <div className="bg-slate-800/30 rounded-xl p-6 border border-slate-700">
        <h2 className="text-2xl font-semibold text-white mb-4">
          How Server Actions Work
        </h2>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-lg font-semibold text-orange-400 mb-2">
              Server Action (actions/user.ts)
            </h4>
            <pre className="bg-slate-900/50 rounded-lg p-4 overflow-x-auto text-sm">
              <code className="text-slate-300">{`export const submitMessage = createServerFn({
  input: z.object({
    name: z.string().min(1),
    message: z.string().min(1),
  }),
  async handler({ input }) {
    await db.messages.create(input);
    return { success: true };
  },
});`}</code>
            </pre>
          </div>
          <div>
            <h4 className="text-lg font-semibold text-purple-400 mb-2">
              Client Component
            </h4>
            <pre className="bg-slate-900/50 rounded-lg p-4 overflow-x-auto text-sm">
              <code className="text-slate-300">{`"use client";

import { submitMessage } from "./actions/user";

export function Form() {
  return (
    <form action={submitMessage}>
      <input name="name" />
      <input name="message" />
      <button type="submit">Send</button>
    </form>
  );
}`}</code>
            </pre>
          </div>
        </div>
        <div className="mt-4 p-4 bg-orange-900/20 border border-orange-700/30 rounded-lg">
          <h4 className="text-orange-400 font-semibold mb-2">Key Benefits:</h4>
          <ul className="text-slate-300 space-y-1">
            <li>• No API routes needed - call server functions directly</li>
            <li>• Type-safe - full TypeScript support end-to-end</li>
            <li>• Progressive enhancement - works without JavaScript</li>
            <li>• Automatic serialization of form data</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
