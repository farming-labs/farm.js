import React from 'react'

export default function HomePage() {
  return React.createElement('div', { className: 'container' },
    React.createElement('div', { className: 'emoji' }, '🚜'),
    React.createElement('h1', null, 'Farm.js is Live!'),
    React.createElement('p', null, 'Your Vite-powered React framework is running successfully.'),
    React.createElement('div', { className: 'features' },
      React.createElement('h3', null, '✨ What\'s Working:'),
      React.createElement('ul', null,
        React.createElement('li', null, '⚡ Vite development server'),
        React.createElement('li', null, '⚛️ React Server-Side Rendering'),
        React.createElement('li', null, '🗂️ File-based routing'),
        React.createElement('li', null, '📦 Zero configuration'),
        React.createElement('li', null, '🎨 Next.js-like API')
      )
    ),
    React.createElement('p', { style: { marginTop: '2rem', fontSize: '0.9rem', color: '#999' } },
      'Open browser at: http://localhost:3001'
    )
  )
}
