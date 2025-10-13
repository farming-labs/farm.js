import React from 'react'
import type { PageProps } from 'farm'

export default function ContactPage({ params, searchParams }: PageProps) {
  return (
    <div>
      <h1>Contact Us</h1>
      
      <p>
        Get in touch with the Farm.js team or community.
      </p>

      <div style={{ display: 'grid', gap: '1.5rem', marginTop: '2rem' }}>
        <ContactCard
          title="GitHub"
          description="Report issues, contribute code, or browse the source"
          link="https://github.com/farm-js/farm.js"
        />
        
        <ContactCard
          title="Documentation"
          description="Learn more about Farm.js features and API"
          link="https://farm.js.dev"
        />
        
        <ContactCard
          title="Community"
          description="Join discussions and get help from the community"
          link="#"
        />
      </div>

      <div style={{
        marginTop: '2rem',
        padding: '1rem',
        background: '#e3f2fd',
        borderRadius: '4px',
        border: '1px solid #90caf9'
      }}>
        <h3>💡 Pro Tip</h3>
        <p style={{ margin: 0 }}>
          This page demonstrates how easy it is to create new routes in Farm.js. 
          Just add a <code>page.tsx</code> file in a new directory!
        </p>
      </div>

      <div style={{
        marginTop: '2rem',
        padding: '1.5rem',
        background: '#f8f9fa',
        borderRadius: '4px',
        border: '1px solid #dee2e6'
      }}>
        <h3>📊 PageProps for /contact</h3>
        <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
          This is a <strong>static route</strong> (no dynamic segments like [id]), so:
        </p>
        <pre style={{ 
          background: 'white',
          padding: '1rem', 
          borderRadius: '4px',
          margin: 0,
          fontSize: '0.875rem',
          overflow: 'auto'
        }}>
          {JSON.stringify({ params, searchParams }, null, 2)}
        </pre>
        <div style={{
          marginTop: '1rem',
          padding: '0.75rem',
          background: '#fff3cd',
          borderRadius: '4px',
          fontSize: '0.875rem'
        }}>
          <strong>💡 Note:</strong> <code>params</code> is empty {} because this route has no 
          dynamic segments like [id]. Try adding query params: 
          <a href="/contact?subject=bug&priority=high" style={{ marginLeft: '0.5rem' }}>
            /contact?subject=bug&priority=high
          </a>
        </div>
      </div>

      <p style={{ marginTop: '2rem' }}>
        <a href="/">← Back to Home</a>
      </p>
    </div>
  )
}

function ContactCard({ title, description, link }: {
  title: string
  description: string
  link: string
}) {
  return (
    <div style={{
      padding: '1.5rem',
      border: '1px solid #dee2e6',
      borderRadius: '4px',
      background: 'white'
    }}>
      <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>{title}</h3>
      <p style={{ marginBottom: '1rem', color: '#6c757d' }}>{description}</p>
      <a 
        href={link}
        style={{
          color: '#007bff',
          textDecoration: 'none',
          fontWeight: '500'
        }}
      >
        Learn more →
      </a>
    </div>
  )
}

