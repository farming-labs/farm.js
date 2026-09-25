export const GET = async () => Response.json({ ok: true });
GET.__openapi = { security: "public" };

export const POST = async () => Response.json({ ok: true });
POST.__openapi = { security: "bearer" };

export const PUT = async () => Response.json({ ok: true });
