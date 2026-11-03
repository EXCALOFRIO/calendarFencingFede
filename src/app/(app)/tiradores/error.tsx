'use client';

import { PantallaError } from '@/components/admin/pantalla-error';

export default function ErrorTiradores({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <PantallaError titulo="Tiradores" error={error} reintentar={retry} />;
}
