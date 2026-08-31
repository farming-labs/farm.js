---
title: "Images"
description: "Render responsive images with static dimensions, blur placeholders, secure remote optimization, and deployment-native providers."
section: "Core"
---

# Images

Farm turns local raster imports into typed image metadata and serves responsive variants through one secure optimizer URL.

## Static images

Import PNG, JPEG, GIF, WebP, or AVIF files and pass the import directly to `Image`. Farm reads the dimensions at build time, emits the original file as a public asset, and generates a small blur placeholder.

**src/app/products/page.tsx**

```tsx
import Image from "@farm.js/core/image";
import jacket from "./jacket.png";

export default function ProductsPage() {
  return (
    <Image
      src={jacket}
      alt="Green field jacket"
      placeholder="blur"
      sizes="(max-width: 768px) 100vw, 50vw"
    />
  );
}
```

Farm provides static image declarations directly from `@farm.js/core`, so image imports are typed as `StaticImageData` without generating an application file. The metadata includes `src`, `width`, `height`, and `blurDataURL`. Import with `?url` when a library needs only the original asset URL:

```ts
import jacketUrl from "./jacket.png?url";
```

## Files and remote URLs

A string source cannot provide dimensions at build time, so pass `width` and `height` explicitly. These values reserve layout space; the optimizer never enlarges the source image.

```tsx
import { Image } from "@farm.js/core/image";

export function Avatar() {
  return (
    <Image
      src="https://images.example.com/people/ada.jpg"
      alt="Ada Lovelace"
      width={640}
      height={640}
      quality={80}
    />
  );
}
```

Remote images are denied until their origin matches `remotePatterns` or the legacy `domains` list.

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.example.com",
        pathname: "/people/**",
      },
    ],
    qualities: [60, 75, 80, 90],
  },
});
```

Protocol, hostname, port, pathname, and search constraints are all checked when present. Prefer the narrowest pattern your application can use.

## Responsive layouts

Use `sizes` when the rendered width changes with the layout. Farm produces width descriptors from `imageSizes` and `deviceSizes`; the browser chooses the smallest suitable response.

```tsx
<Image
  src={jacket}
  alt="Green field jacket"
  sizes="(max-width: 640px) 100vw, (max-width: 1200px) 60vw, 720px"
/>
```

Use `fill` when a parent owns the aspect ratio. The parent must establish positioning and stable dimensions.

```tsx
<div style={{ position: "relative", aspectRatio: "4 / 3" }}>
  <Image src={jacket} alt="Green field jacket" fill sizes="50vw" />
</div>
```

## Loading behavior

Images are lazy-loaded and asynchronously decoded by default. Set `preload` only for a likely largest-contentful-paint image; Farm gives it eager loading, high fetch priority, and React preload metadata.

```tsx
<Image src={jacket} alt="Green field jacket" preload sizes="100vw" />
```

The global preload manager keeps one image hint by default, prioritizing the hint marked high before
ordinary React-generated hints. Excess hints are reported and removed without removing the image
elements themselves. Configure or audit the budget with `performance.preload` in `farm.config.ts`.

`placeholder="blur"` uses the placeholder generated for a static import. A string source must provide `blurDataURL` explicitly. Use `unoptimized` to preserve the original URL for a particular image.

## Configuration

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  images: {
    provider: "auto",
    path: "/_farm/image",
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    qualities: [75, 90],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60,
    maximumResponseBody: "10mb",
    maximumRedirects: 3,
    localPatterns: [{ pathname: "/assets/**" }],
  },
});
```

| Option                | Behavior                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `provider`            | `auto` uses Sharp on Node, Vercel, and Netlify, and Cloudflare Images on Cloudflare. Use `none` to disable optimization. |
| `path`                | Public optimizer endpoint used by `Image` and the server runtime.                                                        |
| `deviceSizes`         | Responsive viewport widths accepted by the endpoint.                                                                     |
| `imageSizes`          | Smaller fixed image widths accepted by the endpoint.                                                                     |
| `qualities`           | Quality allowlist. `Image` selects the nearest configured value.                                                         |
| `formats`             | Preferred modern output formats, negotiated through the request `Accept` header and its quality values.                  |
| `minimumCacheTTL`     | Browser and in-process transformed-image cache lifetime in seconds.                                                      |
| `maximumResponseBody` | Maximum source and transformed body size. Accepts bytes or values such as `"10mb"`.                                      |
| `maximumRedirects`    | Maximum remote redirects; every destination is checked again.                                                            |
| `localPatterns`       | Allowed same-origin paths. The default is `/**`.                                                                         |
| `remotePatterns`      | Allowed remote protocols, hostnames, ports, paths, and queries.                                                          |

Pass a `loader` prop when an application already uses an image CDN. The loader receives `src`, `width`, and the configured `quality` and must return the final URL.

## Security model

The optimizer accepts only configured widths and qualities. It does not forward browser cookies or authorization headers, limits response bodies, checks file signatures instead of trusting `Content-Type`, revalidates redirect destinations, and blocks loopback, link-local, and private network targets.
Formats explicitly rejected with `q=0` are never emitted. Farm uses the configured format order to
break equal-quality ties and keeps the source format when the client only sends wildcard ranges.

SVG optimization and private-network sources are disabled by default. `dangerouslyAllowSVG` adds a restrictive content security policy but should still be enabled only for trusted files. `dangerouslyAllowLocalIP` is intended for controlled private deployments and weakens SSRF protection.

## Deployment providers

- Node, Vercel, and Netlify use Sharp. Farm packages the installed native runtime with production output.
- Cloudflare presets use the platform image transform API and do not include Sharp.
- Development uses Sharp so local behavior is deterministic across deployment targets.
- `provider: "none"` emits original image URLs and does not mount the optimizer endpoint.

The optimizer forwards request cancellation to source fetching and returns sanitized errors. Unexpected details stay in server logs.
