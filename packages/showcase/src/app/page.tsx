import Link from 'next/link';

// ─── Section: Hero ────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-4 py-24 text-center overflow-hidden grain-overlay">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(#cdd6f4 1px, transparent 1px), linear-gradient(90deg, #cdd6f4 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 max-w-4xl mx-auto stagger">
        {/* Label */}
        <p className="animate-float-up inline-flex items-center gap-2 px-3 py-1 rounded-full border border-terminal-border bg-terminal-surface/60 text-xs text-terminal-dim uppercase tracking-widest mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-terminal-green animate-live" aria-hidden="true" />
          Open-source · Self-hosted · Model-agnostic
        </p>

        {/* Headline */}
        <h1 className="animate-float-up text-4xl sm:text-6xl lg:text-7xl font-bold leading-tight tracking-tight mb-6">
          <span className="text-terminal-text">AI agents that</span>
          <br />
          <span className="gradient-text">work as a team.</span>
        </h1>

        {/* Sub-headline */}
        <p className="animate-float-up text-lg sm:text-xl text-terminal-dim max-w-2xl mx-auto mb-10 leading-relaxed">
          YClaw gives your organization the infrastructure to run autonomous AI agent teams —
          with real department structures, event-driven coordination, and human oversight
          where it matters.
        </p>

        {/* CTAs */}
        <div className="animate-float-up flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="https://github.com/YClawAI/YClaw"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto px-8 py-3 rounded-lg bg-terminal-purple/10 border border-terminal-purple/30 text-terminal-purple font-medium hover:bg-terminal-purple/20 hover:border-terminal-purple/50 transition-all duration-300 text-sm"
          >
            View on GitHub
          </a>
          <Link
            href="/agents"
            className="w-full sm:w-auto px-8 py-3 rounded-lg bg-terminal-surface border border-terminal-border text-terminal-text font-medium hover:border-terminal-muted transition-all duration-300 text-sm"
          >
            Watch agents live →
          </Link>
        </div>

        {/* Terminal snippet */}
        <div className="animate-float-up mt-16 text-left inline-block bg-terminal-surface border border-terminal-border rounded-lg px-6 py-4 text-sm">
          <p className="text-terminal-dim mb-1 text-xs uppercase tracking-widest">Quick start</p>
          <p>
            <span className="text-terminal-green">$</span>{' '}
            <span className="text-terminal-text">npx create-yclaw-app my-org</span>
            <span className="cursor-blink text-terminal-purple ml-0.5">▋</span>
          </p>
        </div>
      </div>
    </section>
  );
}

// ─── Section: Agent Org Structure ─────────────────────────────────────────────

const DEPARTMENTS = [
  {
    name: 'Executive',
    color: 'text-terminal-purple',
    border: 'border-terminal-purple/20',
    bg: 'bg-terminal-purple/5',
    agents: ['Strategist', 'Reviewer'],
    role: 'Sets direction, gates quality',
  },
  {
    name: 'Development',
    color: 'text-terminal-blue',
    border: 'border-terminal-blue/20',
    bg: 'bg-terminal-blue/5',
    agents: ['Architect', 'Designer', 'Mechanic'],
    role: 'Code quality and deployment',
  },
  {
    name: 'Marketing',
    color: 'text-terminal-orange',
    border: 'border-terminal-orange/20',
    bg: 'bg-terminal-orange/5',
    agents: ['Ember', 'Forge', 'Scout'],
    role: 'External narrative and growth',
  },
  {
    name: 'Operations',
    color: 'text-terminal-cyan',
    border: 'border-terminal-cyan/20',
    bg: 'bg-terminal-cyan/5',
    agents: ['Librarian', 'Sentinel'],
    role: 'Community, analytics, infrastructure',
  },
  {
    name: 'Finance',
    color: 'text-terminal-yellow',
    border: 'border-terminal-yellow/20',
    bg: 'bg-terminal-yellow/5',
    agents: ['Treasurer'],
    role: 'Treasury and spend tracking',
  },
  {
    name: 'Support',
    color: 'text-terminal-green',
    border: 'border-terminal-green/20',
    bg: 'bg-terminal-green/5',
    agents: ['Guide', 'Keeper'],
    role: 'User help and troubleshooting',
  },
];

