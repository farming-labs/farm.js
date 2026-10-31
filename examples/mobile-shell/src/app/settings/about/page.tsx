import type { Metadata } from "@farm.js/core";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <>
      <h1>About</h1>
      <div className="card">
        <p>
          Each screen is one WebView. The native navigator owns the stack, so this page was pushed
          on the Settings tab and the Notes tab kept its own stack.
        </p>
        <p className="meta">RFC 0004, section 7.</p>
      </div>
    </>
  );
}
