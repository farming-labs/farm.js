import type { ReactNode } from "react";
import { ResourceLinks } from "./resource-links";

interface AuthShellProps {
  children: ReactNode;
}

export function AuthShell({ children }: AuthShellProps) {
  return (
    <main className="auth-shell">
      <a className="auth-home-link" href="/" aria-label="Back to starter home">
        <span>00</span>
        <span>FARMJS / Auth starter</span>
      </a>

      <section className="auth-form-side">{children}</section>

      <ResourceLinks className="auth-resource-links" />
    </main>
  );
}
