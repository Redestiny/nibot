import type { createNibotApp } from '../core/app.js';

type NibotApp = ReturnType<typeof createNibotApp>;
type CreateBookResult = Awaited<ReturnType<NibotApp['createBook']>>;
type ListBooksResult = Awaited<ReturnType<NibotApp['listBooks']>>;
type BookStatusResult = Awaited<ReturnType<NibotApp['getBookStatus']>>;
type ListProvidersResult = Awaited<ReturnType<NibotApp['listProviders']>>;

export function renderBookCreatedMessage(result: CreateBookResult): string {
  return `Created book "${result.book.id}" at ${result.path}.`;
}

export function renderBookListMessage(result: ListBooksResult): string {
  if (result.length === 0) {
    return 'No books found in the current directory.';
  }

  return result
    .map(
      (book) =>
        `${book.id} (${book.chapter_count} chapters${book.latest_chapter ? `, latest ${book.latest_chapter}` : ''})`,
    )
    .join('\n');
}

export function renderBookStatusMessage(result: BookStatusResult): string {
  return [
    `Book: ${result.id}`,
    `Title: ${result.title}`,
    `Language: ${result.lang}`,
    `Chapters: ${result.chapter_count}`,
    `Latest chapter: ${result.latest_chapter ?? 'none'}`,
    `Settings: ${result.settings_files.join(', ')}`,
  ].join('\n');
}

export function renderProviderListMessage(result: ListProvidersResult): string {
  if (result.providers.length === 0) {
    return 'No providers configured.';
  }

  return result.providers
    .map((provider) => {
      const defaultTag = provider.is_default ? ' [default]' : '';
      return `${provider.name}${defaultTag} -> ${provider.model} @ ${provider.base_url} (${provider.api_key})`;
    })
    .join('\n');
}

export function renderWriteResultMessage(result: {
  action: string;
  book_id: string;
  filename: string;
  provider: string;
}): string {
  return `${result.action === 'write' ? 'Wrote' : 'Completed'} ${result.filename} for "${result.book_id}" using provider "${result.provider}".`;
}
