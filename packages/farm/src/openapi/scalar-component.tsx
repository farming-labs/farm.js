import React from 'react';

interface ScalarAPIDocumentationProps {
  spec: any;
  config?: {
    theme?: 'default' | 'purple' | 'blue' | 'green' | 'red' | 'yellow';
    layout?: 'modern' | 'classic';
    showSidebar?: boolean;
    hideDownloadButton?: boolean;
    hideTryItPanel?: boolean;
  };
}

export function ScalarAPIDocumentation({ spec, config = {} }: ScalarAPIDocumentationProps) {
  const [isLoaded, setIsLoaded] = React.useState(false);

  React.useEffect(() => {
    // Dynamically import Scalar components
    const loadScalar = async () => {
      try {
        // Load Scalar CSS
        const cssLink = document.createElement('link');
        cssLink.rel = 'stylesheet';
        cssLink.href = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest/dist/style.css';
        document.head.appendChild(cssLink);

        // Load Scalar JS
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest/dist/browser/standalone.js';
        script.onload = () => setIsLoaded(true);
        document.head.appendChild(script);
      } catch (error) {
        console.error('Failed to load Scalar:', error);
      }
    };

    loadScalar();
  }, []);

  React.useEffect(() => {
    if (isLoaded && window.ScalarApiReference) {
      // Initialize Scalar
      const container = document.getElementById('scalar-api-reference');
      if (container) {
        window.ScalarApiReference({
          spec,
          theme: config.theme || 'default',
          layout: config.layout || 'modern',
          showSidebar: config.showSidebar !== false,
          hideDownloadButton: config.hideDownloadButton || false,
          hideTryItPanel: config.hideTryItPanel || false,
        });
      }
    }
  }, [isLoaded, spec, config]);

  return (
    <div className="scalar-container">
      <div id="scalar-api-reference" style={{ height: '100vh', width: '100%' }} />
    </div>
  );
}

// Extend window type for Scalar
declare global {
  interface Window {
    ScalarApiReference: (config: any) => void;
  }
}


