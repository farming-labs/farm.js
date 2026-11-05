// The app's not-found page: for notFound() and for URLs that match no route.
export default function NotFound() {
  return (
    <section>
      <h1>Not found</h1>
      <p data-testid="not-found">This page does not exist.</p>
    </section>
  );
}