function OrgStructureSection() {
  return (
    <section className="py-24 px-4 border-t border-terminal-border">
      <div className="max-w-6xl mx-auto">
        <SectionLabel>Architecture</SectionLabel>
        <h2 className="text-3xl sm:text-4xl font-bold text-terminal-text mb-4">
          A real org chart,{' '}
          <span className="gradient-text">not a prompt chain.</span>
        </h2>
        <p className="text-terminal-dim max-w-2xl mb-12 leading-relaxed">
          Agents are organized into departments with defined roles, reporting lines, and
          event-driven coordination. Each agent knows its scope and escalation path.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {DEPARTMENTS.map((dept) => (
            <div
              key={dept.name}
              className={`card-hover rounded-lg border ${dept.border} ${dept.bg} p-5`}
            >
              <p className={`text-xs uppercase tracking-widest mb-3 ${dept.color}`}>
                {dept.name}
              </p>
              <p className="text-terminal-dim text-xs mb-4">{dept.role}</p>
              <div className="flex flex-wrap gap-2">
                {dept.agents.map((agent) => (
                  <span
                    key={agent}
                    className="px-2 py-0.5 rounded text-xs bg-terminal-bg border border-terminal-border text-terminal-text"
                  >
                    {agent}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Section: Personal AI Control Layer ───────────────────────────────────────

function ControlLayerSection() {
  return (
    <section className="py-24 px-4 border-t border-terminal-border">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div>
          <SectionLabel>Control</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold text-terminal-text mb-4">
            Your AI team.{' '}
            <span className="gradient-text-warm">Your rules.</span>
          </h2>
          <p className="text-terminal-dim leading-relaxed mb-6">
            YClaw is self-hosted and open-source. You own the agent stack — inspect it,
            modify it, extend it. No vendor lock-in, no black boxes, no usage-based
            pricing surprises.
          </p>
          <ul className="space-y-3 text-sm">
            {[
              'Swap LLM providers without rewriting a line',
              'Human review gates at decision points, not every step',
              'Full audit log of every agent action',
              'YAML-configured agents — readable, version-controlled',
            ].map((item) => (
              <li key={item} className="flex items-start gap-3 text-terminal-dim">
                <span className="text-terminal-green mt-0.5 shrink-0">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Config preview */}
        <div className="bg-terminal-surface border border-terminal-border rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-terminal-border bg-terminal-bg/50">
            <span className="w-3 h-3 rounded-full bg-terminal-red/60" aria-hidden="true" />
            <span className="w-3 h-3 rounded-full bg-terminal-yellow/60" aria-hidden="true" />
            <span className="w-3 h-3 rounded-full bg-terminal-green/60" aria-hidden="true" />
            <span className="ml-2 text-xs text-terminal-dim">agents/strategist.yaml</span>
          </div>
          <pre className="p-5 text-xs leading-relaxed overflow-x-auto">
            <code>
              <span className="text-terminal-dim"># Executive department</span>{'\n'}
              <span className="text-terminal-purple">name</span>
              <span className="text-terminal-text">: strategist</span>{'\n'}
              <span className="text-terminal-purple">department</span>
              <span className="text-terminal-text">: executive</span>{'\n'}
              <span className="text-terminal-purple">model</span>
              <span className="text-terminal-text">:</span>{'\n'}
              {'  '}
              <span className="text-terminal-purple">provider</span>
              <span className="text-terminal-text">: anthropic</span>{'\n'}
              {'  '}
              <span className="text-terminal-purple">model</span>
              <span className="text-terminal-text">: claude-sonnet-4-5</span>{'\n'}
              <span className="text-terminal-purple">triggers</span>
              <span className="text-terminal-text">:</span>{'\n'}
              {'  '}
              <span className="text-terminal-text">- </span>
              <span className="text-terminal-purple">type</span>
              <span className="text-terminal-text">: cron</span>{'\n'}
              {'    '}
              <span className="text-terminal-purple">schedule</span>
              <span className="text-terminal-text">: </span>
              <span className="text-terminal-green">&quot;0 9 * * 1&quot;</span>{'\n'}
              {'    '}
              <span className="text-terminal-purple">task</span>
              <span className="text-terminal-text">: weekly_directive</span>
            </code>
          </pre>
        </div>
      </div>
    </section>
  );
}

// ─── Section: Multi-Operator / Event Bus ──────────────────────────────────────

const EVENT_STREAM = [
  { time: '09:00:01', source: 'strategist', type: 'weekly_directive', color: 'text-terminal-purple' },
  { time: '09:00:03', source: 'architect', type: 'build_directive → ao', color: 'text-terminal-blue' },
  { time: '09:00:05', source: 'ember', type: 'content_ready', color: 'text-terminal-orange' },
  { time: '09:00:07', source: 'scout', type: 'intel_report', color: 'text-terminal-cyan' },
  { time: '09:00:09', source: 'sentinel', type: 'status_report', color: 'text-terminal-green' },
  { time: '09:00:11', source: 'reviewer', type: 'approved', color: 'text-terminal-yellow' },
];

function MultiOperatorSection() {
  return (
    <section className="py-24 px-4 border-t border-terminal-border">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        {/* Event stream preview */}
        <div className="bg-terminal-surface border border-terminal-border rounded-lg overflow-hidden order-2 lg:order-1">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-terminal-border bg-terminal-bg/50">
            <span className="w-2 h-2 rounded-full bg-terminal-green animate-live" aria-hidden="true" />
            <span className="text-xs text-terminal-dim">event bus — live</span>
          </div>
          <div className="p-4 space-y-2 text-xs font-mono">
            {EVENT_STREAM.map((evt) => (
              <div key={evt.type} className="flex items-center gap-3">
                <span className="text-terminal-dim shrink-0">{evt.time}</span>
                <span className={`shrink-0 ${evt.color}`}>{evt.source}</span>
                <span className="text-terminal-dim">→</span>
                <span className="text-terminal-text truncate">{evt.type}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <SectionLabel>Coordination</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold text-terminal-text mb-4">
            Event-driven,{' '}
            <span className="gradient-text">not cron-driven.</span>
          </h2>
          <p className="text-terminal-dim leading-relaxed mb-6">
            Agents react to what happens — a PR opens, a metric crosses a threshold, a
            customer writes in. The event bus routes signals between agents without
            tight coupling. Any agent can publish; any agent can subscribe.
          </p>
          <p className="text-terminal-dim leading-relaxed">
            Multiple operators can run independent agent teams on the same infrastructure.
            Departments are isolated by default; cross-department coordination goes through
            the Strategist.
          </p>
        </div>
      </div>
    </section>
  );
}

// ─── Section: 4 Markdown Files ────────────────────────────────────────────────

const SETUP_STEPS = [
  {
    file: 'agents/*.yaml',
    label: '01',
    title: 'Define your agents',
    desc: 'One YAML file per agent. Set the model, department, triggers, and available actions.',
    color: 'text-terminal-purple',
    border: 'border-terminal-purple/20',
  },
  {
    file: 'prompts/*.md',
    label: '02',
    title: 'Write their prompts',
    desc: 'Markdown prompt files loaded at runtime. Version-controlled, human-readable, easy to iterate.',
    color: 'text-terminal-blue',
    border: 'border-terminal-blue/20',
  },
  {
    file: 'skills/**/*.md',
    label: '03',
    title: 'Agents learn over time',
    desc: 'Agents extract reusable skills from their work and store them as Markdown. Knowledge compounds.',
    color: 'text-terminal-cyan',
    border: 'border-terminal-cyan/20',
  },
  {
    file: '.env',
    label: '04',
    title: 'Connect your tools',
    desc: 'GitHub, Discord, Slack, Figma, and more. Add API keys and agents start using them immediately.',
    color: 'text-terminal-green',
    border: 'border-terminal-green/20',
  },
];

function MarkdownFilesSection() {
  return (
    <section className="py-24 px-4 border-t border-terminal-border">
      <div className="max-w-6xl mx-auto">
        <SectionLabel>Setup</SectionLabel>
        <h2 className="text-3xl sm:text-4xl font-bold text-terminal-text mb-4">
          Four files to{' '}
          <span className="gradient-text">a working agent team.</span>
        </h2>
        <p className="text-terminal-dim max-w-2xl mb-12 leading-relaxed">
          No GUI required. No proprietary DSL. YClaw is configured in plain text files
          you already know how to edit.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SETUP_STEPS.map((step) => (
            <div
              key={step.label}
              className={`card-hover rounded-lg border ${step.border} bg-terminal-surface p-6`}
            >
              <div className="flex items-start justify-between mb-4">
                <span className={`text-xs uppercase tracking-widest ${step.color}`}>
                  {step.label}
                </span>
                <code className="text-xs text-terminal-dim bg-terminal-bg px-2 py-0.5 rounded">
                  {step.file}
                </code>
              </div>
              <h3 className="text-terminal-text font-semibold mb-2">{step.title}</h3>
              <p className="text-terminal-dim text-sm leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Section: Agent Autonomy ───────────────────────────────────────────────────

const AUTONOMY_ITEMS = [
  {
    title: 'Decide and execute',
    desc: 'Agents act within their department scope without waiting for approval on every step.',
    icon: '⚡',
  },
  {
    title: 'Escalate intelligently',
    desc: 'Cross-department actions and budget thresholds route to the right human automatically.',
    icon: '↑',
  },
  {
    title: 'Learn from work',
    desc: 'Agents extract skills from completed tasks. Each run makes the next one faster.',
    icon: '◎',
  },
  {
    title: 'Fail loudly',
    desc: 'Errors surface immediately with full context. Silent failures are worse than noisy ones.',
    icon: '!',
  },
];

function AgentAutonomySection() {
  return (
    <section className="py-24 px-4 border-t border-terminal-border">
      <div className="max-w-6xl mx-auto">
        <SectionLabel>Autonomy</SectionLabel>
        <h2 className="text-3xl sm:text-4xl font-bold text-terminal-text mb-4">
          Agents that act,{' '}
          <span className="gradient-text">not agents that ask.</span>
        </h2>
        <p className="text-terminal-dim max-w-2xl mb-12 leading-relaxed">
          The autonomy doctrine is baked into every agent. They default to action over
          deliberation, log their reasoning, and hand off cleanly to the next agent in
          the pipeline.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {AUTONOMY_ITEMS.map((item) => (
            <div
              key={item.title}
              className="card-hover rounded-lg border border-terminal-border bg-terminal-surface p-6"
            >
              <div className="w-10 h-10 rounded-lg bg-terminal-bg border border-terminal-border flex items-center justify-center text-terminal-purple font-bold mb-4 text-lg">
                {item.icon}
              </div>
              <h3 className="text-terminal-text font-semibold mb-2 text-sm">{item.title}</h3>
              <p className="text-terminal-dim text-xs leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Section: Tech Stack ──────────────────────────────────────────────────────

const STACK = [
  { name: 'TypeScript', role: 'Runtime', color: 'text-terminal-blue' },
  { name: 'Node 20 LTS', role: 'Platform', color: 'text-terminal-green' },
  { name: 'Turborepo', role: 'Monorepo', color: 'text-terminal-cyan' },
  { name: 'Next.js 15', role: 'Showcase', color: 'text-terminal-text' },
  { name: 'Anthropic / OpenAI / Ollama', role: 'LLM Providers', color: 'text-terminal-purple' },
  { name: 'GitHub / Discord / Slack', role: 'Integrations', color: 'text-terminal-orange' },
  { name: 'Vitest', role: 'Testing', color: 'text-terminal-yellow' },
  { name: 'Docker + ECS', role: 'Deployment', color: 'text-terminal-red' },
];

function TechStackSection() {
  return (
    <section className="py-24 px-4 border-t border-terminal-border">
      <div className="max-w-6xl mx-auto">
        <SectionLabel>Stack</SectionLabel>
        <h2 className="text-3xl sm:text-4xl font-bold text-terminal-text mb-4">
          Built on tools{' '}
          <span className="gradient-text">you already trust.</span>
        </h2>
        <p className="text-terminal-dim max-w-2xl mb-12 leading-relaxed">
          No proprietary runtime. No magic. YClaw is TypeScript all the way down —
          readable, debuggable, and replaceable piece by piece.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {STACK.map((item) => (
            <div
              key={item.name}
              className="card-hover rounded-lg border border-terminal-border bg-terminal-surface p-4"
            >
              <p className={`text-xs uppercase tracking-widest mb-1 ${item.color}`}>
                {item.role}
              </p>
              <p className="text-terminal-text text-sm font-medium">{item.name}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Section: CTAs ────────────────────────────────────────────────────────────

function CTASection() {
  return (
    <section className="py-24 px-4 border-t border-terminal-border">
      <div className="max-w-3xl mx-auto text-center">
        <SectionLabel>Get started</SectionLabel>
        <h2 className="text-3xl sm:text-4xl font-bold text-terminal-text mb-4">
          Your org, running on{' '}
          <span className="gradient-text">autonomous agents.</span>
        </h2>
        <p className="text-terminal-dim mb-10 leading-relaxed">
          Open-source, self-hosted, model-agnostic. Deploy in minutes.
          Extend indefinitely.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
          <a
            href="https://github.com/YClawAI/YClaw"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto px-8 py-3 rounded-lg bg-terminal-purple/10 border border-terminal-purple/30 text-terminal-purple font-medium hover:bg-terminal-purple/20 hover:border-terminal-purple/50 transition-all duration-300 text-sm"
          >
            Star on GitHub
          </a>
          <Link
            href="/agents"
            className="w-full sm:w-auto px-8 py-3 rounded-lg bg-terminal-surface border border-terminal-border text-terminal-text font-medium hover:border-terminal-muted transition-all duration-300 text-sm"
          >
            Watch agents live →
          </Link>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-px bg-terminal-border rounded-lg overflow-hidden border border-terminal-border">
          {[
            { value: '6', label: 'Departments' },
            { value: '14+', label: 'Agents' },
            { value: '50+', label: 'Event types' },
          ].map((stat) => (
            <div key={stat.label} className="bg-terminal-surface py-6 px-4 text-center">
              <p className="text-2xl font-bold gradient-text mb-1">{stat.value}</p>
              <p className="text-xs text-terminal-dim uppercase tracking-widest">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Shared: Section label ────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs uppercase tracking-widest text-terminal-dim mb-3">{children}</p>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <>
      <HeroSection />
      <OrgStructureSection />
      <ControlLayerSection />
      <MultiOperatorSection />
      <MarkdownFilesSection />
      <AgentAutonomySection />
      <TechStackSection />
      <CTASection />
    </>
  );
}
