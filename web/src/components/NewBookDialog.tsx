import { useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { getBridge } from '../bridge';
import { useSessionStore } from '../stores/session';
import { Modal } from './Modal';

export function NewBookDialog() {
  const [bookId, setBookId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const closeModal = useSessionStore((state) => state.closeModal);
  const setBook = useSessionStore((state) => state.setBook);

  const create = async () => {
    const trimmed = bookId.trim();
    if (trimmed.length === 0 || pending) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await getBridge().createBook(trimmed);
      await queryClient.invalidateQueries({ queryKey: ['books'] });
      setBook(trimmed);
      useSessionStore.getState().showToast(`书籍「${trimmed}」已创建。`);
      closeModal();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal title="新建书籍" onClose={closeModal}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label className="field">
          <span className="field-label">书籍 ID（将作为目录名）</span>
          <input
            autoFocus
            value={bookId}
            placeholder="例如：my-novel"
            onChange={(event) => setBookId(event.target.value)}
          />
        </label>
        <p className="form-hint">
          会在服务器的书籍根目录下创建 <code>{bookId.trim() || '<book-id>'}/</code>
          ，包含 settings（大纲、世界状态、角色）与 chapters 目录。
        </p>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="form-actions">
          <button type="button" className="btn" onClick={closeModal}>
            取消
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={bookId.trim().length === 0 || pending}
          >
            {pending ? '创建中…' : '创建'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
