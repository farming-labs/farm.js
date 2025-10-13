import React from 'react'
import type { PageProps } from 'farm'

export default function HomePage({ params, searchParams }: PageProps) {
  return (
    <div>
      <h1>Welcome to Farm.js!</h1>
      
      <p>
        This is a basic example demonstrating the core features of Farm.js, 
        a modern React meta-framework built on Vite.
      </p>

      <h2>Features Demonstrated</h2>
      <ul>
        <li>✅ File-based routing</li>
        <li>✅ React Server Components</li>
        <li>✅ TypeScript support</li>
        <li>✅ Zero configuration setup</li>
        <li>✅ Vite-powered development</li>
      </ul>

      <h2>Navigation</h2>
      <p>Try navigating to different pages:</p>
      <ul>
        <li><a href="/about">About Page</a></li>
        <li><a href="/contact">Contact Page</a></li>
      </ul>

      <div style={{
        marginTop: '2rem',
        padding: '1rem',
        background: '#f8f9fa',
        borderRadius: '4px',
        border: '1px solid #dee2e6'
      }}>
        <h3>Request Information</h3>
        <pre style={{ margin: 0, fontSize: '0.875rem' }}>
          {JSON.stringify({ params, searchParams }, null, 2)}
        </pre>
      </div>
    </div>
  )
}

