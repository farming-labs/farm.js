/**
 * Set on every request that `farm preview` tunnels into the development server. The preview relay
 * and the polling gateway client both overwrite any value a visitor sent, so its presence means
 * the request came from the public preview URL, not from the developer's machine.
 */
export const FARM_PREVIEW_REQUEST_HEADER = "x-farm-preview";
