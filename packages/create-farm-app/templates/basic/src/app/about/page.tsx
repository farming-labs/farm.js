import React from 'react'
import type { PageProps } from 'farm'
import { Link } from 'farm/client'

export default function AboutPage({ params, searchParams }: PageProps) {
  return (
    <div style={{ 
      fontFamily: 'system-ui, sans-serif',
      maxWidth: '800px',
      margin: '0 auto',
      padding: '2rem'
    }}>
      <h1 style={{ 
        fontSize: '2.5rem',
        marginBottom: '1rem',
        color: '#333'
      }}>
        About Farm.js
      </h1>
      
      <p style={{ 
        fontSize: '1.125rem',
        lineHeight: '1.6',
        color: '#666',
        marginBottom: '2rem'
      }}>
        Farm.js is a modern React meta-framework that combines the best of Vite's 
        lightning-fast development experience with Next.js-like semantics and 
        React Server Components support.
      </p>

      <div style={{ 
        padding: '1.5rem',
        backgroundColor: '#f0f7ff',
        borderRadius: '0.5rem',
        marginBottom: '2rem'
      }}>
        <h2 style={{ marginBottom: '1rem', color: '#1e40af' }}>Why Farm.js?</h2>
        <p style={{ lineHeight: '1.6', margin: 0 }}>
          We built Farm.js to provide developers with a framework that's both 
          powerful and simple. No complex configuration, no waiting for builds, 
          just pure development joy with modern React features.
        </p>
      </div>

      <Link 
        href="/"
        style={{
          display: 'inline-block',
          padding: '0.75rem 1.5rem',
          backgroundColor: '#667eea',
          color: 'white',
          textDecoration: 'none',
          borderRadius: '0.5rem',
          fontWeight: '500'
        }}
      >
        ← Back to Home
      </Link>
    </div>
  )
}

