<script setup lang="ts">
import { computed, ref } from "vue";
import { authClient } from "../lib/auth-client";

const props = defineProps<{ mode: "sign-in" | "sign-up" }>();
const isSignUp = computed(() => props.mode === "sign-up");
const pending = ref(false);
const error = ref<string | null>(null);

async function submit(event: Event) {
  event.preventDefault();
  error.value = null;
  pending.value = true;

  const formData = new FormData(event.currentTarget as HTMLFormElement);
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  try {
    const response = isSignUp.value
      ? await authClient.signUp.email({ email, name, password })
      : await authClient.signIn.email({ email, password });
    if (response.error) {
      error.value = response.error.message ?? "We could not complete that request.";
      pending.value = false;
      return;
    }
    window.location.assign("/dashboard");
  } catch {
    error.value = "The authentication service could not be reached. Please try again.";
    pending.value = false;
  }
}
</script>

<template>
  <div class="auth-form-panel">
    <div class="auth-form-heading">
      <span class="section-index">{{ isSignUp ? "01 / SIGN UP" : "01 / SIGN IN" }}</span>
      <h1>{{ isSignUp ? "Create account." : "Welcome back." }}</h1>
    </div>

    <form class="auth-form" @submit="submit">
      <label v-if="isSignUp" class="field">
        <span><small>01</small> Name</span>
        <input autocomplete="name" minlength="2" name="name" required type="text" />
      </label>
      <label class="field">
        <span
          ><small>{{ isSignUp ? "02" : "01" }}</small> Email</span
        >
        <input autocomplete="email" name="email" required type="email" />
      </label>
      <label class="field">
        <span
          ><small>{{ isSignUp ? "03" : "02" }}</small> Password</span
        >
        <input
          :autocomplete="isSignUp ? 'new-password' : 'current-password'"
          minlength="8"
          name="password"
          required
          type="password"
        />
      </label>

      <div v-if="error" class="form-error" role="alert">
        <strong>Authentication failed</strong>
        <span>{{ error }}</span>
      </div>

      <button class="button button-primary auth-submit" :disabled="pending" type="submit">
        <span>{{ pending ? "Please wait…" : isSignUp ? "Create account" : "Sign in" }}</span>
        <span aria-hidden="true">{{ pending ? "···" : "→" }}</span>
      </button>
    </form>

    <p class="auth-switch">
      {{ isSignUp ? "Have an account?" : "Need an account?" }}
      <a :href="isSignUp ? '/sign-in' : '/sign-up'">
        {{ isSignUp ? "Sign in →" : "Sign up →" }}
      </a>
    </p>
  </div>
</template>
