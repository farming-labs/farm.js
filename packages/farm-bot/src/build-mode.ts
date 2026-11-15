/** True in a production build, where the bundler fixes this value at build time. */
export function isProductionBuild(): boolean {
  return (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD === true;
}
