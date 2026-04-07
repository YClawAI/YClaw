'use client';

import { useState } from 'react';

export type CalendarSlot = {
  day: string;
  time: string;
  topic?: string;
  status?: string;
};

interface ContentCalendarProps {
  slots: CalendarSlot[];
  scheduleSource?: 'live' | 'static';
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABELS: Record<string, string> = {
  mon: 'MON', tue: 'TUE', wed: 'WED', thu: 'THU', fri: 'FRI', sat: 'SAT', sun: 'SUN',
};
const DEFAULT_WEEKDAY_TIMES = ['14:00', '16:30', '22:00'];
const DEFAULT_WEEKEND_TIMES = ['15:00'];

function statusBgClass(status?: string): string {
  switch (status) {
    case 'published': return 'border-terminal-cyan/30 bg-terminal-cyan/5';
    case 'approved': return 'border-terminal-green/30 bg-terminal-green/5';
    case 'in_review': return 'border-terminal-blue/30 bg-terminal-blue/5';
    case 'asset_pending': return 'border-terminal-yellow/30 bg-terminal-yellow/5';
    case 'drafted': return 'border-terminal-border bg-terminal-bg';
    default: return 'border-terminal-border bg-terminal-bg';
  }
}

function SlotCell({ slot, onSelect }: { slot: CalendarSlot | undefined; onSelect: (s: CalendarSlot) => void }) {
  if (!slot) {
    return (
      <div className="border border-terminal-border/30 rounded p-2 min-h-[72px] bg-terminal-bg/30">
        <span className="text-[10px] text-terminal-dim/40 font-mono">--</span>
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(slot)}
      className={`w-full text-left border rounded p-2 min-h-[72px] transition-colors hover:border-terminal-orange/50 cursor-pointer ${statusBgClass(slot.status)}`}
    >
      <div className="text-[10px] text-terminal-dim font-mono mb-1">{slot.time} UTC</div>
      <div className="text-xs text-terminal-text font-mono truncate mb-1" title={slot.topic}>
        {slot.topic}
      </div>
      {slot.status && (
        <div className="text-[10px] font-mono text-terminal-dim">
          {slot.status}
        </div>
      )}
    </button>
  );
}

function SlotDetailPanel({ slot, onClose }: { slot: CalendarSlot; onClose: () => void }) {
  return (
    <div className="bg-terminal-surface border border-terminal-orange/30 rounded p-4 mt-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-terminal-dim">
            CONTENT PREVIEW
          </div>
          <div className="text-sm font-mono text-terminal-orange mt-1">{slot.topic}</div>
        </div>
        <button
          onClick={onClose}
          className="text-terminal-dim hover:text-terminal-text transition-colors text-sm font-mono"
        >
          [x]
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
        <div>
          <div className="text-[10px] text-terminal-dim">DAY</div>
          <div className="text-xs text-terminal-text font-mono">{DAY_LABELS[slot.day]}</div>
        </div>
        <div>
          <div className="text-[10px] text-terminal-dim">TIME</div>
          <div className="text-xs text-terminal-text font-mono">{slot.time} UTC</div>
        </div>
        <div>
          <div className="text-[10px] text-terminal-dim">STATUS</div>
          <div className="text-xs font-mono text-terminal-dim">
            {slot.status ?? '--'}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ContentCalendar({ slots, scheduleSource = 'static' }: ContentCalendarProps) {
  const [selected, setSelected] = useState<CalendarSlot | null>(null);

  if (slots.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-xs text-terminal-dim">Turn on fleet to see schedule</span>
      </div>
    );
  }

  // Build a lookup: day+time -> slot
  const lookup = new Map<string, CalendarSlot>();
  for (const slot of slots) {
    lookup.set(`${slot.day}:${slot.time}`, slot);
  }

  // Collect all unique times from both defaults and actual slots
  const slotTimes = new Set(slots.map(s => s.time));
  const allTimes = [...new Set([...DEFAULT_WEEKDAY_TIMES, ...DEFAULT_WEEKEND_TIMES, ...slotTimes])].sort();

  // Build a set of valid day:time combos (defaults + any slot that exists)
  const validCells = new Set<string>();
  for (const day of DAYS) {
    const isWeekend = day === 'sat' || day === 'sun';
    const defaults = isWeekend ? DEFAULT_WEEKEND_TIMES : DEFAULT_WEEKDAY_TIMES;
    for (const t of defaults) validCells.add(`${day}:${t}`);
  }
  // Also include any slot that came from live data (arbitrary cron times)
  for (const slot of slots) validCells.add(`${slot.day}:${slot.time}`);

  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
        CONTENT CALENDAR
      </div>

      {/* Grid: scrollable horizontally on mobile */}
      <div className="overflow-x-auto -mx-4 px-4">
        <div className="min-w-[700px]">
          {/* Header row */}
          <div className="grid grid-cols-[60px_repeat(7,1fr)] gap-1 mb-1">
            <div className="text-[10px] text-terminal-dim font-mono" />
            {DAYS.map((d) => (
              <div key={d} className="text-[10px] text-terminal-dim font-mono text-center font-bold">
                {DAY_LABELS[d]}
              </div>
            ))}
          </div>

          {/* Time rows */}
          {allTimes.map((time) => (
            <div key={time} className="grid grid-cols-[60px_repeat(7,1fr)] gap-1 mb-1">
              <div className="flex items-start pt-2">
                <span className="text-[10px] text-terminal-dim font-mono">{time}</span>
              </div>
              {DAYS.map((day) => {
                const key = `${day}:${time}`;
                if (!validCells.has(key)) {
                  return (
                    <div key={key} className="min-h-[72px]" />
                  );
                }
                const slot = lookup.get(key);
                return (
                  <SlotCell
                    key={key}
                    slot={slot}
                    onSelect={setSelected}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Cron schedule reference */}
      <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-terminal-dim font-mono">
        <span>Weekday: 14:00, 16:30, 22:00 UTC</span>
        <span>Weekend: 15:00 UTC</span>
        {scheduleSource === 'static' && (
          <span className="text-terminal-yellow">Static schedule</span>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <SlotDetailPanel slot={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
