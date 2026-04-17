'use client';

import { useEffect } from 'react';
import type { UnifiedEvent } from '@/lib/event-log-queries';
import { AGENTS } from '@/lib/agents';

const STATUS_STYLES: Record<string, string> = {
  active:    'text-mc-success bg-mc-success/10 border-mc-success/30',
  running:   'text-mc-success bg-mc-success/10 border-mc-success/30',
  completed: 'text-mc-info bg-mc-info/10 border-mc-info/30',
  success:   'text-mc-info bg-mc-info/10 border-mc-info/30',
  merged:    'text-mc-info bg-mc-info/10 border-mc-info/30',
  failed:    'text-mc-danger bg-mc-danger/10 border-mc-danger/30',
  error:     'text-mc-danger bg-mc-danger/10 border-mc-danger/30',
  pending:   'text-mc-warning bg-mc-warning/10 border-mc-warning/30',
  queued:    'text-mc-warning bg-mc-warning/10 border-mc-warning/30',
};

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const style = STATUS_STYLES[status.toLowerCase()] ?? 'text-mc-text-tertiary bg-mc-border border-mc-border';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border ${style}`}>
      {status}
    </span>
  );
}

function JsonBlock({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data, null, 2);
  return (
    <pre className="text-[11px] font-mono text-mc-text bg-mc-bg border border-mc-border rounded p-3 overflow-auto max-h-72 whitespace-pre-wrap break-all">
      {json}
    </pre>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-bold uppercase tracking-widest text-mc-text-tertiary">{label}</span>
      <div className="text-xs text-mc-text font-mono">{children}</div>
    </div>
  );
}

interface EventDetailDrawerProps {
  event: UnifiedEvent | null;
  open: boolean;
  onClose: () => void;
}

export function EventDetailDrawer({ event, open, onClose }: EventDetailDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  if (!open || !event) return null;

  const agent = AGENTS.find((a) => a.name === event.agentId);
  const hasPayload = event.payload && Object.keys(event.payload).length > 0;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-mc-surface-hover border-l border-mc-border shadow-2xl overflow-y-auto max-sm:top-auto max-sm:left-0 max-sm:right-0 max-sm:bottom-0 max-sm:max-w-full max-sm:max-h-[80vh] max-sm:rounded-t-xl max-sm:border-t max-sm:border-l-0">
        {/* Header */}
        <div className="sticky top-0 bg-mc-surface-hover px-6 py-4 border-b border-mc-border flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            {agent?.emoji && <span className="text-lg">{agent.emoji}</span>}
            <h2 className="text-sm font-bold text-mc-text">
              {agent?.label ?? event.agentId}
            </h2>
            <span className="text-[10px] font-mono text-mc-text-tertiary bg-mc-border px-1.5 py-0.5 rounded">
              {event.type}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-mc-text-tertiary hover:text-mc-text transition-colors text-lg leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Core fields */}
          <div className="space-y-3">
            <Row label="Agent">{agent?.label ?? event.agentId}</Row>

            <Row label="Status">
              <StatusBadge status={event.status} />
              {!event.status && <span className="text-mc-text-tertiary">—</span>}
            </Row>

            <Row label="Source">
              {/* Pre-flip used purple for event_log + cyan for others; mechanical flip
                  collapsed both to mc-accent. Route event_log to mc-dept-finance
                  (only iOS-palette purple) to preserve the two-way distinction. */}
              <span className={`px-1.5 py-0.5 rounded border text-[10px] ${
                event.source === 'event_log'
                  ? 'text-mc-dept-finance bg-mc-dept-finance/10 border-mc-dept-finance/30'
                  : 'text-mc-accent bg-mc-accent/10 border-mc-accent/30'
              }`}>
                {event.source}
              </span>
            </Row>

            <Row label="Timestamp">
              {new Date(event.createdAt).toLocaleString()}
            </Row>

            {event.taskId && <Row label="Task ID">{event.taskId}</Row>}

            {event.executionId && (
              <Row label="Execution ID">
                <span className="break-all">{event.executionId}</span>
              </Row>
            )}

            {event.cost !== undefined && (
              <Row label="Cost">${event.cost.toFixed(4)}</Row>
            )}
          </div>

          {/* Payload */}
          {hasPayload && (
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-mc-text-tertiary mb-2">
                Payload
              </h3>
              <JsonBlock data={event.payload!} />
            </div>
          )}

          {!hasPayload && (
            <div className="text-xs text-mc-text-tertiary italic">No additional payload data</div>
          )}
        </div>
      </div>
    </>
  );
}
