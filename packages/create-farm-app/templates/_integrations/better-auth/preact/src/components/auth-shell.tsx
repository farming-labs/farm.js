import type { ComponentChildren } from "preact";
import { ResourceLinks } from "./resource-links";

export function AuthShell({ children }: { children: ComponentChildren }) {
  return (
    <main className="auth-shell">
      <a className="auth-home-link" href="/" aria-label="Back to starter home">
        <span>00</span>
        <span>FARMJS / Preact + Better Auth</span>
      </a>

      <section className="auth-form-side">{children}</section>
      <ResourceLinks className="auth-resource-links" />
    </main>
  );
}
