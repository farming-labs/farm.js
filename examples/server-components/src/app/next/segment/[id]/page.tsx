export default async function SegmentPage({
  params,
}: {
  params: { id: string } | Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <h1 data-testid="segment">{`Segment ${id}`}</h1>;
}
