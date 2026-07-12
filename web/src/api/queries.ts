import { useQuery } from '@tanstack/react-query';

import { getBridge } from '../bridge';

export function useBooks() {
  return useQuery({
    queryKey: ['books'],
    queryFn: () => getBridge().listBooks(),
  });
}

export function useChapters(bookId: string | null) {
  return useQuery({
    queryKey: ['chapters', bookId],
    queryFn: () => getBridge().listChapters(bookId!),
    enabled: bookId !== null,
  });
}

export function useProviders() {
  return useQuery({
    queryKey: ['providers'],
    queryFn: () => getBridge().listProviders(),
  });
}
