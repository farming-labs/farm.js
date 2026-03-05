import React from "react";

export interface NotFoundPageProps {
  /** The path that was not found */
  pathname?: string;
}

/**
 * Default 404 Not Found page component
 * Users can override this with their own component via the notFound config option
 */
export function DefaultNotFoundPage({ pathname }: NotFoundPageProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        backgroundColor: "#f9fafb",
        padding: "20px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "12px",
          padding: "48px",
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
          maxWidth: "500px",
          width: "100%",
        }}
      >
        <h1
          style={{
            fontSize: "96px",
            fontWeight: "bold",
            color: "#22c55e",
            margin: "0 0 16px 0",
            lineHeight: "1",
          }}
        >
          404
        </h1>
        <h2
          style={{
            fontSize: "24px",
            fontWeight: "600",
            color: "#1f2937",
            margin: "0 0 16px 0",
          }}
        >
          Page Not Found
        </h2>
        <p
          style={{
            fontSize: "16px",
            color: "#6b7280",
            margin: "0 0 24px 0",
          }}
        >
          {pathname ? (
            <>
              The page{" "}
              <code style={{ backgroundColor: "#f3f4f6", padding: "2px 6px", borderRadius: "4px" }}>
                {pathname}
              </code>{" "}
              doesn't exist.
            </>
          ) : (
            "The page you're looking for doesn't exist or has been moved."
          )}
        </p>
        <a
          href="/"
          style={{
            display: "inline-block",
            backgroundColor: "#22c55e",
            color: "white",
            padding: "12px 24px",
            borderRadius: "8px",
            textDecoration: "none",
            fontWeight: "500",
            transition: "background-color 0.2s",
          }}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#16a34a")}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#22c55e")}
        >
          Go Home
        </a>
      </div>
      <p
        style={{
          marginTop: "24px",
          fontSize: "14px",
          color: "#9ca3af",
        }}
      >
        Powered by{" "}
        <a href="https://farmjs.dev" style={{ color: "#22c55e", textDecoration: "none" }}>
          Farm.js
        </a>
      </p>
    </div>
  );
}

export default DefaultNotFoundPage;
