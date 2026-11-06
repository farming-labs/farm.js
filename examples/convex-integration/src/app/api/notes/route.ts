import { getStorage } from "@farm.js/core/storage";

export async function GET() {
  const notes = getStorage("notes");
  const keys = await notes.getKeys();
  const values = await Promise.all(keys.map((key) => notes.getItem(key)));
  return Response.json({ notes: keys.map((key, index) => ({ key, value: values[index] })) });
}

export async function POST(request: Request) {
  const { key, value } = (await request.json()) as { key: string; value: string };
  await getStorage("notes").setItem(key, value);
  return Response.json({ saved: key });
}
