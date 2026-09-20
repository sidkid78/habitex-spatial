import './globals.css';

import type { ReactNode } from 'react';

export const metadata = {
  title: 'Project Management MCP',
  description: 'Agentic project management dashboard',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
