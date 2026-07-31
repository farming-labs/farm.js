"use client";

import { AuthForm } from "../auth-form";

export default function SignUpPage() {
  return (
    <main className="page-shell">
      <AuthForm mode="sign-up" />
    </main>
  );
}
