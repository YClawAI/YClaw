'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  serverSaveOpenClawSettings,
  serverToggleSkill,
  serverRunCronJob,
  serverToggleCronJob,
  serverRestartGateway,
} from '@/lib/actions/openclaw-actions';
import type { SkillInfo } from '@/types/gateway';

interface UseOpenClawActionsOptions {
  skills: SkillInfo[];
}

export function useOpenClawActions({ skills }: UseOpenClawActionsOptions) {
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Local skills state for optimistic UI updates after toggle
  const [localSkills, setLocalSkills] = useState(skills);
  useEffect(() => { setLocalSkills(skills); }, [skills]);

  // Track model + temperature selections for save
  const selectedModelRef = useRef<string | undefined>(undefined);
  const selectedTempRef = useRef<number | undefined>(undefined);

  // Dirty state + save
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const handleModelChange = useCallback((modelId: string) => {
    selectedModelRef.current = modelId;
    setDirty(true);
  }, []);

  const handleCreativityChanged = useCallback((_index: number, temperature: number) => {
    selectedTempRef.current = temperature;
    setDirty(true);
  }, []);

  async function handleRunCronJob(jobId: string) {
    setActionPending(jobId);
    setErrorMessage(null);
    const result = await serverRunCronJob(jobId);
    setActionPending(null);
    if (!result.ok) setErrorMessage(result.error ?? 'Failed to run cron job');
  }

  async function handleToggleCronJob(jobId: string, enabled: boolean) {
    setActionPending(jobId);
    setErrorMessage(null);
    const result = await serverToggleCronJob(jobId, enabled);
    setActionPending(null);
    if (!result.ok) setErrorMessage(result.error ?? 'Failed to toggle cron job');
  }

  async function handleToggleSharedSkill(name: string, currentlyEnabled: boolean) {
    setActionPending(name);
    setErrorMessage(null);
    const result = await serverToggleSkill(name, !currentlyEnabled);
    setActionPending(null);
    if (result.ok) {
      setLocalSkills((prev) => prev.map((s) => s.name === name ? { ...s, enabled: !currentlyEnabled } : s));
    } else {
      setErrorMessage(result.error ?? 'Failed to toggle skill');
    }
  }

  async function handleRestart() {
    setRestartConfirm(false);
    setActionPending('restart');
    setErrorMessage(null);
    const result = await serverRestartGateway();
    setActionPending(null);
    if (!result.ok) setErrorMessage(result.error ?? 'Failed to restart gateway');
  }

  async function handleSaveAll() {
    setSaveState('saving');
    setErrorMessage(null);

    const result = await serverSaveOpenClawSettings({
      model: selectedModelRef.current,
      temperature: selectedTempRef.current,
    });

    if (!result.ok) {
      setSaveState('idle');
      setErrorMessage(result.error ?? 'Failed to save settings');
      return;
    }

    setSaveState('saved');
    setDirty(false);
    savedTimerRef.current = setTimeout(() => setSaveState('idle'), 2000);
  }

  return {
    actionPending,
    restartConfirm,
    setRestartConfirm,
    errorMessage,
    setErrorMessage,
    localSkills,
    dirty,
    saveState,
    handleModelChange,
    handleCreativityChanged,
    handleRunCronJob,
    handleToggleCronJob,
    handleToggleSharedSkill,
    handleRestart,
    handleSaveAll,
  };
}
