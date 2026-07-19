export const runtime = "auto";
export const regions = ["fra1"];
export const maxDuration = 15;

export async function GET() {
  return Response.json({
    generatedAt: new Date().toISOString(),
    policy: "regional-reports",
  });
}
