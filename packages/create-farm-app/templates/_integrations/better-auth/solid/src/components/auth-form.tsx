"use client";

import { createSignal } from "solid-js";
import { authClient } from "../lib/auth-client";

export function AuthForm(props: { mode: "sign-in" | "sign-up" }) {
  const isSignUp = () => props.mode === "sign-up";
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const name = String(formData.get("name") ?? "").trim();

    try {
      const response = isSignUp()
        ? await authClient.signUp.email({ email, name, password })
        : await authClient.signIn.email({ email, password });
      if (response.error) {
        setError(response.error.message ?? "We could not complete that request.");
        setPending(false);
        return;
      }
      window.location.assign("/dashboard");
    } catch {
      setError("The authentication service could not be reached. Please try again.");
      setPending(false);
    }
  }

  return (
    <div class="auth-form-panel">
      <div class="auth-form-heading">
        <span class="section-index">{isSignUp() ? "01 / SIGN UP" : "01 / SIGN IN"}</span>
        <h1>{isSignUp() ? "Create account." : "Welcome back."}</h1>
      </div>

      <form class="auth-form" onSubmit={submit}>
        {isSignUp() ? (
          <label class="field">
            <span>
              <small>01</small> Name
            </span>
            <input autocomplete="name" minlength={2} name="name" required type="text" />
          </label>
        ) : null}
        <label class="field">
          <span>
            <small>{isSignUp() ? "02" : "01"}</small> Email
          </span>
          <input autocomplete="email" name="email" required type="email" />
        </label>
        <label class="field">
          <span>
            <small>{isSignUp() ? "03" : "02"}</small> Password
          </span>
          <input
            autocomplete={isSignUp() ? "new-password" : "current-password"}
            minlength={8}
            name="password"
            required
            type="password"
          />
        </label>

        {error() ? (
          <div class="form-error" role="alert">
            <strong>Authentication failed</strong>
            <span>{error()}</span>
          </div>
        ) : null}

        <button class="button button-primary auth-submit" disabled={pending()} type="submit">
          <span>{pending() ? "Please wait…" : isSignUp() ? "Create account" : "Sign in"}</span>
          <span aria-hidden="true">{pending() ? "···" : "→"}</span>
        </button>
      </form>

      <p class="auth-switch">
        {isSignUp() ? "Have an account?" : "Need an account?"}{" "}
        <a href={isSignUp() ? "/sign-in" : "/sign-up"}>{isSignUp() ? "Sign in →" : "Sign up →"}</a>
      </p>
    </div>
  );
}
