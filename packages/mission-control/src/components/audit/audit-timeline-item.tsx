'use client';

import type { AuditEvent } from './audit-types';
import { AUDIT_TYPE_CONFIG, SEVERITY_COLORS } from './audit-types';

interface AuditTimelineItemProps {
  event: AuditEvent;
  onClick: () => void;
  isNew?: boolean;
}

export function AuditTimelineItem({ event, onClick, isNew }: AuditTimelineItemProps) {
  const config = AUDIT_TYPE_CONFIG[event.type];
  const severityBorder = SEVERITY_COLORS[event.severity];
  const hasAgent = !!event.agentId;

  const timeStr = formatTimestamp(event.timestamp);

  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left px-4 py-3 border-l-2 ${severityBorder}
        hover:bg-gray-800/40 active:bg-gray-800/60 transition-colors
        ${isNew ? 'animate-highlight' : ''}
        ${hasAgent ? 'cursor-pointer' : 'cursor-default'}
      `}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center mt-0.5">
          <span className="text-base">{config.icon}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-medium text-gray-100 truncate">
              {event.title}
            </span>
            {event.agentId && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 capitalize shrink-0">
                {event.agentId}
              </span>
            )}
          </div>
          {event.detail && (
            <p className="text-xs text-gray-400 line-clamp-2 mb-1">
              {event.detail}
            </p>
          )}
          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <span>{timeStr}</span>
            <span>\u00B7</span>
            <span className={config.color}>{config.label}</span>
            <span>\u00B7</span>
            <span className="capitalize">{event.actor}</span>
          </div>
        </div>

        {hasAgent && (
          <span className="text-gray-600 text-xs mt-1 shrink-0">\u2192 graph</span>
        )}
      </div>
    </button>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();

  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;

  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
