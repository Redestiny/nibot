import { create } from 'zustand';

import type { SettingFilename } from '@shared/bridge';

export type OpenTarget =
  | { kind: 'chapter'; number: number }
  | { kind: 'setting'; filename: SettingFilename };

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export type ModalKind = 'newBook' | 'providers' | 'sync' | null;

export interface GenerationState {
  running: boolean;
  kind: 'write' | 'complete' | null;
  chapter: number | null;
  abortController: AbortController | null;
}

const idleGeneration: GenerationState = {
  running: false,
  kind: null,
  chapter: null,
  abortController: null,
};

interface SessionState {
  bookId: string | null;
  openTarget: OpenTarget | null;
  saveState: SaveState;
  generation: GenerationState;
  toast: { message: string; tone: 'info' | 'error' } | null;
  modal: ModalKind;
  // Bumped to force the editor to reload its content from the server
  // (e.g. after sync rewrites the settings files).
  reloadCounter: number;
  // Registered by the editor so other flows can flush unsaved edits before
  // acting on the file.
  flushSave: (() => Promise<void>) | null;

  setBook(bookId: string | null): void;
  setOpenTarget(target: OpenTarget | null): void;
  setSaveState(state: SaveState): void;
  startGeneration(kind: 'write' | 'complete', chapter: number, controller: AbortController): void;
  finishGeneration(): void;
  showToast(message: string, tone?: 'info' | 'error'): void;
  clearToast(): void;
  openModal(modal: Exclude<ModalKind, null>): void;
  closeModal(): void;
  bumpReload(): void;
  registerFlushSave(flush: (() => Promise<void>) | null): void;
}

export const useSessionStore = create<SessionState>((set) => ({
  bookId: null,
  openTarget: null,
  saveState: 'idle',
  generation: idleGeneration,
  toast: null,
  modal: null,
  reloadCounter: 0,
  flushSave: null,

  setBook: (bookId) => set({ bookId, openTarget: null, saveState: 'idle' }),
  setOpenTarget: (openTarget) => set({ openTarget, saveState: 'idle' }),
  setSaveState: (saveState) => set({ saveState }),
  startGeneration: (kind, chapter, abortController) =>
    set({ generation: { running: true, kind, chapter, abortController } }),
  finishGeneration: () => set({ generation: idleGeneration }),
  showToast: (message, tone = 'info') => set({ toast: { message, tone } }),
  clearToast: () => set({ toast: null }),
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  bumpReload: () => set((state) => ({ reloadCounter: state.reloadCounter + 1 })),
  registerFlushSave: (flushSave) => set({ flushSave }),
}));
