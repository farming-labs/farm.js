import React from "react";
import { ScalarAPIDocumentation } from "./scalar-component";

interface DocsRouteProps {
  spec: any;
  config?: any;
}

export function DocsRoute({ spec, config }: DocsRouteProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:," />
        <title>{config?.title || "API Documentation"}</title>
        <style>{`
          body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
          }
          .scalar-container {
            height: 100vh;
            width: 100%;
          }
        `}</style>
      </head>
      <body>
        <ScalarAPIDocumentation spec={spec} config={config} />
      </body>
    </html>
  );
}
