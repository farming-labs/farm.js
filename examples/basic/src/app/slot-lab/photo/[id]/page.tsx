export default function PhotoPage({
  params,
}: {
  params: {
    id: string;
  };
}) {
  return (
    <article data-testid="canonical-photo">
      <h2>Canonical photo {params.id}</h2>
      <p>This full page is rendered for direct requests and refreshes.</p>
    </article>
  );
}
