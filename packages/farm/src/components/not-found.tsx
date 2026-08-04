import React from "react";

export interface NotFoundPageProps {
  /** The path that was not found */
  pathname?: string;
}

export const DEFAULT_NOT_FOUND_STYLES = `
body {
  margin: 0;
}

.farm-default-not-found {
  --farm-not-found-bg: #fafafa;
  --farm-not-found-fg: #171717;
  --farm-not-found-muted: #737373;
  --farm-not-found-button-fg: #ffffff;
  min-height: 100vh;
  min-height: 100svh;
  display: grid;
  place-items: center;
  padding: 24px;
  color: var(--farm-not-found-fg);
  background: var(--farm-not-found-bg);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color-scheme: light;
}

.farm-default-not-found,
.farm-default-not-found * {
  box-sizing: border-box;
}

.farm-default-not-found__content {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.farm-default-not-found__code {
  margin: 0;
  font-size: clamp(72px, 18vw, 112px);
  font-weight: 600;
  line-height: 0.8;
  letter-spacing: -0.08em;
}

.farm-default-not-found__description {
  margin: 22px 0 30px;
  color: var(--farm-not-found-muted);
  font-size: 15px;
  line-height: 1.5;
}

.farm-default-not-found__home {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 20px;
  border: 1px solid var(--farm-not-found-fg);
  border-radius: 0;
  color: var(--farm-not-found-button-fg);
  background: var(--farm-not-found-fg);
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  text-decoration: none;
  transition: opacity 150ms ease-out, transform 100ms ease-out;
}

@media (hover: hover) and (pointer: fine) {
  .farm-default-not-found__home:hover {
    opacity: 0.78;
  }
}

.farm-default-not-found__home:active {
  transform: translateY(1px);
}

.farm-default-not-found__home:focus-visible {
  outline: 2px solid var(--farm-not-found-fg);
  outline-offset: 3px;
}

@media (prefers-color-scheme: dark) {
  .farm-default-not-found {
    --farm-not-found-bg: #0a0a0a;
    --farm-not-found-fg: #ededed;
    --farm-not-found-muted: #a1a1a1;
    --farm-not-found-button-fg: #0a0a0a;
    color-scheme: dark;
  }
}

.dark .farm-default-not-found,
[data-theme="dark"] .farm-default-not-found,
[data-color-scheme="dark"] .farm-default-not-found {
  --farm-not-found-bg: #0a0a0a;
  --farm-not-found-fg: #ededed;
  --farm-not-found-muted: #a1a1a1;
  --farm-not-found-button-fg: #0a0a0a;
  color-scheme: dark;
}

.light .farm-default-not-found,
[data-theme="light"] .farm-default-not-found,
[data-color-scheme="light"] .farm-default-not-found {
  --farm-not-found-bg: #fafafa;
  --farm-not-found-fg: #171717;
  --farm-not-found-muted: #737373;
  --farm-not-found-button-fg: #ffffff;
  color-scheme: light;
}

@media (prefers-reduced-motion: reduce) {
  .farm-default-not-found__home {
    transition: none;
  }

  .farm-default-not-found__home:active {
    transform: none;
  }
}
`;

/**
 * Default 404 Not Found page component.
 * Users can override this with their own component via the notFound config option.
 */
export function DefaultNotFoundPage(_props: NotFoundPageProps) {
  return (
    <>
      <style>{DEFAULT_NOT_FOUND_STYLES}</style>
      <main
        className="farm-default-not-found"
        aria-labelledby="farm-default-not-found-title"
        aria-describedby="farm-default-not-found-description"
      >
        <div className="farm-default-not-found__content">
          <h1 id="farm-default-not-found-title" className="farm-default-not-found__code">
            404
          </h1>
          <p
            id="farm-default-not-found-description"
            className="farm-default-not-found__description"
          >
            Not found
          </p>
          <a className="farm-default-not-found__home" href="/">
            Go home
          </a>
        </div>
      </main>
    </>
  );
}

export default DefaultNotFoundPage;
