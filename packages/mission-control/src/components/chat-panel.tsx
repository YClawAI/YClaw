'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useChatStore } from '@/stores/chat-store';

async function postMessage(
  message: string,
  images: string[],
  history: Array<{ role: string; content: string }>,
  signal: AbortSignal,
  onToken?: (token: string) => void,
): Promise<string> {
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        images: images.length > 0 ? images : undefined,
        history: history.length > 0 ? history : undefined,
        stream: true,
      }),
      signal,
    });
    if (!res.ok) return '[Gateway unreachable]';

    // If streaming response
    if (res.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        // Check abort before each read
        if (signal.aborted) {
          reader.cancel().catch(() => { /* noop */ });
          return fullText || '[interrupted]';
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last element — it may be an incomplete line
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          try {
            const json = JSON.parse(line.slice(6));
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              onToken?.(fullText);
            }
          } catch { /* incomplete JSON — will be retried when more data arrives */ }
        }
      }
      // Process any remaining buffered data
      if (buffer.startsWith('data: ') && buffer !== 'data: [DONE]') {
        try {
          const json = JSON.parse(buffer.slice(6));
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            onToken?.(fullText);
          }
        } catch { /* final incomplete chunk — safe to drop */ }
      }
      return fullText || '[No response]';
    }

    // Non-streaming fallback
    const data = await res.json();
    return data.reply || '[No response]';
  } catch (err) {
    // AbortError is expected when user interrupts — not a real error
    if (err instanceof Error && err.name === 'AbortError') {
      return '';
    }
    return '[Connection error]';
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function compressImage(dataUrl: string, maxDim = 2048, quality = 0.85): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      if (img.width <= maxDim && img.height <= maxDim) {
        canvas.width = img.width;
        canvas.height = img.height;
      } else {
        const scale = maxDim / Math.max(img.width, img.height);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
      }
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl); // fallback to original on error
    img.src = dataUrl;
  });
}

