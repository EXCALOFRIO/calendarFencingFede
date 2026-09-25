'use client';

import { PantallaError } from '@/components/admin/pantalla-error';

export default function ErrorTiradores({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PantallaError titulo="Tiradores" error={error} reintentar={reset} />;
}
