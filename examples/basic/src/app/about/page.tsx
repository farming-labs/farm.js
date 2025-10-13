import React from 'react'
import type { PageProps } from 'farm'

export default function AboutPage({ params, searchParams }: PageProps) {
  return (
    <div>
      <h1>About</h1>
      
      <p>
        This basic example showcases the fundamental features of Farm.js without 
        any complex dependencies or configurations.
      </p>

      <h2>What's Included</h2>
      <ul>
        <li><strong>File-based Routing:</strong> Pages are created by adding files to the app directory</li>
        <li><strong>Layouts:</strong> Shared UI components across pages</li>
        <li><strong>TypeScript:</strong> Full type safety out of the box</li>
        <li><strong>React Server Components:</strong> Server-side rendering capabilities</li>
      </ul>

      <h2>Project Structure</h2>
      <pre style={{
        background: '#f8f9fa',
        padding: '1rem',
        borderRadius: '4px',
        overflow: 'auto'
      }}>
{`src/
  app/
    layout.tsx      # Root layout
    page.tsx        # Home page (/)
    about/
      page.tsx      # About page (/about)
    contact/
      page.tsx      # Contact page (/contact)`}
      </pre>

      <p>
        <a href="/">← Back to Home</a>
      </p>
    </div>
  )
}

