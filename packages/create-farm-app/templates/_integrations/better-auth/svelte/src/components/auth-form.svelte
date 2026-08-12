<script lang="ts">
  import { authClient } from "../lib/auth-client";

  let { mode }: { mode: "sign-in" | "sign-up" } = $props();
  const isSignUp = $derived(mode === "sign-up");
  let pending = $state(false);
  let error = $state<string | null>(null);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = null;
    pending = true;

    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const name = String(formData.get("name") ?? "").trim();

    try {
      const response = isSignUp
        ? await authClient.signUp.email({ email, name, password })
        : await authClient.signIn.email({ email, password });
      if (response.error) {
        error = response.error.message ?? "We could not complete that request.";
        pending = false;
        return;
      }
      window.location.assign("/dashboard");
    } catch {
      error = "The authentication service could not be reached. Please try again.";
      pending = false;
    }
  }
</script>

<div class="auth-form-panel">
  <div class="auth-form-heading">
    <span class="section-index">{isSignUp ? "01 / SIGN UP" : "01 / SIGN IN"}</span>
    <h1>{isSignUp ? "Create account." : "Welcome back."}</h1>
  </div>

  <form class="auth-form" onsubmit={submit}>
    {#if isSignUp}
      <label class="field">
        <span><small>01</small> Name</span>
        <input autocomplete="name" minlength="2" name="name" required type="text" />
      </label>
    {/if}
    <label class="field">
      <span><small>{isSignUp ? "02" : "01"}</small> Email</span>
      <input autocomplete="email" name="email" required type="email" />
    </label>
    <label class="field">
      <span><small>{isSignUp ? "03" : "02"}</small> Password</span>
      <input
        autocomplete={isSignUp ? "new-password" : "current-password"}
        minlength="8"
        name="password"
        required
        type="password"
      />
    </label>

    {#if error}
      <div class="form-error" role="alert">
        <strong>Authentication failed</strong>
        <span>{error}</span>
      </div>
    {/if}

    <button class="button button-primary auth-submit" disabled={pending} type="submit">
      <span>{pending ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}</span>
      <span aria-hidden="true">{pending ? "···" : "→"}</span>
    </button>
  </form>

  <p class="auth-switch">
    {isSignUp ? "Have an account?" : "Need an account?"}
    <a href={isSignUp ? "/sign-in" : "/sign-up"}>
      {isSignUp ? "Sign in →" : "Sign up →"}
    </a>
  </p>
</div>
