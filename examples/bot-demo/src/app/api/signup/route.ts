import { verifyBot } from "@farm.js/bot/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const check = await verifyBot(form);

  if (!check.success) {
    return Response.json({ error: check.message, code: check.code }, { status: check.status });
  }

  const email = String(form.get("email") ?? "");
  return Response.json({ created: email, testKeys: check.testKeys });
}
