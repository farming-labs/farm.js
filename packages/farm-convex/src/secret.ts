export const SECRET_ENVIRONMENT_NAME = "FARM_CONVEX_SECRET";

export function readAdapterSecret(secret: string | undefined): string {
  const resolvedSecret = secret ?? process.env[SECRET_ENVIRONMENT_NAME];
  if (!resolvedSecret) {
    throw new Error(
      `Convex adapters need ${SECRET_ENVIRONMENT_NAME}. Set the same value in your Farm server env and with \`npx convex env set ${SECRET_ENVIRONMENT_NAME} <value>\`.`,
    );
  }
  return resolvedSecret;
}
