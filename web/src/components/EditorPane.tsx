import { useCallback, useEffect, useRef } from 'react';

import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { useQueryClient } from '@tanstack/react-query';

import { getBridge } from '../bridge';
import {
  getEditorContent,
  programmaticChange,
  registerEditorView,
  setEditorContent,
} from '../stores/editor';
import { useSessionStore, type OpenTarget } from '../stores/session';
import { targetLabel } from './labels';

const AUTOSAVE_DELAY_MS = 1500;

const proseTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '17px',
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-serif)',
    lineHeight: '2.1',
    padding: '40px 0 120px',
  },
  '.cm-content': {
    maxWidth: '44em',
    margin: '0 auto',
    padding: '0 56px',
    caretColor: 'var(--accent)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--selection) !important',
  },
  '.cm-placeholder': { color: 'var(--text-dim)' },
});

export function EditorPane() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartment = useRef(new Compartment());
  const saveTimerRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  // The target the current document belongs to; saves always go here, not to
  // whatever the sidebar has since selected.
  const currentRef = useRef<{ bookId: string; target: OpenTarget } | null>(null);
  const saveNowRef = useRef<() => Promise<void>>(async () => {});

  const queryClient = useQueryClient();
  const bookId = useSessionStore((state) => state.bookId);
  const openTarget = useSessionStore((state) => state.openTarget);
  const saveState = useSessionStore((state) => state.saveState);
  const generation = useSessionStore((state) => state.generation);
  const reloadCounter = useSessionStore((state) => state.reloadCounter);

  const locked = generation.running;

  const saveNow = useCallback(async () => {
    const current = currentRef.current;
    if (!current || !dirtyRef.current) {
      return;
    }
    if (useSessionStore.getState().generation.running) {
      // Autosave is suspended while AI output is streaming.
      return;
    }

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    dirtyRef.current = false;
    useSessionStore.getState().setSaveState('saving');

    try {
      const content = getEditorContent();
      if (current.target.kind === 'chapter') {
        const result = await getBridge().saveChapter(
          current.bookId,
          current.target.number,
          content,
        );
        if (result.created) {
          await queryClient.invalidateQueries({ queryKey: ['chapters', current.bookId] });
          await queryClient.invalidateQueries({ queryKey: ['books'] });
        }
      } else {
        await getBridge().saveSetting(current.bookId, current.target.filename, content);
      }
      if (!dirtyRef.current) {
        useSessionStore.getState().setSaveState('saved');
      }
    } catch (error) {
      dirtyRef.current = true;
      useSessionStore.getState().setSaveState('error');
      useSessionStore
        .getState()
        .showToast(
          `保存失败：${error instanceof Error ? error.message : String(error)}`,
          'error',
        );
    }
  }, [queryClient]);

  saveNowRef.current = saveNow;

  useEffect(() => {
    useSessionStore.getState().registerFlushSave(() => saveNowRef.current());
    return () => useSessionStore.getState().registerFlushSave(null);
  }, []);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: '',
        extensions: [
          history(),
          markdown(),
          EditorView.lineWrapping,
          placeholder('从这里开始写作……'),
          proseTheme,
          readOnlyCompartment.current.of([
            EditorState.readOnly.of(false),
            EditorView.editable.of(true),
          ]),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                void saveNowRef.current();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) {
              return;
            }
            const isProgrammatic = update.transactions.some((transaction) =>
              transaction.annotation(programmaticChange),
            );
            if (isProgrammatic) {
              return;
            }
            dirtyRef.current = true;
            useSessionStore.getState().setSaveState('dirty');
            if (saveTimerRef.current !== null) {
              window.clearTimeout(saveTimerRef.current);
            }
            saveTimerRef.current = window.setTimeout(() => {
              saveTimerRef.current = null;
              void saveNowRef.current();
            }, AUTOSAVE_DELAY_MS);
          }),
        ],
      }),
    });

    viewRef.current = view;
    registerEditorView(view);

    return () => {
      registerEditorView(null);
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure([
        EditorState.readOnly.of(locked),
        EditorView.editable.of(!locked),
      ]),
    });
  }, [locked]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Persist edits belonging to the previous target before loading the next.
      if (dirtyRef.current) {
        await saveNowRef.current();
      }

      if (!bookId || !openTarget) {
        currentRef.current = null;
        dirtyRef.current = false;
        setEditorContent('');
        return;
      }

      const { generation: activeGeneration } = useSessionStore.getState();
      if (
        activeGeneration.running &&
        openTarget.kind === 'chapter' &&
        activeGeneration.chapter === openTarget.number
      ) {
        // A generation is streaming into this chapter; its text arrives via
        // appendEditorText and the definitive content is reloaded on done.
        currentRef.current = { bookId, target: openTarget };
        dirtyRef.current = false;
        return;
      }

      try {
        let content: string;
        if (openTarget.kind === 'chapter') {
          content = (await getBridge().getChapter(bookId, openTarget.number)).content;
        } else {
          const settings = await getBridge().getSettings(bookId);
          content = settings.find((item) => item.filename === openTarget.filename)?.content ?? '';
        }
        if (cancelled) {
          return;
        }
        currentRef.current = { bookId, target: openTarget };
        dirtyRef.current = false;
        setEditorContent(content);
        useSessionStore.getState().setSaveState('idle');
        viewRef.current?.focus();
      } catch (error) {
        if (!cancelled) {
          useSessionStore
            .getState()
            .showToast(
              `加载内容失败：${error instanceof Error ? error.message : String(error)}`,
              'error',
            );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bookId, openTarget, reloadCounter]);

  const saveLabel = {
    idle: '',
    dirty: '未保存',
    saving: '保存中…',
    saved: '已保存',
    error: '保存失败',
  }[saveState];

  return (
    <section className="editor-pane">
      <header className="editor-header">
        <div className="editor-title">
          {bookId && openTarget ? targetLabel(openTarget) : '未打开内容'}
        </div>
        <div className="editor-status">
          {locked ? <span className="editor-lock">AI 正在写作，编辑已锁定</span> : null}
          {saveLabel ? <span className={`save-state save-${saveState}`}>{saveLabel}</span> : null}
        </div>
      </header>
      {/* Always mounted so the EditorView is created once; hidden without a target. */}
      <div className="editor-host" ref={containerRef} hidden={!(bookId && openTarget)} />
      {bookId && openTarget ? null : (
        <div className="editor-empty">
          <p>在左侧选择或新建一个章节开始写作。</p>
          <p className="editor-empty-hint">章节与设定文件都以 Markdown 保存在书籍目录中。</p>
        </div>
      )}
    </section>
  );
}
