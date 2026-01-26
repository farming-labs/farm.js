import React from 'react'
import type { PageProps } from '@farmjs/core'

export default function BlogPage({ params, searchParams }: PageProps) {
  const posts = [
    {
      slug: 'hello-world',
      title: 'Hello World from Farm.js',
      excerpt: 'Welcome to our new React meta-framework built on Vite!',
      date: '2024-01-15',
      author: 'Farm.js Team'
    },
    {
      slug: 'why-farm-js',
      title: 'Why We Built Farm.js',
      excerpt: 'The story behind creating a new React framework with Vite and Next.js semantics.',
      date: '2024-01-10',
      author: 'Farm.js Team'
    },
    {
      slug: 'getting-started',
      title: 'Getting Started with Farm.js',
      excerpt: 'A comprehensive guide to building your first Farm.js application.',
      date: '2024-01-05',
      author: 'Farm.js Team'
    }
  ]

  return (
    <div>
      <h1 style={{ color: '#1e293b', marginBottom: '1rem' }}>Blog</h1>
      
      <p style={{ color: '#64748b', marginBottom: '2rem' }}>
        Latest updates and insights from the Farm.js team.
      </p>

      <div style={{ display: 'grid', gap: '1.5rem' }}>
        {posts.map((post) => (
          <article
            key={post.slug}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '0.5rem',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)'
            }}
          >
            <h2 style={{ marginBottom: '0.5rem' }}>
              <a
                href={`/blog/${post.slug}`}
                style={{
                  color: '#1e293b',
                  textDecoration: 'none'
                }}
              >
                {post.title}
              </a>
            </h2>
            
            <div style={{
              display: 'flex',
              gap: '1rem',
              marginBottom: '1rem',
              fontSize: '0.875rem',
              color: '#64748b'
            }}>
              <span>By {post.author}</span>
              <span>•</span>
              <time>{post.date}</time>
            </div>
            
            <p style={{ 
              color: '#64748b', 
              lineHeight: '1.6',
              marginBottom: '1rem'
            }}>
              {post.excerpt}
            </p>
            
            <a
              href={`/blog/${post.slug}`}
              style={{
                color: '#3b82f6',
                textDecoration: 'none',
                fontWeight: '500',
                fontSize: '0.875rem'
              }}
            >
              Read more →
            </a>
          </article>
        ))}
      </div>

      <div style={{
        marginTop: '2rem',
        padding: '1rem',
        background: '#f0fdf4',
        borderRadius: '0.375rem',
        border: '1px solid #bbf7d0'
      }}>
        <p style={{ margin: 0, color: '#166534' }}>
          <strong>Routing Demo:</strong> This page demonstrates static content rendering. 
          Try clicking on a blog post to see dynamic routing with <code>[slug]</code> parameters!
        </p>
      </div>
    </div>
  )
}

