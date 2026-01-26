import React from "react";
import type { PageProps } from "@farmjs/core";

export default function BlogPostPage({ params, searchParams }: PageProps) {
  const { slug } = params;

  // Simulate blog post data
  const posts: Record<string, any> = {
    "hello-world": {
      title: "Hello World from Farm.js",
      content: `
        <p>Welcome to Farm.js, a modern React meta-framework that combines the best of Vite's lightning-fast development experience with Next.js-like semantics!</p>
        
        <h2>What makes Farm.js special?</h2>
        <ul>
          <li><strong>Vite-powered:</strong> Instant server start and blazing-fast HMR</li>
          <li><strong>React Server Components:</strong> Full RSC support with streaming SSR</li>
          <li><strong>Next.js-like API:</strong> Familiar file-based routing and app directory structure</li>
          <li><strong>Zero configuration:</strong> Works out of the box with sensible defaults</li>
        </ul>
        
        <p>We're excited to see what you'll build with Farm.js!</p>
      `,
      date: "2024-01-15",
      author: "Farm.js Team",
      readTime: "3 min read",
    },
    "why-farm-js": {
      title: "Why We Built Farm.js",
      content: `
        <p>The React ecosystem is rich with frameworks, so why did we decide to build another one?</p>
        
        <h2>The Problem</h2>
        <p>While working with existing frameworks, we encountered several pain points:</p>
        <ul>
          <li>Complex configuration and setup processes</li>
          <li>Slow development servers and build times</li>
          <li>Difficulty integrating modern React features like Server Components</li>
          <li>Inconsistent developer experience across different tools</li>
        </ul>
        
        <h2>Our Solution</h2>
        <p>Farm.js addresses these issues by:</p>
        <ul>
          <li>Leveraging Vite's incredible performance</li>
          <li>Providing Next.js-like semantics that developers already know</li>
          <li>Supporting modern React features out of the box</li>
          <li>Maintaining a clean, AI-friendly codebase structure</li>
        </ul>
      `,
      date: "2024-01-10",
      author: "Farm.js Team",
      readTime: "5 min read",
    },
    "getting-started": {
      title: "Getting Started with Farm.js",
      content: `
        <p>Ready to build your first Farm.js application? Let's get started!</p>
        
        <h2>Installation</h2>
        <pre><code>pnpm create farm-app my-app
cd my-app
pnpm install
pnpm dev</code></pre>
        
        <h2>Project Structure</h2>
        <p>Farm.js uses a familiar app directory structure:</p>
        <pre><code>src/
  app/
    layout.tsx     # Root layout
    page.tsx       # Home page
    about/
      page.tsx     # About page
    users/
      page.tsx     # Users list
      [id]/
        page.tsx   # Dynamic user page</code></pre>
        
        <h2>What's Next?</h2>
        <p>Explore the documentation to learn about advanced features like Server Actions, metadata handling, and more!</p>
      `,
      date: "2024-01-05",
      author: "Farm.js Team",
      readTime: "7 min read",
    },
  };

  const post = posts[slug] || {
    title: "Post Not Found",
    content: "<p>The requested blog post could not be found.</p>",
    date: "Unknown",
    author: "Unknown",
    readTime: "0 min read",
  };

  return (
    <div>
      <div style={{ marginBottom: "2rem" }}>
        <a
          href="/blog"
          style={{
            color: "#3b82f6",
            textDecoration: "none",
            fontSize: "0.875rem",
            fontWeight: "500",
          }}
        >
          ← Back to Blog
        </a>
      </div>

      <article
        style={{
          background: "white",
          padding: "3rem",
          borderRadius: "0.5rem",
          border: "1px solid #e2e8f0",
        }}
      >
        <header style={{ marginBottom: "2rem" }}>
          <h1
            style={{
              color: "#1e293b",
              marginBottom: "1rem",
              fontSize: "2.25rem",
              lineHeight: "1.2",
            }}
          >
            {post.title}
          </h1>

          <div
            style={{
              display: "flex",
              gap: "1rem",
              fontSize: "0.875rem",
              color: "#64748b",
              marginBottom: "1rem",
            }}
          >
            <span>By {post.author}</span>
            <span>•</span>
            <time>{post.date}</time>
            <span>•</span>
            <span>{post.readTime}</span>
          </div>
        </header>

        <div
          style={{
            lineHeight: "1.7",
            color: "#374151",
          }}
          dangerouslySetInnerHTML={{ __html: post.content }}
        />
      </article>

      <div
        style={{
          marginTop: "2rem",
          padding: "1.5rem",
          background: "#f8fafc",
          borderRadius: "0.5rem",
          border: "1px solid #e2e8f0",
        }}
      >
        <h3 style={{ marginBottom: "1rem" }}>Route Information</h3>
        <pre
          style={{
            background: "white",
            padding: "1rem",
            borderRadius: "0.375rem",
            overflow: "auto",
            margin: 0,
          }}
        >
          {JSON.stringify(
            {
              slug,
              params,
              searchParams,
              postExists: slug in posts,
            },
            null,
            2,
          )}
        </pre>
      </div>
    </div>
  );
}
