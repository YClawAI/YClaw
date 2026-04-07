'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { FleetStatus, FleetMode, DeployMode } from '@/components/hive/hive-types';
import { AGENTS, DEPARTMENTS } from '@/lib/agents';

const MODE_OPTIONS: FleetMode[] = ['active', 'paused'];
const DEPLOY_OPTIONS: DeployMode[] = ['auto', 'review', 'lockdown'];
const MODEL_OPTIONS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
];

const MODE_COLORS: Record<FleetMode, string> = {
  active: 'text-terminal-green border-terminal-green/30 bg-terminal-green/10',
  paused: 'text-terminal-orange border-terminal-orange/30 bg-terminal-orange/10',
};

const DEPLOY_COLORS: Record<DeployMode, string> = {
  auto: 'text-terminal-cyan border-terminal-cyan/30 bg-terminal-cyan/10',
  review: 'text-terminal-orange border-terminal-orange/30 bg-terminal-orange/10',
  lockdown: 'text-terminal-red border-terminal-red/30 bg-terminal-red/10',
};

export function FleetControlsInteractive() {
  const [fleet, setFleet] = useState<FleetStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const fleetRef = useRef(fleet);
  fleetRef.current = fleet;

  useEffect(() => {
    fetch('/api/org/fleet')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => { setFleet(data); setLoading(false); })
      .catch(() => { setFetchError(true); setLoading(false); });
  }, []);

  const [saveError, setSaveError] = useState<string | null>(null);

  const updateFleet = useCallback(async (updates: Partial<FleetStatus>) => {
    const current = fleetRef.current;
    if (!current) return;
    setSaving(true);
    setSaveError(null);
    // Snapshot pre-update state for rollback (avoids stale closure on overlap)
    const snapshot = { ...current };
    setFleet({ ...current, ...updates });

    try {
      const res = await fetch('/api/org/fleet', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        setFleet(snapshot);
        setSaveError('Failed to save — fleet API returned an error');
      }
    } catch {
      setFleet(snapshot);
      setSaveError('Failed to save — unable to reach fleet API');
    } finally {
      setSaving(false);
    }
  }, []);

  const toggleFlag = useCallback((flag: string) => {
    const current = fleetRef.current;
    if (!current) return;
    const newFlags = { ...current.flags, [flag]: !current.flags[flag] };
    updateFleet({ flags: newFlags });
  }, [updateFleet]);

  if (loading) {
    return <div className="text-xs text-terminal-dim py-2">Loading fleet status...</div>;
  }

  if (!fleet) {
    if (fetchError) {
      return (
        <div className="text-xs text-terminal-dim py-2">Fleet unavailable</div>
      );
    }
    return <div className="text-xs text-terminal-dim py-2">Fleet unavailable</div>;
  }

  return (
    <div className="space-y-3">
      {/* Fleet Mode */}
      <div className="px-2">
        <div className="text-[10px] text-terminal-dim mb-1.5">Fleet Mode</div>
        <div className="flex gap-1">
          {MODE_OPTIONS.map((mode) => (
            <button
              key={mode}
              onClick={() => updateFleet({ mode })}
              disabled={saving}
              className={`flex-1 text-[10px] font-mono py-1 rounded border transition-colors ${
                fleet.mode === mode
                  ? MODE_COLORS[mode]
                  : 'text-terminal-dim border-terminal-border hover:border-terminal-muted'
              }`}
            >
              {mode.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Default Model */}
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-xs text-terminal-dim">Default Model</span>
        <select
          value={fleet.defaultModel}
          onChange={(e) => updateFleet({ defaultModel: e.target.value })}
          disabled={saving}
          className="text-xs font-mono text-terminal-purple bg-terminal-bg border border-terminal-border rounded px-1.5 py-0.5 focus:outline-none focus:border-terminal-purple"
        >
          {MODEL_OPTIONS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {/* Fallback Model */}
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-xs text-terminal-dim">Fallback Model</span>
        <select
          value={fleet.fallbackModel}
          onChange={(e) => updateFleet({ fallbackModel: e.target.value })}
          disabled={saving}
          className="text-xs font-mono text-terminal-dim bg-terminal-bg border border-terminal-border rounded px-1.5 py-0.5 focus:outline-none focus:border-terminal-purple"
        >
          {MODEL_OPTIONS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {/* Deploy Mode */}
      <div className="px-2">
        <div className="text-[10px] text-terminal-dim mb-1.5">Deploy Mode</div>
        <div className="flex gap-1">
          {DEPLOY_OPTIONS.map((mode) => (
            <button
              key={mode}
              onClick={() => updateFleet({ deployMode: mode })}
              disabled={saving}
              className={`flex-1 text-[10px] font-mono py-1 rounded border transition-colors ${
                fleet.deployMode === mode
                  ? DEPLOY_COLORS[mode]
                  : 'text-terminal-dim border-terminal-border hover:border-terminal-muted'
              }`}
            >
              {mode.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Agents / Departments (static info) */}
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-xs text-terminal-dim">Agents</span>
        <span className="text-xs font-mono text-terminal-text">{AGENTS.length} registered</span>
      </div>
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-xs text-terminal-dim">Departments</span>
        <span className="text-xs font-mono text-terminal-text">{DEPARTMENTS.length} active</span>
      </div>

      {/* Feature Flags */}
      <div className="pt-3 border-t border-terminal-border">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-terminal-dim/60 mb-2">
          Feature Flags
        </h4>
        <div className="space-y-1.5">
          {Object.entries(fleet.flags).map(([flag, enabled]) => (
            <div key={flag} className="flex items-center justify-between px-2 py-1">
              <span className="text-[10px] font-mono text-terminal-dim">{flag}</span>
              <button
                onClick={() => toggleFlag(flag)}
                disabled={saving}
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                  enabled
                    ? 'bg-terminal-green/10 text-terminal-green border-terminal-green/30 hover:bg-terminal-green/20'
                    : 'bg-terminal-muted/30 text-terminal-dim border-terminal-border hover:bg-terminal-muted/50'
                }`}
              >
                {enabled ? 'ON' : 'OFF'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Save error indicator */}
      {saveError && (
        <div className="text-xs text-zinc-500 flex items-center gap-1 px-2 pt-2">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
          {saveError}
        </div>
      )}
    </div>
  );
}
