/**
 * The page behind a Farm X Player Card (`FARM_VIDEO_PLAYER_PATH`). X frames it to
 * play a page's `openGraph.videos` file, since X ignores og:video.
 *
 * It is a static file, so a configured `X-Frame-Options` or CSP never reaches it in
 * production. That is why it plays only same-origin URLs: any page could frame it.
 * X's Player Card policy allows no interactivity beyond the player and no autoplay
 * past 10 seconds, so a longer video waits for the play button.
 */
export const FARM_VIDEO_PLAYER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <title>Video</title>
    <style>
      html, body { height: 100%; margin: 0; background: #000; }
      video { display: block; width: 100%; height: 100%; object-fit: contain; }
    </style>
  </head>
  <body>
    <video controls muted playsinline preload="metadata"></video>
    <script>
      (() => {
        const params = new URLSearchParams(location.search);
        const sameOrigin = (value) => {
          if (!value) return null;
          try {
            const url = new URL(value, location.href);
            return url.origin === location.origin ? url.href : null;
          } catch {
            return null;
          }
        };
        const src = sameOrigin(params.get("src"));
        if (!src) return;
        const video = document.querySelector("video");
        const poster = sameOrigin(params.get("poster"));
        if (poster) video.poster = poster;
        video.addEventListener(
          "loadedmetadata",
          () => {
            if (video.duration > 10) return;
            video.loop = true;
            // A browser may refuse autoplay; the controls still play it.
            video.play().catch(() => {});
          },
          { once: true },
        );
        video.src = src;
      })();
    </script>
  </body>
</html>
`;
