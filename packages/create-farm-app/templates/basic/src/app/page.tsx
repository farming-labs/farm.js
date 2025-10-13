import React from 'react'
import type { PageProps } from 'farm'
import { Link } from 'farm/client'

export default function HomePage({ params, searchParams }: PageProps) {
  return (
    <div style={{ 
      fontFamily: 'system-ui, sans-serif',
      maxWidth: '800px',
      margin: '0 auto',
      padding: '2rem',
      textAlign: 'center'
    }}>
      <h1 style={{ 
        fontSize: '3rem',
        marginBottom: '1rem',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent'
      }}>
        🚜 Welcome to Farm.js
      </h1>
      
      <p style={{ 
        fontSize: '1.25rem',
        color: '#666',
        marginBottom: '2rem'
      }}>
        A modern React meta-framework built on Vite with Next.js-like semantics
      </p>

      <div style={{ 
        display: 'flex',
        gap: '1rem',
        justifyContent: 'center',
        flexWrap: 'wrap'
      }}>
        <Link 
          href="/about"
          style={{
            padding: '0.75rem 1.5rem',
            backgroundColor: '#667eea',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '0.5rem',
            fontWeight: '500'
          }}
        >
          About Page
        </Link>
        
        <a 
          href="https://farm.js.dev"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            padding: '0.75rem 1.5rem',
            border: '2px solid #667eea',
            color: '#667eea',
            textDecoration: 'none',
            borderRadius: '0.5rem',
            fontWeight: '500'
          }}
        >
          Documentation
        </a>
      </div>

      <div style={{ 
        marginTop: '3rem',
        padding: '2rem',
        backgroundColor: '#f8f9fa',
        borderRadius: '0.5rem',
        textAlign: 'left'
      }}>
        <h2 style={{ marginBottom: '1rem' }}>Features</h2>
        <ul style={{ lineHeight: '1.6' }}>
          <li>🚀 Blazing fast development with Vite</li>
          <li>⚛️ React Server Components support</li>
          <li>🎯 Next.js-like file-based routing</li>
          <li>🔄 Server Actions for seamless data mutations</li>
          <li>📦 Zero configuration setup</li>
          <li>🎨 AI-friendly code structure</li>
        </ul>
      </div>
    </div>
  )
}

