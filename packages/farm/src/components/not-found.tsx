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
  --farm-not-found-line: rgba(0, 0, 0, 0.16);
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
  width: min(100%, 280px);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.farm-default-not-found__code {
  margin: 0;
  color: var(--farm-not-found-fg);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: clamp(88px, 20vw, 140px);
  font-weight: 800;
  line-height: 0.75;
  letter-spacing: -0.1em;
  transform: translateX(-3px);
}

@supports (-webkit-text-stroke: 1px currentColor) {
  .farm-default-not-found__code {
    color: var(--farm-not-found-bg);
    -webkit-text-stroke: 2px var(--farm-not-found-fg);
    text-shadow: 5px 5px 0 var(--farm-not-found-fg);
  }
}

.farm-default-not-found__description {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 34px 0 30px;
  color: var(--farm-not-found-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  white-space: nowrap;
}

.farm-default-not-found__description::before,
.farm-default-not-found__description::after {
  content: "";
  height: 1px;
  flex: 1 1 auto;
  background: var(--farm-not-found-line);
}

.farm-default-not-found__home {
  min-width: 132px;
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
    --farm-not-found-line: rgba(255, 255, 255, 0.2);
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
  --farm-not-found-line: rgba(255, 255, 255, 0.2);
  --farm-not-found-button-fg: #0a0a0a;
  color-scheme: dark;
}

.light .farm-default-not-found,
[data-theme="light"] .farm-default-not-found,
[data-color-scheme="light"] .farm-default-not-found {
  --farm-not-found-bg: #fafafa;
  --farm-not-found-fg: #171717;
  --farm-not-found-muted: #737373;
  --farm-not-found-line: rgba(0, 0, 0, 0.16);
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
