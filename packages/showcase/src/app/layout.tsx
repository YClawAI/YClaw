import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'YCLAW Live',
  description: 'Watch YCLAW agents working in real-time',
};

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 text-sm text-mc-text-tertiary hover:text-mc-text transition-colors rounded hover:bg-mc-surface-hover"
    >
      {children}
    </Link>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen flex flex-col">
        <header className="border-b border-mc-border bg-mc-surface-hover/50 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="flex items-center gap-2">
                <span className="text-lg font-bold text-mc-text tracking-tight">YCLAW</span>
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-mc-danger/10 border border-mc-danger/20">
                  <span className="w-2 h-2 rounded-full bg-mc-danger animate-live" />
                  <span className="text-xs font-medium text-mc-danger uppercase tracking-wider">Live</span>
                </span>
              </Link>
              <nav className="hidden sm:flex items-center gap-1 ml-4">
                <NavLink href="/">Dashboard</NavLink>
                <NavLink href="/agents">Agents</NavLink>
                <NavLink href="/events">Events</NavLink>
                <NavLink href="/queue">Queue</NavLink>
              </nav>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-7xl mx-auto px-4 py-8 w-full">
          {children}
        </main>

        <footer className="border-t border-mc-border py-6 text-center text-sm text-mc-text-tertiary">
          Powered by{' '}
          <a href="https://yclaw.ai" className="text-mc-info hover:underline" target="_blank" rel="noopener noreferrer">
            YCLAW
          </a>
          {' '}&middot; Autonomous AI Agent System
        </footer>
      </body>
    </html>
  );
}
