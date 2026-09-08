export function createHttpLocalUrl(host: string, port: number | string): string {
  const hostname =
    host.includes(":") && !(host.startsWith("[") && host.endsWith("]")) ? `[${host}]` : host;
  return `http://${hostname}:${port}`;
}
