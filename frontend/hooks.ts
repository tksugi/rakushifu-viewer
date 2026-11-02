import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppData } from './data';
import type { Descriptor, Entry } from './types';

export function useDebounced<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return debounced;
}

export function useView<T>(app: AppData, descriptor: Descriptor, enabled: boolean) {
  const query = useQuery({
    ...app.options<T>(descriptor), enabled: enabled && !app.ended,
    refetchInterval: q => {
      if (!enabled || app.ended) return false;
      const error = q.state.error as (Error & { status?: number }) | null;
      if (error?.status === 400 || error?.status === 404) return false;
      if (error) return Math.min(120000, 30000 * 2 ** Math.max(0, (app.failures.get(descriptor.key) ?? 1) - 1));
      const entry = q.state.data as Entry<T> | undefined;
      return entry ? Math.max(1000, entry.invalid ? 1000 : entry.expiresAt - Date.now()) : false;
    },
    refetchIntervalInBackground: false,
  });
  // A previously accessible staff member may have left the allowed scope.
  const revoked = (query.error as (Error & { status?: number }) | null)?.status === 404;
  return { ...query, value: revoked ? undefined : query.data?.data, revoked };
}
