export const dynamic = "force-static";
export const metadata = {
  title: "Account",
  description: "An intentionally excluded static page.",
};

export default function AccountPage() {
  return (
    <main className="article">
      <p className="eyebrow">Excluded route</p>
      <h1>Billing settings</h1>
      <p>This static page proves that route exclusions keep selected content out of the index.</p>
      <a className="back-link" href="/">← Back to search</a>
    </main>
  );
}
