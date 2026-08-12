<script module lang="ts">
  export const hydrate = true;
</script>

<script lang="ts">
  import AuthForm from "../../components/auth-form.svelte";
  import AuthShell from "../../components/auth-shell.svelte";
</script>

<AuthShell><AuthForm mode="sign-up" /></AuthShell>
