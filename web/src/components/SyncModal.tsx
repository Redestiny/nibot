import { useEffect, useRef, useState } from 'react';

import type { SyncPreviewDto } from '@shared/bridge';

import { getBridge } from '../bridge';
import { useSessionStore } from '../stores/session';
import { Modal } from './Modal';

type SyncPhase =
  | { step: 'loading' }
  | { step: 'preview'; preview: SyncPreviewDto }
  | { step: 'applying'; preview: SyncPreviewDto }
  | { step: 'error'; message: string };

export function SyncModal() {
  const [phase, setPhase] = useState<SyncPhase>({ step: 'loading' });
  const controllerRef = useRef<AbortController | null>(null);

  const bookId = useSessionStore((state) => state.bookId);
  const closeModal = useSessionStore((state) => state.closeModal);

  useEffect(() => {
    if (!bookId) {
      closeModal();
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;

    void (async () => {
      try {
        await useSessionStore.getState().flushSave?.();
        const preview = await getBridge().prepareSync(bookId, undefined, controller.signal);
        setPhase({ step: 'preview', preview });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setPhase({
          step: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return () => controller.abort();
  }, [bookId, closeModal]);

  const apply = async () => {
    if (phase.step !== 'preview' || !bookId) {
      return;
    }
    setPhase({ step: 'applying', preview: phase.preview });
    try {
      const applied = await getBridge().applySync(bookId, phase.preview.update);
      const session = useSessionStore.getState();
      session.showToast(`已更新 ${applied.updated_files.join('、')}。`);
      if (session.openTarget?.kind === 'setting') {
        session.bumpReload();
      }
      closeModal();
    } catch (error) {
      setPhase({
        step: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const renderBody = () => {
    switch (phase.step) {
      case 'loading':
        return (
          <div className="sync-loading">
            <p>正在根据最新章节分析设定变化……</p>
            <button type="button" className="btn" onClick={closeModal}>
              取消
            </button>
          </div>
        );
      case 'error':
        return (
          <div className="sync-error">
            <p className="form-error">{phase.message}</p>
            <div className="form-actions">
              <button type="button" className="btn" onClick={closeModal}>
                关闭
              </button>
            </div>
          </div>
        );
      case 'preview':
      case 'applying': {
        const { preview } = phase;
        if (preview.changed_files.length === 0) {
          return (
            <div className="sync-empty">
              <p>没有检测到设定变化，world_state 与 characters 均无需更新。</p>
              <div className="form-actions">
                <button type="button" className="btn" onClick={closeModal}>
                  关闭
                </button>
              </div>
            </div>
          );
        }
        return (
          <div className="sync-preview">
            {preview.summary ? <p className="sync-summary">{preview.summary}</p> : null}
            <p className="sync-meta">
              基于第 {preview.chapter} 章 · provider：{preview.provider} · 变更：
              {preview.changed_files.join('、')}
            </p>
            <DiffView diff={preview.diff} />
            <div className="form-actions">
              <button type="button" className="btn" onClick={closeModal}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={phase.step === 'applying'}
                onClick={() => void apply()}
              >
                {phase.step === 'applying' ? '应用中…' : '应用更改'}
              </button>
            </div>
          </div>
        );
      }
    }
  };

  return (
    <Modal title="设定同步" onClose={closeModal} wide>
      {renderBody()}
    </Modal>
  );
}

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="diff-view">
      {diff.split('\n').map((line, index) => (
        <span key={index} className={diffLineClass(line)}>
          {line}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

function diffLineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return 'diff-add';
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return 'diff-del';
  }
  if (line.startsWith('@@')) {
    return 'diff-hunk';
  }
  if (
    line.startsWith('Index:') ||
    line.startsWith('===') ||
    line.startsWith('---') ||
    line.startsWith('+++')
  ) {
    return 'diff-meta';
  }
  return 'diff-context';
}
