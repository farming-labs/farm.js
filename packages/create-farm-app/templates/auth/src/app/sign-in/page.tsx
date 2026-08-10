import type { Metadata } from "@farm.js/core";
import { AuthForm } from "../../components/auth-form";
import { AuthShell } from "../../components/auth-shell";

export const metadata: Metadata = {
  title: "Sign in | FARMJS Auth Starter",
  description: "Sign in with FARMJS Auth.",
};

export default function SignInPage() {
  return (
    <AuthShell>
      <AuthForm mode="sign-in" />
    </AuthShell>
  );
}
