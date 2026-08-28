export const ssg = true;

export default function HomePage() {
  return (
    <section className="card">
      <img src="/farm-pwa.svg" width="72" height="72" alt="Farm PWA" />
      <p className="eyebrow">@farm.js/pwa</p>
      <h1>Ready for unreliable networks.</h1>
      <p>
        This static page and its build assets are precached. Public images use SWR, and a dedicated
        fallback appears when an uncached navigation cannot reach the server.
      </p>
      <a href="/offline">Preview the offline fallback</a>
    </section>
  );
}
