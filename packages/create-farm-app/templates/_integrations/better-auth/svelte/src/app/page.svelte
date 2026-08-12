<script lang="ts">
  import ResourceLinks from "../components/resource-links.svelte";
</script>

<main class="landing-main">
  <section class="hero-section">
    <div class="hero-copy">
      <div class="eyebrow-row">
        <span>00</span>
        <span>FARMJS / Svelte + Better Auth</span>
      </div>

      <h1>Connect Postgres. Start at <code>/sign-up</code>.</h1>

      <div class="command-list" aria-label="Development commands">
        <div class="command-row">
          <span>01</span>
          <code>cp .env.example .env.local</code>
        </div>
        <div class="command-row">
          <span>02</span>
          <code>pnpm dev</code>
        </div>
      </div>

      <ResourceLinks
        className="resource-links"
        primary={{ href: "/sign-up", label: "Get started" }}
      />
    </div>
  </section>
</main>
