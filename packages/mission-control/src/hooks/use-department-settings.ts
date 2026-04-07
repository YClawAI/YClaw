'use client';

import { useState, useEffect, useCallback } from 'react';

interface UseDepartmentSettingsOptions {
  enabled?: boolean;
}

interface UseDepartmentSettingsReturn {
  settings: Record<string, unknown>;
  loading: boolean;
  saving: boolean;
  error: string | null;
  loadError: string | null;
  hasLoaded: boolean;
  updateSettings: (updates: Record<string, unknown>) => Promise<boolean>;
  refetch: () => Promise<void>;
}

export function useDepartmentSettings(
  department: string,
  { enabled = true }: UseDepartmentSettingsOptions = {},
): UseDepartmentSettingsReturn {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const refetch = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    setLoadError(null);

    try {
      const res = await fetch(`/api/departments/settings?department=${department}`, {
        cache: 'no-store',
        credentials: 'include',
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = 'Failed to load settings';
        try {
          msg = JSON.parse(text).error || msg;
        } catch {
          // use default message
        }
        throw new Error(msg);
      }

      const data = await res.json();
      setSettings(data);
      setHasLoaded(true);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [department, enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refetch();
  }, [enabled, refetch]);

  const updateSettings = useCallback(async (updates: Record<string, unknown>) => {
    if (!hasLoaded || loadError) {
      setError('Reload settings before saving');
      return false;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/departments/settings?department=${department}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = 'Failed to save';
        try { msg = JSON.parse(text).error || msg; } catch { /* use default */ }
        throw new Error(msg);
      }
      setSettings(prev => ({ ...prev, ...updates }));
      setSaving(false);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
      return false;
    }
  }, [department, hasLoaded, loadError]);

  return { settings, loading, saving, error, loadError, hasLoaded, updateSettings, refetch };
}
