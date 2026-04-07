import { create } from 'zustand';

const STORAGE_PREFIX = 'mc:chat:';
const MAX_PERSISTED = 50;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  timestamp: number;
  interrupted?: boolean;
}

interface ChatStore {
  open: boolean;
  messages: ChatMessage[];
  hydrated: boolean;
  sessionKey: string;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  setSessionKey: (key: string) => void;
  hydrate: () => void;
  addMessage: (msg: Omit<ChatMessage, 'timestamp'>) => void;
  markLastAssistantInterrupted: () => void;
  clearMessages: () => void;
}

function storageKey(session: string) {
  return `${STORAGE_PREFIX}${session}`;
}

function persistMessages(session: string, messages: ChatMessage[]) {
  try {
    const toSave = messages.slice(-MAX_PERSISTED).map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      interrupted: m.interrupted,
    }));
    localStorage.setItem(storageKey(session), JSON.stringify(toSave));
  } catch { /* noop */ }
}

export type { ChatMessage };

export const useChatStore = create<ChatStore>((set, get) => ({
  open: true,
  messages: [],
  hydrated: false,
  sessionKey: 'default',
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  setSessionKey: (key: string) => {
    const prev = get().sessionKey;
    if (key === prev) return;
    set({ sessionKey: key, hydrated: false, messages: [] });
  },
  hydrate: () => {
    if (typeof window === 'undefined') return;
    const session = get().sessionKey;
    try {
      const raw = localStorage.getItem(storageKey(session));
      const messages = raw ? (JSON.parse(raw) as ChatMessage[]) : [];
      set({ messages, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
  addMessage: (msg) =>
    set((s) => {
      const next = [...s.messages, { ...msg, timestamp: Date.now() }];
      persistMessages(s.sessionKey, next);
      return { messages: next };
    }),
  markLastAssistantInterrupted: () =>
    set((s) => {
      // Find the last assistant message that is not yet interrupted
      const idx = [...s.messages].reverse().findIndex(
        (m) => m.role === 'assistant' && !m.interrupted,
      );
      if (idx === -1) return s;
      const realIdx = s.messages.length - 1 - idx;
      const next = s.messages.map((m, i) =>
        i === realIdx ? { ...m, interrupted: true } : m,
      );
      persistMessages(s.sessionKey, next);
      return { messages: next };
    }),
  clearMessages: () => {
    const session = get().sessionKey;
    try {
      localStorage.removeItem(storageKey(session));
    } catch { /* noop */ }
    set({ messages: [] });
  },
}));
