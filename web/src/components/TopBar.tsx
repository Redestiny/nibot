import { useBooks } from '../api/queries';
import { useSessionStore } from '../stores/session';

export function TopBar() {
  const books = useBooks();
  const bookId = useSessionStore((state) => state.bookId);
  const generation = useSessionStore((state) => state.generation);
  const setBook = useSessionStore((state) => state.setBook);
  const openModal = useSessionStore((state) => state.openModal);
  const flushSave = useSessionStore((state) => state.flushSave);

  const switchBook = async (nextBookId: string) => {
    await flushSave?.();
    setBook(nextBookId.length > 0 ? nextBookId : null);
  };

  return (
    <header className="top-bar">
      <div className="top-bar-brand">Nibot 写作台</div>
      <select
        className="book-select"
        value={bookId ?? ''}
        disabled={generation.running}
        onChange={(event) => void switchBook(event.target.value)}
      >
        <option value="">选择书籍…</option>
        {(books.data ?? []).map((book) => (
          <option key={book.id} value={book.id}>
            {book.title}（{book.chapter_count} 章）
          </option>
        ))}
      </select>
      <button type="button" className="btn" onClick={() => openModal('newBook')}>
        新建书籍
      </button>
      <div className="top-bar-spacer" />
      <button
        type="button"
        className="btn"
        disabled={!bookId || generation.running}
        onClick={() => openModal('sync')}
        title="根据最新章节由 AI 提议 world_state / characters 的更新，确认后才写入"
      >
        设定同步
      </button>
      <button type="button" className="btn" onClick={() => openModal('providers')}>
        Provider 设置
      </button>
    </header>
  );
}
