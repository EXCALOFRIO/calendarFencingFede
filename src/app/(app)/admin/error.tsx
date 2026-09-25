'use client';

import { PantallaError } from '@/components/admin/pantalla-error';

export default function ErrorGestion({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PantallaError titulo="Gestión" error={error} reintentar={reset} />;
}
