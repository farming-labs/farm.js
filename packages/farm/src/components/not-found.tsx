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
  --farm-not-found-surface: #ffffff;
  --farm-not-found-fg: #171717;
  --farm-not-found-muted: #737373;
  --farm-not-found-subtle: #a3a3a3;
  --farm-not-found-border: rgba(0, 0, 0, 0.12);
  --farm-not-found-border-strong: rgba(0, 0, 0, 0.2);
  --farm-not-found-hover: #f2f2f2;
  --farm-not-found-button-fg: #ffffff;
  --farm-not-found-shadow: 0 20px 60px rgba(0, 0, 0, 0.06);
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

.farm-default-not-found__shell {
  width: min(100%, 620px);
}

.farm-default-not-found__panel {
  overflow: hidden;
  border: 1px solid var(--farm-not-found-border);
  border-radius: 16px;
  background: var(--farm-not-found-surface);
  box-shadow: var(--farm-not-found-shadow);
}

.farm-default-not-found__status {
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  border-bottom: 1px solid var(--farm-not-found-border);
  color: var(--farm-not-found-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.farm-default-not-found__status-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.7;
}

.farm-default-not-found__hero {
  display: grid;
  grid-template-columns: auto 1px minmax(0, 1fr);
  align-items: center;
  gap: 28px;
  padding: 38px 40px;
}

.farm-default-not-found__code {
  margin: 0;
  font-size: clamp(52px, 9vw, 76px);
  font-weight: 600;
  line-height: 0.9;
  letter-spacing: -0.07em;
}

.farm-default-not-found__divider {
  width: 1px;
  height: 72px;
  background: var(--farm-not-found-border-strong);
}

.farm-default-not-found__message {
  min-width: 0;
}

.farm-default-not-found__title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.025em;
}

.farm-default-not-found__description {
  max-width: 340px;
  margin: 8px 0 0;
  color: var(--farm-not-found-muted);
  font-size: 14px;
  line-height: 1.6;
}

.farm-default-not-found__route {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  min-height: 48px;
  padding: 10px 16px;
  border-top: 1px solid var(--farm-not-found-border);
  background: var(--farm-not-found-bg);
}

