import React from 'react'
import type { PageProps } from 'farm'

export default function UserPage({ params, searchParams }: PageProps) {
  const userId = params.id
  
  // Simulate user data lookup
  const userData = {
    id: userId,
    name: userId === '123' ? 'Test User' : `User ${userId}`,
    email: userId === '123' ? 'test@example.com' : `user${userId}@example.com`,
    joinDate: '2024-01-15',
    posts: parseInt(userId as string) || 0,
    followers: Math.floor(Math.random() * 1000)
  }

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <a
          href="/users"
          style={{
            color: '#3b82f6',
            textDecoration: 'none',
            fontSize: '0.875rem',
            fontWeight: '500'
          }}
        >
          ← Back to Users
        </a>
      </div>

      <h1 style={{ color: '#1e293b', marginBottom: '0.5rem' }}>
        {userData.name}
      </h1>
      
      <p style={{ color: '#64748b', marginBottom: '2rem' }}>
        User ID: {userId}
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '1.5rem',
        marginBottom: '2rem'
      }}>
        <StatCard title="Posts" value={userData.posts} />
        <StatCard title="Followers" value={userData.followers} />
        <StatCard title="Member Since" value="2024" />
      </div>

      <div style={{
        background: 'white',
        padding: '2rem',
        borderRadius: '0.5rem',
        border: '1px solid #e2e8f0'
      }}>
        <h2 style={{ marginBottom: '1rem' }}>Profile Information</h2>
        
        <div style={{ display: 'grid', gap: '1rem' }}>
          <InfoRow label="Name" value={userData.name} />
          <InfoRow label="Email" value={userData.email} />
          <InfoRow label="Join Date" value={userData.joinDate} />
          <InfoRow label="User ID" value={userId} />
        </div>
      </div>

      <div style={{
        marginTop: '2rem',
        padding: '1.5rem',
        background: '#f8fafc',
        borderRadius: '0.5rem',
        border: '1px solid #e2e8f0'
      }}>
        <h3 style={{ marginBottom: '1rem' }}>Route Parameters</h3>
        <pre style={{ 
          background: 'white',
          padding: '1rem',
          borderRadius: '0.375rem',
          overflow: 'auto',
          margin: 0
        }}>
          {JSON.stringify({ params, searchParams }, null, 2)}
        </pre>
      </div>
    </div>
  )
}

function StatCard({ title, value }: { title: string; value: string | number }) {
  return (
    <div style={{
      background: 'white',
      padding: '1.5rem',
      borderRadius: '0.5rem',
      border: '1px solid #e2e8f0',
      textAlign: 'center'
    }}>
      <div style={{ 
        fontSize: '2rem', 
        fontWeight: 'bold', 
        color: '#1e293b',
        marginBottom: '0.5rem'
      }}>
        {value}
      </div>
      <div style={{ color: '#64748b', fontSize: '0.875rem' }}>
        {title}
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontWeight: '500', color: '#374151' }}>{label}:</span>
      <span style={{ color: '#6b7280' }}>{value}</span>
    </div>
  )
}

