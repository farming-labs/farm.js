import type { JSX } from "solid-js";
import { ResourceLinks } from "./resource-links";

export function AuthShell(props: { children: JSX.Element }) {
  return (
    <main class="auth-shell">
      <a class="auth-home-link" href="/" aria-label="Back to starter home">
        <span>00</span>
        <span>FARMJS / Solid + Better Auth</span>
      </a>

      <section class="auth-form-side">{props.children}</section>
      <ResourceLinks className="auth-resource-links" />
    </main>
  );
}
