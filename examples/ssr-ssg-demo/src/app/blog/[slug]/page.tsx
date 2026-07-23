/**
 * Blog Post Page - Dynamic SSG with getStaticPaths
 * 
 * This is a dynamic route ([slug]) with SSG.
 * Use getStaticPaths to define which paths to pre-render.
 * 
 * Use Dynamic SSG when:
 * - You have dynamic routes (like blog posts, products)
 * - Content is static but varies by parameter
 * - You know all possible paths at build time
 */

import type { PageProps } from "@farmjs/core";

export const ssg = true;

// Define which paths to pre-render at build time
export async function getStaticPaths() {
  // In a real app, you'd fetch this from an API or CMS
  // const posts = await fetch('https://api.example.com/posts').then(r => r.json());
  
  const posts = [
    { slug: "hello-world" },
    { slug: "getting-started" },
    { slug: "advanced-usage" },
  ];

  return posts;
}

// Simulated blog post data
const blogPosts: Record<string, { title: string; content: string; date: string; author: string }> = {
  "hello-world": {
    title: "Hello World - Getting Started with Farm.js",
    content: `
      Welcome to Farm.js! This is your first step into a powerful React meta-framework.
      
      Farm.js provides:
      - File-based routing
      - Server-Side Rendering (SSR) by default
      - Static Site Generation (SSG) opt-in
      - API routes
      - Middleware support
      - And much more!
    `,
    date: "2024-01-15",
    author: "Farm.js Team",
  },
  "getting-started": {
    title: "Getting Started with Farm.js",
    content: `
      To get started with Farm.js, follow these simple steps:
      
      1. Create a new project
      2. Configure your routes
      3. Start building!
      
      Farm.js uses file-based routing, so creating pages is as simple as adding files.
    `,
    date: "2024-01-16",
    author: "Alice Developer",
  },
  "advanced-usage": {
    title: "Advanced Farm.js Patterns",
    content: `
      Once you're comfortable with the basics, explore advanced patterns:
      
      - Custom middleware
      - API route handlers
      - SSG with ISR
      - Dynamic imports
      - Server components
    `,
    date: "2024-01-17",
    author: "Bob Engineer",
  },
};

export default function BlogPostPage({ params }: PageProps) {
  const slug = params.slug;
  const post = blogPosts[slug] || {
    title: "Post Not Found",
    content: "This post does not exist.",
    date: "Unknown",
    author: "Unknown",
  };

  const buildTime = new Date().toISOString();

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
            SSG
          </span>
          <span className="px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full text-sm font-medium">
            Dynamic Route
          </span>
        </div>

        <nav className="text-sm text-gray-500 mb-4">
          <a href="/blog/hello-world" className="hover:text-green-600">Blog</a>
          <span className="mx-2">/</span>
          <span>{slug}</span>
        </nav>

        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          {post.title}
        </h1>

        <div className="flex items-center gap-4 text-sm text-gray-500 mb-6">
          <span>By {post.author}</span>
          <span>•</span>
          <span>{post.date}</span>
        </div>

        <div className="prose max-w-none">
          <p className="text-gray-700 whitespace-pre-line">
            {post.content}
          </p>
        </div>

        <div className="mt-6 bg-gray-100 rounded-lg p-4">
          <p className="text-sm text-gray-500">
            Pre-rendered at build time: {buildTime}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Other Posts</h2>
        <div className="space-y-2">
          {Object.entries(blogPosts).map(([postSlug, postData]) => (
            <a
              key={postSlug}
              href={`/blog/${postSlug}`}
              className={`block p-3 rounded-lg hover:bg-gray-50 ${postSlug === slug ? 'bg-green-50' : ''}`}
            >
              <span className="font-medium text-gray-900">{postData.title}</span>
              <span className="text-gray-500 text-sm ml-2">{postData.date}</span>
            </a>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Code Example</h2>
        <pre className="bg-gray-100 rounded p-4 text-sm overflow-x-auto">
{`// src/app/blog/[slug]/page.tsx

export const ssg = true;

// Define all paths to pre-render
export async function getStaticPaths() {
  const posts = await fetch('https://api.example.com/posts')
    .then(r => r.json());
  
  return posts.map(post => ({ slug: post.slug }));
}

export default async function BlogPost({ params }) {
  const post = await fetch(\`https://api.example.com/posts/\${params.slug}\`)
    .then(r => r.json());
  
  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.content}</p>
    </article>
  );
}`}
        </pre>
      </div>
    </div>
  );
}