export function ChatPanel({ compact = false, pageContext, embedded = false }: { compact?: boolean; pageContext?: string; embedded?: boolean }) {
  const messages = useChatStore((s) => s.messages);
  const addMessage = useChatStore((s) => s.addMessage);
  const markLastAssistantInterrupted = useChatStore((s) => s.markLastAssistantInterrupted);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const hydrated = useChatStore((s) => s.hydrated);
  const hydrate = useChatStore((s) => s.hydrate);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  // AbortController for the current in-flight SSE stream
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrated, hydrate]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  // Abort any in-flight stream on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const addImages = useCallback(async (files: FileList | File[]) => {
    const newImages: string[] = [];
    for (const file of Array.from(files)) {
      if (!ALLOWED_TYPES.has(file.type)) continue;
      if (file.size > MAX_IMAGE_SIZE) continue;
      if (images.length + newImages.length >= 4) break; // max 4 images
      try {
        const dataUrl = await fileToBase64(file);
        newImages.push(dataUrl);
      } catch {
        // skip failed reads
      }
    }
    if (newImages.length > 0) {
      setImages(prev => [...prev, ...newImages].slice(0, 4));
    }
  }, [images.length]);

  const removeImage = useCallback((index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text && images.length === 0) return;

    // If a stream is active, abort it and mark the partial response as interrupted
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      markLastAssistantInterrupted();
      setStreamingContent('');
      setStreaming(false);
    }

    addMessage({
      role: 'user',
      content: text || '(image)',
      images: images.length > 0 ? [...images] : undefined,
    });
    setInput('');
    const sentImages = [...images];
    setImages([]);
    setStreaming(true);
    setStreamingContent('');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const compressedImages = await Promise.all(sentImages.map((img) => compressImage(img)));

    const recent = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));

    const contextPrefix = pageContext ? `[Context: ${pageContext}]\n\n` : '';
    const reply = await postMessage(
      contextPrefix + (text || 'What is in this image?'),
      compressedImages,
      recent,
      controller.signal,
      (partial) => {
        setStreamingContent(partial);
      },
    );

    // Only commit the reply if this controller is still the active one
    // (i.e. it wasn't aborted by a subsequent send)
    if (abortControllerRef.current === controller) {
      abortControllerRef.current = null;
      setStreamingContent('');
      if (reply) {
        addMessage({ role: 'assistant', content: reply });
      }
      setStreaming(false);
    }
  }, [input, images, pageContext, messages, addMessage, markLastAssistantInterrupted]);

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      void addImages(e.dataTransfer.files);
    }
  }, [addImages]);

  // Paste handler for images
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      void addImages(imageFiles);
    }
  }, [addImages]);

  return (
    <div
      className={`relative flex flex-col ${
        embedded ? 'h-full' : `border border-mc-border rounded-panel bg-mc-bg ${compact ? 'h-48' : 'h-[500px]'}`
      }`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {!embedded && (
        <div className="px-3 py-2 border-b border-mc-border flex items-center gap-2">
          <span className="text-sm">🚀</span>
          <span className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-accent">Chat with Assistant</span>
          <span className="ml-auto flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={clearMessages}
                className="font-sans text-[10px] uppercase tracking-label text-mc-text-tertiary hover:text-mc-danger transition-colors duration-mc ease-mc-out"
              >
                Clear
              </button>
            )}
            <span className="font-sans text-[10px] text-mc-text-tertiary">OpenClaw Gateway</span>
          </span>
        </div>
      )}

      {/* Drop overlay */}
      {dragging && (
        <div className="absolute inset-0 z-10 bg-mc-accent/10 border-2 border-dashed border-mc-accent rounded-panel flex items-center justify-center">
          <span className="font-sans text-sm uppercase tracking-label text-mc-accent">Drop image here</span>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !streaming && (
          <div className="font-sans text-mc-text-tertiary text-xs text-center py-8">
            Send a message...
            <div className="mt-1 text-[10px]">Drop or paste images to include them</div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] px-3 py-2 rounded-panel font-sans text-xs transition-opacity ${
                msg.role === 'user'
                  ? 'bg-mc-accent/15 border border-mc-accent/30 text-mc-text'
                  : msg.interrupted
                    ? 'bg-mc-surface border border-mc-border text-mc-text opacity-50'
                    : 'bg-mc-surface border border-mc-border text-mc-text'
              }`}
            >
              {msg.images && msg.images.length > 0 && (
                <div className="flex gap-1 mb-1.5 flex-wrap">
                  {msg.images.map((img, j) => (
                    // eslint-disable-next-line @next/next/no-img-element -- base64 data URLs from FileReader; next/image optimization doesn't apply
                    <img
                      key={j}
                      src={img}
                      alt="attached"
                      className="w-24 h-24 object-cover rounded-panel border border-mc-border"
                    />
                  ))}
                </div>
              )}
              <div className="whitespace-pre-wrap">{msg.content}</div>
              <div className="font-mono tabular-nums text-[10px] text-mc-text-tertiary mt-1 flex items-center gap-1.5">
                <span>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                {msg.interrupted && (
                  <span className="italic text-mc-text-tertiary">[interrupted]</span>
                )}
              </div>
            </div>
          </div>
        ))}
        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[80%] bg-mc-surface border border-mc-border px-3 py-2 rounded-panel font-sans text-xs text-mc-text">
              {streamingContent ? (
                <div className="whitespace-pre-wrap">{streamingContent}<span className="animate-mc-pulse">|</span></div>
              ) : (
                <div className="text-mc-text-tertiary animate-mc-pulse">Thinking...</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Image previews */}
      {images.length > 0 && (
        <div className="px-2 py-1.5 border-t border-mc-border flex gap-1.5 bg-mc-surface/50">
          {images.map((img, i) => (
            <div key={i} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element -- base64 data URLs from FileReader; next/image optimization doesn't apply */}
              <img
                src={img}
                alt="preview"
                className="w-12 h-12 object-cover rounded-panel border border-mc-border"
              />
              <button
                onClick={() => removeImage(i)}
                className="absolute -top-1 -right-1 w-4 h-4 bg-mc-danger text-white text-[10px] rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-mc ease-mc-out"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="p-2 border-t border-mc-border bg-mc-surface/50">
        <div className="flex gap-2 items-end">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 p-1.5 text-mc-text-tertiary hover:text-mc-text transition-colors duration-mc ease-mc-out"
            title="Attach image"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void addImages(e.target.files);
              e.target.value = '';
            }}
          />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            onPaste={handlePaste}
            placeholder={streaming ? 'Type to interrupt...' : 'Message assistant...'}
            rows={1}
            className="flex-1 bg-transparent font-sans text-xs text-mc-text placeholder-mc-text-tertiary resize-none outline-none py-1.5 max-h-24 overflow-y-auto"
            style={{ minHeight: '28px' }}
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() && images.length === 0}
            className={`shrink-0 px-2.5 py-1.5 font-sans text-[11px] uppercase tracking-label rounded-panel transition-colors duration-mc ease-mc-out ${
              streaming
                ? 'bg-mc-warning/15 text-mc-warning hover:bg-mc-warning/25 border border-mc-warning/40'
                : 'bg-mc-accent/15 text-mc-accent hover:bg-mc-accent/25 border border-mc-accent/40'
            } disabled:opacity-30 disabled:cursor-not-allowed`}
            title={streaming ? 'Send (interrupts current response)' : 'Send'}
          >
            {streaming ? '⚡ Send' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
