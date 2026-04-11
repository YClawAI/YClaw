import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'YClaw — Autonomous AI Agent Teams',
  description:
    'Open-source infrastructure for running autonomous AI agent teams with real department structures, event-driven coordination, and human oversight where it matters.',
  openGraph: {
    title: 'YClaw — Autonomous AI Agent Teams',
    description:
      'Open-source infrastructure for running autonomous AI agent teams.',
    url: 'https://yclaw.ai',
    siteName: 'YClaw',
    type: 'website',
  },
};

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 text-sm text-terminal-dim hover:text-terminal-text transition-colors duration-200 rounded hover:bg-terminal-surface"
    >
      {children}
    </Link>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen flex flex-col bg-terminal-bg">
        {/* ── Navigation ── */}
        <header className="border-b border-terminal-border bg-terminal-bg/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-4">
              <Link href="/" className="flex items-center gap-2.5 group">
                <span className="text-base font-bold text-terminal-text tracking-tight group-hover:text-terminal-purple transition-colors duration-200">
                  YClaw
                </span>
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-terminal-green/10 border border-terminal-green/20">
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-terminal-green animate-live"
                    aria-hidden="true"
                  />
                  <span className="text-xs font-medium text-terminal-green uppercase tracking-wider">
                    Live
                  </span>
                </span>
              </Link>

              {/* Dashboard nav links */}
              <nav
                className="hidden sm:flex items-center gap-1 ml-4"
                aria-label="Dashboard navigation"
              >
                <NavLink href="/agents">Agents</NavLink>
                <NavLink href="/events">Events</NavLink>
                <NavLink href="/queue">Queue</NavLink>
              </nav>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-3">
              <a
                href="https://github.com/YClawAI/YClaw"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs text-terminal-dim hover:text-terminal-text border border-terminal-border hover:border-terminal-muted rounded transition-all duration-200"
                aria-label="View YClaw on GitHub"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                </svg>
                GitHub
              </a>
            </div>
          </div>
        </header>

        {/* ── Main content ── */}
        {/*
          Landing page (/) is full-width with its own section padding.
          Sub-pages (/agents, /events, /queue) use the constrained container.
          We use a slot pattern: landing page sections handle their own max-width.
        */}
        <main className="flex-1 w-full">
          {children}
        </main>

        {/* ── Footer ── */}
        <footer className="border-t border-terminal-border py-8 px-4">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-terminal-dim">
            <div className="flex items-center gap-2">
              <span className="font-bold text-terminal-text">YClaw</span>
              <span>·</span>
              <span>Open-source AI agent orchestration</span>
            </div>
            <div className="flex items-center gap-4">
              <a
                href="https://github.com/YClawAI/YClaw"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-terminal-text transition-colors duration-200"
              >
                GitHub
              </a>
              <a
                href="https://yclaw.ai"
                className="hover:text-terminal-text transition-colors duration-200"
              >
                yclaw.ai
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
