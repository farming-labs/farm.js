export async function GET() {
  const response = await fetch("https://inventory.farm.test/status?surface=server");
  if (!response.ok) {
    return Response.json({ error: `Upstream returned ${response.status}` }, { status: 502 });
  }
  return Response.json(await response.json());
}
