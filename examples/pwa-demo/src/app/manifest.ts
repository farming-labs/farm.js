import type { MetadataRoute } from "@farm.js/core";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Farm PWA Demo",
    short_name: "Farm PWA",
    description: "An installable and offline-aware Farm application",
    start_url: "/",
    display: "standalone",
    background_color: "#08120e",
    theme_color: "#34d399",
    icons: [{ src: "/farm-pwa.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