.farm-default-not-found__route-label {
  color: var(--farm-not-found-subtle);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.farm-default-not-found__route-path {
  min-width: 0;
  overflow: hidden;
  color: var(--farm-not-found-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.farm-default-not-found__actions {
  display: flex;
  padding: 16px;
  border-top: 1px solid var(--farm-not-found-border);
}

.farm-default-not-found__home {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 0 16px;
  border: 1px solid var(--farm-not-found-fg);
  border-radius: 8px;
  color: var(--farm-not-found-button-fg);
  background: var(--farm-not-found-fg);
  font-size: 13px;
  font-weight: 550;
  line-height: 1;
  text-decoration: none;
  transition: opacity 150ms ease-out, transform 100ms ease-out;
}

.farm-default-not-found__home:hover {
  opacity: 0.82;
}

.farm-default-not-found__home:active {
  transform: translateY(1px);
}

.farm-default-not-found__home:focus-visible,
.farm-default-not-found__brand:focus-visible {
  outline: 2px solid var(--farm-not-found-fg);
  outline-offset: 3px;
}

.farm-default-not-found__home-arrow {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  transition: transform 150ms ease-out;
}

.farm-default-not-found__home:hover .farm-default-not-found__home-arrow {
  transform: translateX(2px);
}

.farm-default-not-found__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 4px 0;
  color: var(--farm-not-found-subtle);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.farm-default-not-found__brand {
  color: var(--farm-not-found-muted);
  text-decoration: none;
  transition: color 150ms ease-out;
}

.farm-default-not-found__brand:hover {
  color: var(--farm-not-found-fg);
}

@media (prefers-color-scheme: dark) {
  .farm-default-not-found {
    --farm-not-found-bg: #0a0a0a;
    --farm-not-found-surface: #111111;
    --farm-not-found-fg: #ededed;
    --farm-not-found-muted: #a1a1a1;
    --farm-not-found-subtle: #666666;
    --farm-not-found-border: rgba(255, 255, 255, 0.12);
    --farm-not-found-border-strong: rgba(255, 255, 255, 0.22);
    --farm-not-found-hover: #191919;
    --farm-not-found-button-fg: #0a0a0a;
    --farm-not-found-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
    color-scheme: dark;
  }
}

.dark .farm-default-not-found,
[data-theme="dark"] .farm-default-not-found,
[data-color-scheme="dark"] .farm-default-not-found {
  --farm-not-found-bg: #0a0a0a;
  --farm-not-found-surface: #111111;
  --farm-not-found-fg: #ededed;
  --farm-not-found-muted: #a1a1a1;
  --farm-not-found-subtle: #666666;
  --farm-not-found-border: rgba(255, 255, 255, 0.12);
  --farm-not-found-border-strong: rgba(255, 255, 255, 0.22);
  --farm-not-found-hover: #191919;
  --farm-not-found-button-fg: #0a0a0a;
  --farm-not-found-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
  color-scheme: dark;
}

.light .farm-default-not-found,
[data-theme="light"] .farm-default-not-found,
[data-color-scheme="light"] .farm-default-not-found {
  --farm-not-found-bg: #fafafa;
  --farm-not-found-surface: #ffffff;
  --farm-not-found-fg: #171717;
  --farm-not-found-muted: #737373;
  --farm-not-found-subtle: #a3a3a3;
  --farm-not-found-border: rgba(0, 0, 0, 0.12);
  --farm-not-found-border-strong: rgba(0, 0, 0, 0.2);
  --farm-not-found-hover: #f2f2f2;
  --farm-not-found-button-fg: #ffffff;
  --farm-not-found-shadow: 0 20px 60px rgba(0, 0, 0, 0.06);
  color-scheme: light;
}

@media (max-width: 560px) {
  .farm-default-not-found {
    padding: 16px;
  }

  .farm-default-not-found__panel {
    border-radius: 12px;
  }

  .farm-default-not-found__hero {
    grid-template-columns: minmax(0, 1fr);
    gap: 22px;
    padding: 30px 24px;
  }

  .farm-default-not-found__code {
    font-size: 56px;
  }

  .farm-default-not-found__divider {
    width: 100%;
    height: 1px;
  }

  .farm-default-not-found__route {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }

  .farm-default-not-found__route-path {
    text-align: left;
  }

  .farm-default-not-found__home {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .farm-default-not-found__home,
  .farm-default-not-found__home-arrow,
  .farm-default-not-found__brand {
    transition: none;
  }
}
`;

/**
 * Default 404 Not Found page component.
 * Users can override this with their own component via the notFound config option.
 */
export function DefaultNotFoundPage({ pathname }: NotFoundPageProps) {
  return (
    <>
      <style>{DEFAULT_NOT_FOUND_STYLES}</style>
      <main className="farm-default-not-found" aria-labelledby="farm-default-not-found-title">
        <div className="farm-default-not-found__shell">
          <section className="farm-default-not-found__panel">
            <div className="farm-default-not-found__status">
              <span aria-hidden="true" className="farm-default-not-found__status-dot" />
              <span>404 / Route not found</span>
            </div>

            <div className="farm-default-not-found__hero">
              <p aria-hidden="true" className="farm-default-not-found__code">
                404
              </p>
              <span aria-hidden="true" className="farm-default-not-found__divider" />
              <div className="farm-default-not-found__message">
                <h1 id="farm-default-not-found-title" className="farm-default-not-found__title">
                  Page not found
                </h1>
                <p className="farm-default-not-found__description">
                  The page you&apos;re looking for doesn&apos;t exist or may have moved.
                </p>
              </div>
            </div>

            {pathname ? (
              <div className="farm-default-not-found__route">
                <span className="farm-default-not-found__route-label">Requested route</span>
                <code className="farm-default-not-found__route-path" title={pathname}>
                  {pathname}
                </code>
              </div>
            ) : null}

            <div className="farm-default-not-found__actions">
              <a className="farm-default-not-found__home" href="/">
                <span>Return home</span>
                <span aria-hidden="true" className="farm-default-not-found__home-arrow">
                  →
                </span>
              </a>
            </div>
          </section>

          <footer className="farm-default-not-found__footer">
            <a className="farm-default-not-found__brand" href="https://farmjs.dev">
              Farm.js
            </a>
            <span>Route boundary</span>
          </footer>
        </div>
      </main>
    </>
  );
}

export default DefaultNotFoundPage;
