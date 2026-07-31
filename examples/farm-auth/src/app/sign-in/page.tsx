"use client";

import { AuthForm } from "../auth-form";

export default function SignInPage() {
  return (
    <main className="page-shell">
      <AuthForm mode="sign-in" />
    </main>
  );
}
