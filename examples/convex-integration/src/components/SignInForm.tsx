"use client";

import { useState } from "react";
import { authClient } from "../lib/auth-client";

export function SignInForm() {
  const [status, setStatus] = useState("");

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const email = String(form.get("email"));
        const password = String(form.get("password"));
        const signIn = await authClient.signIn.email({ email, password });
        if (!signIn.error) {
          window.location.assign("/account");
          return;
        }
        const signUp = await authClient.signUp.email({ email, password, name: email.split("@")[0] });
        if (signUp.error) {
          setStatus(signUp.error.message ?? "Sign in failed.");
          return;
        }
        window.location.assign("/account");
      }}
    >
      <input name="email" type="email" aria-label="Email" placeholder="you@example.com" required />
      <input name="password" type="password" aria-label="Password" minLength={8} required />
      <button type="submit">Sign in or sign up</button>
      {status ? <p role="alert">{status}</p> : null}
    </form>
  );
}
