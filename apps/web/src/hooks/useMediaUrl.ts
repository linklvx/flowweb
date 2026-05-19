import { useState, useEffect } from 'react';
import { getMediaUrl } from '@/api/mediaApi';

export function useMediaUrl(fileId: string | null | undefined): {
  url: string | null;
  loading: boolean;
  error: Error | null;
} {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!fileId) {
      setUrl(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    getMediaUrl(fileId)
      .then((res) => setUrl(res.url))
      .catch((err) => setError(err instanceof Error ? err : new Error(String(err))))
      .finally(() => setLoading(false));
  }, [fileId]);

  return { url, loading, error };
}
