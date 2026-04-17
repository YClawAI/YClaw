'use client';

import { useState, useCallback, useEffect } from 'react';
import { ProgressSidebar } from './components/ProgressSidebar';
import { ConversationFlow } from './components/ConversationFlow';
import { ArtifactPreview } from './components/ArtifactPreview';
import { AssetDropZone } from './components/AssetDropZone';

interface OnboardingStatus {
  active: boolean;
  sessionId?: string;
  stage?: string;
  currentQuestion?: number;
  totalQuestionsInStage?: number;
  artifactCount?: number;
  approvedArtifactCount?: number;
  assetCount?: number;
  status?: string;
  currentQuestionData?: QuestionResponse | null;
}

interface QuestionResponse {
  questionId: string;
  prompt: string;
  helpText: string;
  defaultAnswer?: string;
  followUp?: string;
  stageComplete: boolean;
}

interface ArtifactDraft {
  id: string;
  type: string;
  filename: string;
  content: string;
  status: 'draft' | 'approved' | 'rejected';
}

interface Props {
  initialStatus: OnboardingStatus;
  initialError?: string;
}

export function OnboardingClient({ initialStatus, initialError }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [currentQuestion, setCurrentQuestion] = useState<QuestionResponse | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactDraft[]>([]);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);

  // #12: Resume session on load — restore current question from status
  useEffect(() => {
    if (initialStatus.active && initialStatus.currentQuestionData) {
      setCurrentQuestion(initialStatus.currentQuestionData);
    }
  }, [initialStatus.active, initialStatus.currentQuestionData]);

  const refreshStatus = useCallback(async (sessionId: string) => {
    const res = await fetch(`/api/onboarding?sessionId=${sessionId}`);
    if (res.ok) {
      const data = await res.json();
      setStatus(data);
    }
  }, []);

  const startOnboarding = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const res = await fetch('/api/onboarding', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setStatus({ active: true, sessionId: data.sessionId, stage: 'org_framing' });
      setCurrentQuestion(data.question);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start onboarding');
    } finally {
      setLoading(false);
    }
  }, []);

  const submitAnswer = useCallback(async (questionId: string, answer: string) => {
    if (!status.sessionId) return;
    setLoading(true);
    setError(undefined);
    try {
      const res = await fetch('/api/onboarding/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: status.sessionId, questionId, answer }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setCurrentQuestion(data.question);
      if (data.artifactsGenerated?.length) {
        // #15: Replace artifacts of same type instead of unconditional append
        setArtifacts(prev => {
          const newTypes = new Set(data.artifactsGenerated.map((a: ArtifactDraft) => a.type));
          const filtered = prev.filter(a => !newTypes.has(a.type));
          return [...filtered, ...data.artifactsGenerated];
        });
      }
      await refreshStatus(status.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit answer');
    } finally {
      setLoading(false);
    }
  }, [status.sessionId, refreshStatus]);

  // #5: No more silent exception swallowing — set error state on failure
  const approveArtifact = useCallback(async (artifactId: string) => {
    if (!status.sessionId) return;
    setError(undefined);
    try {
      const res = await fetch(`/api/onboarding/artifacts?action=approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: status.sessionId, artifactId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Failed to approve artifact');
        return;
      }
      setArtifacts(prev => prev.map(a =>
        a.id === artifactId ? { ...a, status: 'approved' as const } : a,
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve artifact');
    }
  }, [status.sessionId]);

  const rejectArtifact = useCallback(async (artifactId: string) => {
    if (!status.sessionId) return;
    setError(undefined);
    try {
      const res = await fetch(`/api/onboarding/artifacts?action=reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: status.sessionId, artifactId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Failed to reject artifact');
        return;
      }
      setArtifacts(prev => prev.map(a =>
        a.id === artifactId ? { ...a, status: 'rejected' as const } : a,
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject artifact');
    }
  }, [status.sessionId]);

  const resetSession = useCallback(async () => {
    if (!confirm('Are you sure you want to start over? All progress will be lost.')) return;
    setError(undefined);
    try {
      const res = await fetch(`/api/onboarding/session?sessionId=${status.sessionId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Failed to reset session');
        return;
      }
      setStatus({ active: false });
      setCurrentQuestion(null);
      setArtifacts([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset session');
    }
  }, [status.sessionId]);

  if (!status.active) {
    return (
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-sm font-bold text-mc-text mb-2">Onboarding</h1>
          <p className="text-xs text-mc-text-tertiary mb-6">
            Set up your AI organization. Answer a few questions, import context documents,
            and configure departments. All generated artifacts require your approval.
          </p>
          {error && (
            <div className="bg-mc-danger/10 border border-mc-danger/30 rounded p-3 mb-4">
              <p className="text-xs text-mc-danger">{error}</p>
            </div>
          )}
          <button
            onClick={startOnboarding}
            disabled={loading}
            className="px-4 py-2 text-xs font-mono rounded border bg-mc-accent/20 text-mc-accent border-mc-accent/40 hover:bg-mc-accent/30 transition-colors disabled:opacity-50"
          >
            {loading ? 'Starting...' : 'Begin Onboarding'}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto p-6">
      <div className="flex gap-6 max-w-6xl mx-auto">
        <div className="w-56 shrink-0">
          <ProgressSidebar
            stage={status.stage ?? 'org_framing'}
            artifactCount={status.artifactCount ?? 0}
            approvedCount={status.approvedArtifactCount ?? 0}
            assetCount={status.assetCount ?? 0}
            onReset={resetSession}
          />
        </div>
        <div className="flex-1 space-y-6">
          {error && (
            <div className="bg-mc-danger/10 border border-mc-danger/30 rounded p-3">
              <p className="text-xs text-mc-danger">{error}</p>
            </div>
          )}
          {currentQuestion && (
            <ConversationFlow question={currentQuestion} onSubmit={submitAnswer} loading={loading} />
          )}
          {status.stage === 'ingestion' && status.sessionId && (
            <AssetDropZone sessionId={status.sessionId} />
          )}
          {artifacts.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary">Generated Artifacts</h2>
              {artifacts.map(artifact => (
                <ArtifactPreview
                  key={artifact.id}
                  artifact={artifact}
                  onApprove={() => approveArtifact(artifact.id)}
                  onReject={() => rejectArtifact(artifact.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
