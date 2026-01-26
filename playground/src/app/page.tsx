import React from "react";
import type { PageProps } from "@farmjs/core";

export default function HomePage({ params, searchParams }: PageProps) {
  return (
    <div>
      <h1
        style={{
          fontSize: "2.5rem",
          marginBottom: "1rem",
          color: "#1e293b",
        }}
      >
        🚜 Farm.js Playground
      </h1>

      <p
        style={{
          fontSize: "1.125rem",
          color: "#64748b",
          marginBottom: "2rem",
        }}
      >
        This is a testing environment for Farm.js features. Navigate around to test routing!
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "1.5rem",
          marginTop: "2rem",
        }}
      >
        <FeatureCard
          title="File-based Routing"
          description="Next.js-style routing with pages and layouts"
          icon="🗂️"
        />

        <FeatureCard
          title="React Server Components"
          description="Server-side rendering with streaming support"
          icon="⚛️"
        />

        <FeatureCard
          title="Vite Integration"
          description="Lightning-fast development with HMR"
          icon="⚡"
        />

        <FeatureCard
          title="TypeScript Support"
          description="Full TypeScript support out of the box"
          icon="📘"
        />
      </div>

      <div
        style={{
          marginTop: "3rem",
          padding: "1.5rem",
          background: "white",
          borderRadius: "0.5rem",
          border: "1px solid #e2e8f0",
        }}
      >
        <h2 style={{ marginBottom: "1rem" }}>Current Request Info</h2>
        <pre
          style={{
            background: "#f8fafc",
            padding: "1rem",
            borderRadius: "0.375rem",
            overflow: "auto",
          }}
        >
          {JSON.stringify({ params, searchParams }, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function FeatureCard({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <div
      style={{
        padding: "1.5rem",
        background: "white",
        borderRadius: "0.5rem",
        border: "1px solid #e2e8f0",
        boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.1)",
      }}
    >
      <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>{icon}</div>
      <h3 style={{ marginBottom: "0.5rem", color: "#1e293b" }}>{title}</h3>
      <p style={{ color: "#64748b", margin: 0 }}>{description}</p>
    </div>
  );
}
