export const ssg = true;

export default function OfflinePage() {
  return (
    <section className="card">
      <p className="eyebrow">Connection unavailable</p>
      <h1>You are offline.</h1>
      <p>The application shell is available. Reconnect to load fresh server data.</p>
      <a href="/">Try the home page again</a>
    </section>
  );
}
