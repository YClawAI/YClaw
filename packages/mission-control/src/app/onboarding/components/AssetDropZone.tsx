'use client';

import { useState, useCallback } from 'react';

interface Props {
  sessionId: string;
}

export function AssetDropZone({ sessionId }: Props) {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');

  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setMessage(null);

    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('sessionId', sessionId);

      try {
        const res = await fetch('/api/onboarding/ingest', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          setMessage(`Failed: ${data.error}`);
        } else {
          setMessage(`Imported: ${file.name}`);
        }
      } catch (err) {
        setMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
    setUploading(false);
  }, [sessionId]);

  const handleUrlImport = useCallback(async () => {
    if (!urlInput.trim()) return;
    setUploading(true);
    setMessage(null);

    try {
      const isGitHub = urlInput.includes('github.com');
      const endpoint = isGitHub ? '/api/onboarding/ingest?type=github' : '/api/onboarding/ingest?type=url';

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isGitHub
          ? { sessionId, repoUrl: urlInput }
          : { sessionId, url: urlInput },
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`Failed: ${data.error}`);
      } else {
        setMessage(`Imported: ${urlInput}`);
        setUrlInput('');
      }
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
    setUploading(false);
  }, [sessionId, urlInput]);

  return (
    <div className="space-y-4">
      <h2 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary">
        Import Context
      </h2>

      {/* File upload */}
      <div
        className="border-2 border-dashed border-mc-border rounded p-6 text-center hover:border-mc-accent/50 transition-colors cursor-pointer"
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); handleFileUpload(e.dataTransfer.files); }}
        onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.multiple = true;
          input.accept = '.pdf,.docx,.txt,.md,.csv,.json,.yaml,.yml,.png,.jpg,.jpeg';
          input.onchange = () => handleFileUpload(input.files);
          input.click();
        }}
      >
        <p className="text-xs text-mc-text-tertiary">
          {uploading ? 'Uploading...' : 'Drop files here or click to upload'}
        </p>
        <p className="text-[10px] text-mc-text-tertiary/60 mt-1">
          PDF, DOCX, TXT, MD, CSV, JSON, YAML — max 10MB per file
        </p>
      </div>

      {/* URL import */}
      <div className="flex gap-2">
        <input
          type="text"
          value={urlInput}
          onChange={e => setUrlInput(e.target.value)}
          placeholder="Paste URL or GitHub repo link..."
          className="flex-1 bg-mc-bg border border-mc-border rounded px-3 py-1.5 text-xs text-mc-text placeholder-mc-text-tertiary focus:outline-none focus:border-mc-accent font-mono"
          disabled={uploading}
        />
        <button
          onClick={handleUrlImport}
          disabled={uploading || !urlInput.trim()}
          className="px-3 py-1.5 text-xs font-mono rounded border border-mc-border text-mc-text-tertiary hover:text-mc-text transition-colors disabled:opacity-50"
        >
          Import
        </button>
      </div>

      {/* Status message */}
      {message && (
        <p className={`text-xs ${message.startsWith('Failed') || message.startsWith('Error')
          ? 'text-mc-danger' : 'text-mc-success'}`}>
          {message}
        </p>
      )}
    </div>
  );
}
