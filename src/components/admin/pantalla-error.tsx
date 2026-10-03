'use client';

import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ERROR_SOLO_LECTURA, ERROR_VISTA_CADUCADA } from '@/lib/auth/read-only';

/**
 * Última red de seguridad de una pantalla.
 *
 * El permiso ya se recoge antes (`exigirRol`), así que aquí solo debería
 * llegar lo imprevisto: la base sin responder, una consulta rota. Aun así se
 * enseña el motivo en vez de la pantalla de error genérica de Next, porque
 * «Application error» no le dice nada a nadie y hace pensar que se han
 * perdido datos.
 */
export function PantallaError({
  titulo,
  error,
  reintentar,
}: {
  titulo: string;
  error: Error & { digest?: string };
  reintentar: () => void;
}) {
  if (error.digest === ERROR_SOLO_LECTURA || error.digest === ERROR_VISTA_CADUCADA) {
    return (
      <div className="flex flex-1 flex-col items-start justify-center gap-3 py-16">
        <h1 className="text-2xl sm:text-3xl">
          {error.digest === ERROR_VISTA_CADUCADA ? 'La vista previa ha caducado' : 'Esta vista es de solo lectura'}
        </h1>
        <p className="medida text-sm text-muted-foreground">
          No se ha guardado ningún cambio. Sal de esta vista. Para gestionar la
          aplicación, inicia sesión con una cuenta autorizada.
        </p>
        <div className="flex flex-wrap gap-2">
          <form method="post" action="/vista-previa/salir">
            <Button type="submit" className="min-h-11">Salir de la vista previa</Button>
          </form>
          <Button variant="outline" asChild className="min-h-11">
            <Link href="/vista-previa">Elegir otra vista</Link>
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-3 py-16">
      <TriangleAlert className="size-6 text-warn" aria-hidden />
      <h1 className="text-2xl sm:text-3xl">{titulo}</h1>
      <p className="medida text-sm text-muted-foreground">
        No se ha podido cargar esta pantalla. Los datos están intactos: ha
        fallado la consulta, no lo que hay guardado.
      </p>
      <p className="medida rounded-md border bg-card px-3 py-2 font-mono text-xs text-muted-foreground">
        {error.message || 'Error sin mensaje.'}
        {error.digest ? ` (${error.digest})` : ''}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button onClick={reintentar}>Volver a intentarlo</Button>
        <Button variant="outline" asChild>
          <Link href="/">Volver al calendario</Link>
        </Button>
      </div>
    </div>
  );
}
