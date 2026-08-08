import type { Metadata } from "@farm.js/core";
import { AuthForm } from "../../components/auth-form";
import { AuthShell } from "../../components/auth-shell";

export const metadata: Metadata = {
  title: "Create account | FARMJS Auth Starter",
  description: "Create an account with FARMJS Auth.",
};

export default function SignUpPage() {
  return (
    <AuthShell>
      <AuthForm mode="sign-up" />
    </AuthShell>
  );
}
