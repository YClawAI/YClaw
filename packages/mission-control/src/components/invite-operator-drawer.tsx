'use client';

import { useState, useCallback } from 'react';
import { SettingsDrawer } from './settings-drawer';
import { DEPARTMENTS, DEPT_META, DEPT_COLORS, type Department } from '@/lib/agents';
import { inviteOperator } from '@/lib/operators-api';
import type { InviteOperatorResponse, OperatorTier } from '@/types/operators';

const TIER_OPTIONS: Array<{ value: Exclude<OperatorTier, 'root'>; label: string; priority: number }> = [
  { value: 'department_head', label: 'Department Head', priority: 70 },
  { value: 'contributor', label: 'Contributor', priority: 50 },
  { value: 'observer', label: 'Observer (read-only)', priority: 10 },
];

export interface InviteSuccessData {
  email: string;
  displayName: string;
  role: string;
  tier: Exclude<OperatorTier, 'root'>;
  departments: string[];
  response: InviteOperatorResponse;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (data: InviteSuccessData) => void;
}

export function InviteOperatorDrawer({ open, onClose, onSuccess }: Props) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('');
  const [tier, setTier] = useState<Exclude<OperatorTier, 'root'>>('contributor');
  const [departments, setDepartments] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rpm, setRpm] = useState(60);
  const [concurrent, setConcurrent] = useState(5);
  const [dailyQuota, setDailyQuota] = useState(100);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteOperatorResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const resetForm = useCallback(() => {
    setEmail('');
    setDisplayName('');
    setRole('');
    setTier('contributor');
    setDepartments([]);
    setShowAdvanced(false);
    setRpm(60);
    setConcurrent(5);
    setDailyQuota(100);
    setLoading(false);
    setError(null);
    setResult(null);
    setCopied(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  const toggleDept = useCallback((dept: string) => {
    setDepartments((prev) =>
      prev.includes(dept)
        ? prev.filter((d) => d !== dept)
        : [...prev, dept],
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!email || !displayName || !role) {
      setError('Email, display name, and role are required.');
      return;
    }
    if (departments.length === 0) {
      setError('Select at least one department.');
      return;
    }

    // Enforce minimum values — empty/zero inputs fall back to defaults
    const safeRpm = Math.max(1, rpm || 60);
    const safeConcurrent = Math.max(1, concurrent || 5);
    const safeDailyQuota = Math.max(1, dailyQuota || 100);

    setLoading(true);
    setError(null);

    try {
      const response = await inviteOperator({
        email,
        displayName,
        role,
        tier,
        departments,
        limits: {
          requestsPerMinute: safeRpm,
          maxConcurrentTasks: safeConcurrent,
          dailyTaskQuota: safeDailyQuota,
        },
      });
      setResult(response);
      onSuccess({ email, displayName, role, tier, departments, response });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setLoading(false);
    }
  }, [email, displayName, role, tier, departments, rpm, concurrent, dailyQuota, onSuccess]);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }, []);

  return (
    <SettingsDrawer open={open} onClose={handleClose} title="Invite Operator">
      {/* ── Success: Invite Token ── */}
      {result && (
        <div>
          <div className="border border-terminal-yellow/40 rounded-lg bg-terminal-yellow/5 p-4">
            <div className="text-xs font-mono font-bold text-terminal-yellow mb-3">
              Invite Created
            </div>
            <div className="mb-3">
              <span className="text-[10px] text-terminal-dim font-mono block mb-1">Token</span>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono text-terminal-text bg-terminal-muted px-2 py-1.5 rounded border border-terminal-border break-all">
                  {result.inviteToken}
                </code>
                <button
                  onClick={() => copyToClipboard(result.inviteToken)}
                  className="shrink-0 px-2 py-1.5 text-[10px] font-mono rounded border border-terminal-border text-terminal-dim hover:text-terminal-text hover:bg-terminal-muted transition-colors"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div className="text-[10px] text-terminal-yellow/80 font-mono mb-4">
              This token will only be shown once. Share it securely with the new operator.
            </div>

            <div className="border-t border-terminal-yellow/20 pt-3">
              <div className="text-[10px] text-terminal-dim font-mono mb-2">
                Next steps for the operator:
              </div>
              <ol className="text-[10px] text-terminal-text font-mono space-y-1 list-decimal list-inside">
                <li>Join the Tailscale network</li>
                <li>Configure their OpenClaw with the invite token</li>
                <li>POST /v1/operators/accept-invite with the token</li>
              </ol>
            </div>

            <div className="mt-3 text-[10px] text-terminal-dim font-mono">
              Expires: {new Date(result.expiresAt).toLocaleString()}
            </div>
          </div>

          <button
            onClick={handleClose}
            className="w-full mt-4 px-3 py-2 text-xs font-mono rounded border border-terminal-border text-terminal-text hover:bg-terminal-muted transition-colors"
          >
            Done
          </button>
        </div>
      )}

      {/* ── Form ── */}
      {!result && (
        <div className="space-y-4">
          {error && (
            <div className="px-3 py-2 rounded border border-terminal-red/30 bg-terminal-red/5 text-xs text-terminal-red font-mono">
              {error}
            </div>
          )}

          {/* Email */}
          <div>
            <label className="text-[10px] text-terminal-dim font-mono uppercase tracking-wider block mb-1">
              Email *
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@company.com"
              className="w-full px-3 py-1.5 text-xs font-mono rounded border border-terminal-border bg-terminal-bg text-terminal-text placeholder:text-terminal-dim/50 focus:outline-none focus:border-terminal-purple/50"
            />
          </div>

          {/* Display Name */}
          <div>
            <label className="text-[10px] text-terminal-dim font-mono uppercase tracking-wider block mb-1">
              Display Name *
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Jane Chen"
              className="w-full px-3 py-1.5 text-xs font-mono rounded border border-terminal-border bg-terminal-bg text-terminal-text placeholder:text-terminal-dim/50 focus:outline-none focus:border-terminal-purple/50"
            />
          </div>

          {/* Role */}
          <div>
            <label className="text-[10px] text-terminal-dim font-mono uppercase tracking-wider block mb-1">
              Role *
            </label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="CMO, CTO, Contractor..."
              className="w-full px-3 py-1.5 text-xs font-mono rounded border border-terminal-border bg-terminal-bg text-terminal-text placeholder:text-terminal-dim/50 focus:outline-none focus:border-terminal-purple/50"
            />
          </div>

          {/* Tier */}
          <div>
            <label className="text-[10px] text-terminal-dim font-mono uppercase tracking-wider block mb-1">
              Tier
            </label>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value as Exclude<OperatorTier, 'root'>)}
              className="w-full px-3 py-1.5 text-xs font-mono rounded border border-terminal-border bg-terminal-bg text-terminal-text focus:outline-none focus:border-terminal-purple/50"
            >
              {TIER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} (priority {opt.priority})
                </option>
              ))}
            </select>
          </div>

          {/* Departments */}
          <div>
            <label className="text-[10px] text-terminal-dim font-mono uppercase tracking-wider block mb-2">
              Departments *
            </label>
            <div className="grid grid-cols-2 gap-2">
              {DEPARTMENTS.map((dept) => {
                const meta = DEPT_META[dept];
                const colorClass = DEPT_COLORS[dept];
                const isSelected = departments.includes(dept);
                return (
                  <button
                    key={dept}
                    type="button"
                    onClick={() => toggleDept(dept)}
                    className={`flex items-center gap-2 px-3 py-2 rounded border text-xs font-mono transition-colors ${
                      isSelected
                        ? 'border-terminal-purple/50 bg-terminal-purple/10 text-terminal-text'
                        : 'border-terminal-border bg-terminal-bg text-terminal-dim hover:text-terminal-text hover:border-terminal-border'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-terminal-purple' : 'bg-terminal-dim/40'}`} />
                    <span className={isSelected ? colorClass : ''}>{meta.label}</span>
                    {isSelected && (
                      <svg className="w-3 h-3 ml-auto text-terminal-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Advanced: Rate Limits */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-[10px] text-terminal-dim font-mono hover:text-terminal-text transition-colors"
            >
              <span className="w-3 h-3 inline-flex items-center">
                {showAdvanced
                  ? <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  : <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
              <span className="uppercase tracking-wider">Rate Limits</span>
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-3 pl-4 border-l border-terminal-border">
                <div>
                  <label className="text-[10px] text-terminal-dim font-mono block mb-1">
                    Requests per minute
                  </label>
                  <input
                    type="number"
                    value={rpm}
                    onChange={(e) => setRpm(parseInt(e.target.value, 10) || 0)}
                    min={1}
                    className="w-full px-3 py-1.5 text-xs font-mono rounded border border-terminal-border bg-terminal-bg text-terminal-text focus:outline-none focus:border-terminal-purple/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-terminal-dim font-mono block mb-1">
                    Max concurrent tasks
                  </label>
                  <input
                    type="number"
                    value={concurrent}
                    onChange={(e) => setConcurrent(parseInt(e.target.value, 10) || 0)}
                    min={1}
                    className="w-full px-3 py-1.5 text-xs font-mono rounded border border-terminal-border bg-terminal-bg text-terminal-text focus:outline-none focus:border-terminal-purple/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-terminal-dim font-mono block mb-1">
                    Daily task quota
                  </label>
                  <input
                    type="number"
                    value={dailyQuota}
                    onChange={(e) => setDailyQuota(parseInt(e.target.value, 10) || 0)}
                    min={1}
                    className="w-full px-3 py-1.5 text-xs font-mono rounded border border-terminal-border bg-terminal-bg text-terminal-text focus:outline-none focus:border-terminal-purple/50"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full px-3 py-2.5 text-xs font-mono font-bold rounded border border-terminal-purple/50 bg-terminal-purple/10 text-terminal-purple hover:bg-terminal-purple/20 transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating Invite...' : 'Send Invite'}
          </button>
        </div>
      )}
    </SettingsDrawer>
  );
}
