'use client';

import { useActionState } from 'react';
import { Loader2 } from 'lucide-react';
import { resolverSolicitudVinculo, type ResultadoAccion } from '@/app/(app)/admin/usuarios/actions';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { listarSolicitudesVinculo } from '@/lib/altas/solicitudes';

type Solicitud = Awaited<ReturnType<typeof listarSolicitudesVinculo>>[number];

export function SolicitudesVinculo({ solicitudes }: { solicitudes: Solicitud[] }) {
  if (solicitudes.length === 0) return null;
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="solicitudes-vinculo">
      <h2 id="solicitudes-vinculo" className="text-xl">Solicitudes de vinculación</h2>
      <p className="medida text-sm text-muted-foreground">
        Verifica la identidad por una vía independiente antes de conceder acceso.
        Reconocerse en un nombre o conocer una licencia no basta. No incluyas secretos
        ni copias de documentos en la explicación.
      </p>
      <ul className="flex min-w-0 flex-col divide-y rounded-lg border bg-card px-4">
        {solicitudes.map((solicitud) => (
          <li key={solicitud.id} className="min-w-0 py-4">
            <SolicitudParaRevisar solicitud={solicitud} />
          </li>
        ))}
      </ul>
      {solicitudes.length === 50 ? (
        <p className="text-sm text-muted-foreground">Se muestran las 50 solicitudes más antiguas. Las siguientes aparecerán al resolverlas.</p>
      ) : null}
    </section>
  );
}

function SolicitudParaRevisar({ solicitud }: { solicitud: Solicitud }) {
  const [resultado, accion, pendiente] = useActionState(
    async (_anterior: ResultadoAccion | null, datos: FormData): Promise<ResultadoAccion> => {
      try {
        return await resolverSolicitudVinculo(datos);
      } catch {
        return { ok: false, error: 'No se ha podido revisar la solicitud. Recarga la bandeja antes de volver a intentarlo.' };
      }
    }, null,
  );
  const resuelta = resultado?.ok === true;
  const evidenciaId = `evidencia-${solicitud.id}`;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="break-words font-medium">{solicitud.cuenta}</p>
        <p className="break-all text-sm text-muted-foreground">{solicitud.email}</p>
        <p className="break-words text-sm">
          Solicita: {solicitud.nombreFuente ?? 'fila no disponible'}
          {solicitud.anio ? `, nació en ${solicitud.anio}` : ''} ({solicitud.clave})
        </p>
      </div>
      {resuelta ? null : (
        <form action={accion} className="flex min-w-0 flex-col gap-3">
          <input type="hidden" name="solicitudId" value={solicitud.id} />
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor={evidenciaId}>Cómo se verificó la identidad, o motivo del rechazo</Label>
            <textarea id={evidenciaId} name="evidencia" required minLength={20} maxLength={1000}
              rows={3} disabled={pendiente}
              className="medida min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-describedby={resultado && !resultado.ok ? `fallo-${solicitud.id}` : undefined}
              aria-invalid={resultado?.ok === false} />
          </div>
          <label className="medida flex min-h-11 items-start gap-2 text-sm">
            <input type="checkbox" name="verificada" value="si" disabled={pendiente}
              className="mt-1 size-4 shrink-0" />
            He verificado la identidad por una vía independiente del nombre o la licencia publicados.
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="decision" value="aprobar" disabled={pendiente} className="min-h-11">
              {pendiente ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Aprobar vinculación
            </Button>
            <Button type="submit" name="decision" value="rechazar" variant="outline"
              disabled={pendiente} className="min-h-11">Rechazar solicitud</Button>
          </div>
        </form>
      )}
      {resultado ? (
        <p id={`fallo-${solicitud.id}`} role={resultado.ok ? 'status' : 'alert'}
          className={resultado.ok ? 'medida text-sm' : 'medida text-sm text-danger'}>
          {resultado.ok ? resultado.message : resultado.error}
        </p>
      ) : null}
    </div>
  );
}
