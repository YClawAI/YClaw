'use client';

import { useState } from 'react';

interface Question {
  questionId: string;
  prompt: string;
  helpText: string;
  defaultAnswer?: string;
  followUp?: string;
  stageComplete: boolean;
}

interface Props {
  question: Question;
  onSubmit: (questionId: string, answer: string) => void;
  loading: boolean;
}

export function ConversationFlow({ question, onSubmit, loading }: Props) {
  const [answer, setAnswer] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = answer.trim() || question.defaultAnswer || '';
    if (!text) return;
    onSubmit(question.questionId, text);
    setAnswer('');
  };

  const useDefault = () => {
    if (question.defaultAnswer) {
      onSubmit(question.questionId, question.defaultAnswer);
      setAnswer('');
    }
  };

  return (
    <div className="bg-mc-surface-hover border border-mc-border rounded p-5">
      <div className="mb-4">
        <p className="text-sm text-mc-text font-mono mb-2">{question.prompt}</p>
        <p className="text-xs text-mc-text-tertiary">{question.helpText}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          placeholder={question.defaultAnswer ?? 'Type your answer...'}
          rows={4}
          className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-xs text-mc-text placeholder-mc-text-tertiary focus:outline-none focus:border-mc-accent resize-y font-mono"
          disabled={loading}
        />

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-1.5 text-xs font-mono rounded border bg-mc-accent/20 text-mc-accent border-mc-accent/40 hover:bg-mc-accent/30 transition-colors disabled:opacity-50"
          >
            {loading ? 'Processing...' : question.stageComplete ? 'Complete Stage' : 'Continue'}
          </button>

          {question.defaultAnswer && (
            <button
              type="button"
              onClick={useDefault}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-mono rounded border border-mc-border text-mc-text-tertiary hover:text-mc-text transition-colors disabled:opacity-50"
            >
              Use recommended default
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
