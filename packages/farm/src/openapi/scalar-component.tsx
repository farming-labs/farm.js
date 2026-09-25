import React from "react";
import { SCALAR_API_REFERENCE_SCRIPT, SCALAR_API_REFERENCE_STYLES } from "./scalar-assets";

interface ScalarAPIDocumentationProps {
  spec: any;
  config?: {
    theme?: "default" | "purple" | "blue" | "green" | "red" | "yellow";
    layout?: "modern" | "classic";
    showSidebar?: boolean;
    hideDownloadButton?: boolean;
    hideTryItPanel?: boolean;
  };
}

export function ScalarAPIDocumentation({ spec, config = {} }: ScalarAPIDocumentationProps) {
  const [isLoaded, setIsLoaded] = React.useState(false);
  const scalar = React.useRef<{ destroy(): void } | null>(null);

  React.useEffect(() => {
    const cssLink = document.createElement("link");
    cssLink.rel = "stylesheet";
    cssLink.href = SCALAR_API_REFERENCE_STYLES.url;
    cssLink.integrity = SCALAR_API_REFERENCE_STYLES.integrity;
    cssLink.crossOrigin = "anonymous";
    document.head.appendChild(cssLink);

    const script = document.createElement("script");
    script.src = SCALAR_API_REFERENCE_SCRIPT.url;
    script.integrity = SCALAR_API_REFERENCE_SCRIPT.integrity;
    script.crossOrigin = "anonymous";
    script.onload = () => setIsLoaded(true);
    script.onerror = () => console.error("Failed to load Scalar API Reference");
    document.head.appendChild(script);

    return () => {
      scalar.current?.destroy();
      scalar.current = null;
      script.remove();
      cssLink.remove();
    };
  }, []);

  React.useEffect(() => {
    if (isLoaded && window.Scalar) {
      // Initialize Scalar
      const container = document.getElementById("scalar-api-reference");
      if (container) {
        scalar.current?.destroy();
        scalar.current = window.Scalar.createApiReference(container, {
          content: spec,
          theme: config.theme || "default",
          layout: config.layout || "modern",
          showSidebar: config.showSidebar !== false,
          hideDownloadButton: config.hideDownloadButton || false,
          hideTryItPanel: config.hideTryItPanel || false,
        });
      }
    }

    return () => {
      scalar.current?.destroy();
      scalar.current = null;
    };
  }, [isLoaded, spec, config]);

  return (
    <div className="scalar-container">
      <div id="scalar-api-reference" style={{ height: "100vh", width: "100%" }} />
    </div>
  );
}

// Extend window type for Scalar
declare global {
  interface Window {
    Scalar?: {
      createApiReference(element: Element, config: Record<string, unknown>): { destroy(): void };
    };
  }
}
