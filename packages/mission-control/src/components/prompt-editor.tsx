'use client';

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { OrgFileResponse } from '@/components/hive/hive-types';

interface PromptEditorProps {
  filename: string;
  label: string;
  isProtected?: boolean;
}

export function PromptEditor({ filename, label, isProtected }: PromptEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fileData, setFileData] = useState<OrgFileResponse | null>(null);
  const [content, setContent] = useState('');

  const loadFile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/org/files/${encodeURIComponent(filename)}`);
      if (!res.ok) throw new Error('Failed to load file');
      const data: OrgFileResponse = await res.json();
      setFileData(data);
      setContent(data.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [filename]);

  const handleOpen = useCallback(() => {
    setIsOpen(true);
    setSuccess(null);
    loadFile();
  }, [loadFile]);

  const handleSave = useCallback(async () => {
    if (!fileData) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/org/files/${encodeURIComponent(filename)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          sha: fileData.sha,
          message: `Update ${filename} via Mission Control`,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Save failed');
      }
      const data = await res.json();
      // Update both sha and content so isDirty resets correctly
      setFileData((prev) => prev ? { ...prev, sha: data.newSha, content } : prev);
      setSuccess('Saved');
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [filename, fileData, content]);

  const isDirty = fileData ? content !== fileData.content : false;

  if (!isOpen) {
    return (
      <button
        onClick={handleOpen}
        className="w-full text-left px-2 py-1.5 rounded hover:bg-terminal-muted/30 transition-colors group flex items-center gap-2"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5 text-terminal-dim shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-terminal-text truncate">{label}</div>
          <div className="text-[10px] text-terminal-dim/60 flex items-center gap-2">
            <span className="truncate">{filename}</span>
            {isProtected && (
              <span
                className="inline-flex items-center gap-0.5 text-terminal-red shrink-0"
                title="Agents cannot edit this file, but humans can modify it here."
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-2.5 h-2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
                Protected
              </span>
            )}
          </div>
        </div>
      </button>
    );
  }

  return (
    <>
      <div className="border border-terminal-border rounded overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 bg-terminal-muted/20 border-b border-terminal-border">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-terminal-text">{label}</span>
            {isProtected && (
              <span
                className="text-[9px] px-1 py-0.5 rounded bg-terminal-red/10 text-terminal-red border border-terminal-red/20"
                title="Agents cannot edit this file, but humans can modify it here."
              >
                PROTECTED
              </span>
            )}
            {isDirty && (
              <span className="w-1.5 h-1.5 rounded-full bg-terminal-orange" title="Unsaved changes" />
            )}
          </div>
          <div className="flex items-center gap-2">
            {success && <span className="text-[10px] text-terminal-green">{success}</span>}
            {error && <span className="text-[10px] text-terminal-red">{error}</span>}
            <button
              onClick={() => setIsExpanded(true)}
              className="text-[10px] px-2 py-0.5 rounded border border-terminal-border text-terminal-dim hover:text-terminal-text hover:bg-terminal-muted/40 transition-colors"
            >
              Expand
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="text-[10px] px-2 py-0.5 rounded bg-terminal-purple/20 text-terminal-purple border border-terminal-purple/30 hover:bg-terminal-purple/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => { setIsOpen(false); setFileData(null); }}
              className="text-[10px] text-terminal-dim hover:text-terminal-text transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {/* Editor */}
        {loading ? (
          <div className="p-4 text-xs text-terminal-dim">Loading...</div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full bg-terminal-bg text-terminal-text text-xs font-mono p-3 resize-y min-h-[200px] max-h-[500px] focus:outline-none"
            style={{ tabSize: 2 }}
            spellCheck={false}
          />
        )}
      </div>

      {isExpanded &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-50 bg-black/60"
              onClick={() => setIsExpanded(false)}
            />
            <div className="fixed inset-4 sm:inset-10 z-50 flex flex-col bg-terminal-surface border border-terminal-border shadow-2xl rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border bg-terminal-muted/40">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-terminal-text">
                      {label}
                    </span>
                    {isProtected && (
                      <span
                        className="text-[9px] px-1 py-0.5 rounded bg-terminal-red/10 text-terminal-red border border-terminal-red/20"
                        title="Agents cannot edit this file, but humans can modify it here."
                      >
                        PROTECTED
                      </span>
                    )}
                    {isDirty && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-terminal-orange"
                        title="Unsaved changes"
                      />
                    )}
                  </div>
                  <div className="text-[10px] text-terminal-dim break-all">
                    {filename}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {success && (
                    <span className="text-[10px] text-terminal-green">{success}</span>
                  )}
                  {error && (
                    <span className="text-[10px] text-terminal-red">{error}</span>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={saving || !isDirty}
                    className="text-[10px] px-2 py-0.5 rounded bg-terminal-purple/20 text-terminal-purple border border-terminal-purple/30 hover:bg-terminal-purple/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => setIsExpanded(false)}
                    className="text-[12px] text-terminal-dim hover:text-terminal-text px-2 py-0.5 transition-colors"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="flex-1">
                {loading ? (
                  <div className="flex items-center justify-center h-full text-xs text-terminal-dim">
                    Loading...
                  </div>
                ) : (
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="w-full h-full bg-terminal-bg text-terminal-text text-xs font-mono p-4 resize-none focus:outline-none"
                    style={{ tabSize: 2 }}
                    spellCheck={false}
                  />
                )}
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
