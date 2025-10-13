import React from 'react'
import type { PageProps } from 'farm'

export default function UserPage({ params, searchParams }: PageProps) {
  const { id } = params
  const { tab } = searchParams
  
  return (
    <div>
      <h1>User Profile: {id}</h1>
      
      <p style={{ color: '#666', marginBottom: '2rem' }}>
        This is a dynamic route example showing how params and searchParams work.
      </p>

      <div style={{
        display: 'grid',
        gap: '1.5rem',
        marginBottom: '2rem'
      }}>
        <InfoCard 
          title="Dynamic Route Params" 
          description="These come from the URL path segments like [id]"
          data={params}
          example="/users/123 → { id: '123' }"
        />
        
        <InfoCard 
          title="Search/Query Params" 
          description="These come from the query string (?key=value)"
          data={searchParams}
          example="/users/123?tab=profile&sort=asc → { tab: 'profile', sort: 'asc' }"
        />
      </div>

      <div style={{
        padding: '1.5rem',
        background: '#f0f9ff',
        borderRadius: '0.5rem',
        border: '1px solid #bae6fd'
      }}>
        <h3 style={{ marginTop: 0 }}>💡 How to Use PageProps</h3>
        <div style={{ fontSize: '0.9rem', lineHeight: '1.6' }}>
          <p><strong>1. Import the type:</strong></p>
          <pre style={{ background: '#fff', padding: '0.5rem', borderRadius: '4px', overflow: 'auto' }}>
{`import type { PageProps } from 'farm'`}
          </pre>

          <p><strong>2. Use in your component:</strong></p>
          <pre style={{ background: '#fff', padding: '0.5rem', borderRadius: '4px', overflow: 'auto' }}>
{`export default function MyPage({ params, searchParams }: PageProps) {
  const { id } = params          // URL path params
  const { tab } = searchParams   // Query string params
  
  return <div>User {id}, Tab: {tab}</div>
}`}
          </pre>

          <p><strong>3. Current values:</strong></p>
          <ul style={{ marginBottom: 0 }}>
            <li><code>params.id</code> = "{id}"</li>
            <li><code>searchParams.tab</code> = "{tab || 'not set'}"</li>
          </ul>
        </div>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h3>Try These URLs:</h3>
        <ul style={{ lineHeight: '2' }}>
          <li><a href="/users/123">/users/123</a></li>
          <li><a href="/users/456?tab=settings">/users/456?tab=settings</a></li>
          <li><a href="/users/john-doe?tab=profile&sort=desc">/users/john-doe?tab=profile&sort=desc</a></li>
        </ul>
      </div>

      <p style={{ marginTop: '2rem' }}>
        <a href="/">← Back to Home</a>
      </p>
    </div>
  )
}

function InfoCard({ title, description, data, example }: {
  title: string
  description: string
  data: Record<string, any>
  example: string
}) {
  return (
    <div style={{
      padding: '1.5rem',
      background: 'white',
      borderRadius: '0.5rem',
      border: '1px solid #e2e8f0',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
    }}>
      <h2 style={{ marginTop: 0, color: '#1e293b' }}>{title}</h2>
      <p style={{ color: '#64748b', marginBottom: '1rem' }}>{description}</p>
      
      <div style={{
        background: '#f8fafc',
        padding: '1rem',
        borderRadius: '4px',
        marginBottom: '1rem'
      }}>
        <strong>Current values:</strong>
        <pre style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem', color: '#1e293b' }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
      
      <div style={{
        padding: '0.75rem',
        background: '#fef3c7',
        borderRadius: '4px',
        fontSize: '0.875rem'
      }}>
        <strong>Example:</strong> <code>{example}</code>
      </div>
    </div>
  )
}
