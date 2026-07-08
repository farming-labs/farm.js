import { createNodePreviewGatewayHandler } from "@farmjs/preview-gateway";

export const config = {
  maxDuration: 60,
};

export default createNodePreviewGatewayHandler({
  domain: process.env.FARM_PREVIEW_DOMAIN || "preview.farming-labs.dev",
  baseUrl: process.env.FARM_PREVIEW_GATEWAY_URL,
});
