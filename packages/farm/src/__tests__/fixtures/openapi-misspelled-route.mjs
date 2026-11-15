// A misspelled option must fail rather than publish the route.
export const openapi = { hide: true };

export const GET = async () => Response.json({ ok: true });
