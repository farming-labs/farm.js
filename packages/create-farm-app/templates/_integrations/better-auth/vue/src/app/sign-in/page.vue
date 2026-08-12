<script lang="ts">
export const hydrate = true;
</script>

<script setup lang="ts">
import AuthForm from "../../components/auth-form.vue";
import AuthShell from "../../components/auth-shell.vue";
</script>

<template>
  <AuthShell><AuthForm mode="sign-in" /></AuthShell>
</template>
