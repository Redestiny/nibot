import { useQueryClient } from '@tanstack/react-query';

import { useChapters } from '../api/queries';
import { getBridge } from '../bridge';
import { useSessionStore } from '../stores/session';
import { chapterLabel, SETTING_FILENAMES, SETTING_LABELS } from './labels';

export function Sidebar() {
  const queryClient = useQueryClient();
  const bookId = useSessionStore((state) => state.bookId);
  const openTarget = useSessionStore((state) => state.openTarget);
  const generation = useSessionStore((state) => state.generation);
  const setOpenTarget = useSessionStore((state) => state.setOpenTarget);
  const chapters = useChapters(bookId);

  const switchDisabled = generation.running;

  const openChapter = async (chapterNumber: number) => {
    if (switchDisabled) {
      return;
    }
    setOpenTarget({ kind: 'chapter', number: chapterNumber });
  };

  const createChapter = async () => {
    if (!bookId || switchDisabled) {
      return;
    }
    await useSessionStore.getState().flushSave?.();
    const existing = await getBridge().listChapters(bookId);
    const next = (existing.at(-1)?.number ?? 0) + 1;
    try {
      await getBridge().saveChapter(bookId, next, '');
      await queryClient.invalidateQueries({ queryKey: ['chapters', bookId] });
      await queryClient.invalidateQueries({ queryKey: ['books'] });
      setOpenTarget({ kind: 'chapter', number: next });
    } catch (error) {
      useSessionStore
        .getState()
        .showToast(
          `新建章节失败：${error instanceof Error ? error.message : String(error)}`,
          'error',
        );
    }
  };

  if (!bookId) {
    return (
      <aside className="sidebar">
        <p className="sidebar-empty">先在顶栏选择或新建一本书。</p>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-heading">章节</div>
        <ul className="sidebar-list">
          {(chapters.data ?? []).map((chapter) => {
            const isActive =
              openTarget?.kind === 'chapter' && openTarget.number === chapter.number;
            const isGenerating = generation.running && generation.chapter === chapter.number;
            return (
              <li key={chapter.number}>
                <button
                  type="button"
                  className={`sidebar-item${isActive ? ' active' : ''}`}
                  disabled={switchDisabled}
                  onClick={() => void openChapter(chapter.number)}
                >
                  {chapterLabel(chapter.number)}
                  {isGenerating ? <span className="sidebar-badge">生成中</span> : null}
                </button>
              </li>
            );
          })}
          {generation.running &&
          generation.kind === 'write' &&
          generation.chapter !== null &&
          !(chapters.data ?? []).some((chapter) => chapter.number === generation.chapter) ? (
            <li>
              <button type="button" className="sidebar-item active" disabled>
                {chapterLabel(generation.chapter)}
                <span className="sidebar-badge">生成中</span>
              </button>
            </li>
          ) : null}
        </ul>
        <button
          type="button"
          className="btn sidebar-create"
          disabled={switchDisabled}
          onClick={() => void createChapter()}
        >
          + 新建章节
        </button>
      </div>
      <div className="sidebar-section">
        <div className="sidebar-heading">设定文件</div>
        <ul className="sidebar-list">
          {SETTING_FILENAMES.map((filename) => {
            const isActive = openTarget?.kind === 'setting' && openTarget.filename === filename;
            return (
              <li key={filename}>
                <button
                  type="button"
                  className={`sidebar-item${isActive ? ' active' : ''}`}
                  disabled={switchDisabled}
                  onClick={() => setOpenTarget({ kind: 'setting', filename })}
                >
                  {SETTING_LABELS[filename]}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
