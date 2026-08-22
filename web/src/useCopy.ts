import { useCallback, useState } from 'react';

export function useCopy(resetAfterMs = 1500): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    (text: string) => {
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), resetAfterMs);
      });
    },
    [resetAfterMs],
  );

  return [copied, copy];
}
