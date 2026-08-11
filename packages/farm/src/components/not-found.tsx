import React from "react";
import { DEFAULT_NOT_FOUND_STYLES } from "./not-found-styles";

export { DEFAULT_NOT_FOUND_STYLES } from "./not-found-styles";

export interface NotFoundPageProps {
  /** The path that was not found */
  pathname?: string;
}

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
            GO HOME
          </a>
        </div>
      </main>
    </>
  );
}

export default DefaultNotFoundPage;
