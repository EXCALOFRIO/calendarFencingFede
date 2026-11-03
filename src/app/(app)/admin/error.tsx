'use client';

import { PantallaError } from '@/components/admin/pantalla-error';

export default function ErrorGestion({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <PantallaError titulo="Gestión" error={error} reintentar={retry} />;
}
