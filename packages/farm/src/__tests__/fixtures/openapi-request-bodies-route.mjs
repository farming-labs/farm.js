import { z } from "zod";

export const QUERY = async () => Response.json({ ok: true });
QUERY.__types = { body: z.object({ term: z.string() }) };

export const POST = async () => new Response(null, { status: 204 });

export const PUT = async () => new Response(null, { status: 204 });
PUT.__types = { body: undefined };

export const PATCH = async () => new Response(null, { status: 204 });
PATCH.__types = { body: z.object({ name: z.string() }) };

export const DELETE = async () => new Response(null, { status: 204 });
DELETE.__types = { body: z.object({ force: z.boolean() }).optional() };
