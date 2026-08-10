import React from "react";
import type { PageProps } from "@farm.js/core";

export default function AboutPage({ params, searchParams }: PageProps) {
  return (
    <div>
      <h1 style={{ color: "#1e293b", marginBottom: "1rem" }}>About Farm.js</h1>

      <div
        style={{
          background: "white",
          padding: "2rem",
          borderRadius: "0.5rem",
          border: "1px solid #e2e8f0",
        }}
      >
        <p style={{ lineHeight: "1.6", marginBottom: "1.5rem" }}>
          Farm.js is a full-stack framework that brings together the lightning-fast development
          experience of Vite and familiar, powerful app-directory semantics.
        </p>

        <h2 style={{ marginBottom: "1rem" }}>Key Features</h2>
        <ul style={{ lineHeight: "1.6", paddingLeft: "1.5rem" }}>
          <li>
            🚀 <strong>Vite-powered</strong> - Instant server start and lightning-fast HMR
          </li>
          <li>
            ⚛️ <strong>React Server Components</strong> - Full RSC support with streaming
          </li>
          <li>
            🎯 <strong>Next.js-like API</strong> - Familiar file-based routing and app directory
          </li>
          <li>
            🔄 <strong>Server Actions</strong> - Seamless server-client data mutations
          </li>
          <li>
            📦 <strong>Zero Config</strong> - Works out of the box with sensible defaults
          </li>
          <li>
            🎨 <strong>AI-Friendly</strong> - Clean, predictable structure for AI code generation
          </li>
        </ul>

        <div
          style={{
            marginTop: "2rem",
            padding: "1rem",
            background: "#f0f9ff",
            borderRadius: "0.375rem",
            border: "1px solid #bae6fd",
          }}
        >
          <p style={{ margin: 0, color: "#0c4a6e" }}>
            <strong>Note:</strong> This is a playground environment for testing Farm.js features.
            The framework is still in development and not ready for production use.
          </p>
        </div>
      </div>
    </div>
  );
}
