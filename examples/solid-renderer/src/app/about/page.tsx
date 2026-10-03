export default function AboutPage() {
  return (
    <main class="page-shell">
      <section class="hero">
        <div class="eyebrow">
          <span>01</span>
          <span>Renderer-native route update</span>
        </div>
        <h1>
          New route. <span>Same Solid layout.</span>
        </h1>
        <p>
          The layout counter remains mounted while FARMJS replaces this page during client
          navigation.
        </p>
      </section>
    </main>
  );
}
