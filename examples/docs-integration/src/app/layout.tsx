import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>Farm Docs Integration</title>
      </head>
      <body>{children}</body>
    </html>
  );
}
