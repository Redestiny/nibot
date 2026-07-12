import { useQueryClient } from '@tanstack/react-query';

import { getBridge, NibotBridgeError } from '../bridge';
import { appendEditorText, setEditorContent } from '../stores/editor';
import { useSessionStore, type OpenTarget } from '../stores/session';

export interface GenerationInput {
  intent: string;
  provider?: string;
}

// Runs an AI generation against the currently open book.
//
// 写新章 targets latest+1 and streams into an empty document. 续写 clears the
// view first because completeChapter's prompt asks the model for a full
// replacement chapter, not a continuation (see src/core/prompts.ts).
//
// Core only writes the chapter file after the stream finishes successfully,
// so on stop/error the on-disk state is untouched and we can roll the editor
// back by re-reading the server.
export function useGeneration() {
  const queryClient = useQueryClient();

  async function run(kind: 'write' | 'complete', input: GenerationInput): Promise<void> {
    const session = useSessionStore.getState();
    const { bookId, openTarget, generation } = session;
    const bridge = getBridge();

    if (!bookId || generation.running) {
      return;
    }

    let chapter: number;
    if (kind === 'write') {
      const chapters = await bridge.listChapters(bookId);
      chapter = (chapters.at(-1)?.number ?? 0) + 1;
    } else {
      if (openTarget?.kind !== 'chapter') {
        session.showToast('请先在左侧打开要续写的章节。', 'error');
        return;
      }
      chapter = openTarget.number;
    }

    // Editor edits must reach disk before generation reads/overwrites files.
    await session.flushSave?.();

    const previousTarget: OpenTarget | null = openTarget;
    const controller = new AbortController();
    session.startGeneration(kind, chapter, controller);
    if (kind === 'write') {
      // The target chapter doesn't exist on disk yet; the editor skips
      // loading while a generation is running for the open chapter.
      session.setOpenTarget({ kind: 'chapter', number: chapter });
    }
    setEditorContent('');

    try {
      const request = {
        chapter,
        intent: input.intent.trim().length > 0 ? input.intent.trim() : undefined,
        provider: input.provider,
      };
      const handlers = { onText: appendEditorText };

      const result =
        kind === 'write'
          ? await bridge.writeChapter(bookId, request, handlers, controller.signal)
          : await bridge.completeChapter(bookId, request, handlers, controller.signal);

      useSessionStore.getState().finishGeneration();

      // The file on disk is the source of truth (it may differ from the
      // streamed buffer); always reload after done.
      const saved = await bridge.getChapter(bookId, result.chapter);
      setEditorContent(saved.content);
      useSessionStore.getState().setSaveState('saved');

      await queryClient.invalidateQueries({ queryKey: ['chapters', bookId] });
      await queryClient.invalidateQueries({ queryKey: ['books'] });

      useSessionStore
        .getState()
        .showToast(
          kind === 'write'
            ? `第 ${result.chapter} 章已生成（${result.bytes} 字节）。`
            : `第 ${result.chapter} 章已重写（${result.bytes} 字节）。`,
        );
    } catch (error) {
      useSessionStore.getState().finishGeneration();

      const aborted = error instanceof NibotBridgeError && error.code === 'ABORTED';
      const message = aborted
        ? '已停止生成，文件未被修改。'
        : `生成失败：${error instanceof Error ? error.message : String(error)}`;
      useSessionStore.getState().showToast(message, aborted ? 'info' : 'error');

      // Nothing was written: restore what was there before.
      if (kind === 'complete') {
        try {
          const original = await bridge.getChapter(bookId, chapter);
          setEditorContent(original.content);
          useSessionStore.getState().setSaveState('idle');
        } catch {
          // Book/chapter vanished underneath us; leave the editor as-is.
        }
      } else {
        useSessionStore.getState().setOpenTarget(previousTarget);
        useSessionStore.getState().bumpReload();
      }
    }
  }

  function stop(): void {
    useSessionStore.getState().generation.abortController?.abort();
  }

  return { run, stop };
}
