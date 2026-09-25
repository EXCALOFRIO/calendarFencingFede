'use client';

import { CircleAlert, CircleCheck, CircleDashed, Loader2, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SOURCE_LABEL, cn, formatDateTimeEs } from '@/lib/utils';

/**
 * Salud de la ingestión.
 *
 * Sin esta pantalla, un scraper roto pasa desapercibido durante semanas y la
 * gente decide viajes con un calendario congelado. Por eso lo primero de cada
 * fuente es CUÁNDO se leyó por última vez, no cuántas filas trajo.
 *
 * El botón de actualizar habla con `/api/admin/ingest`, que es la misma
 * ingestión del cron pero autenticada con la sesión. Puede tardar un minuto
 * largo: se dice antes de pulsarlo, no después.
 */

export type FuenteSalud = {
  source: string;
  description: string;
  ageHours: number | null;
  stale: boolean;
  latest: {
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    itemsSeen: number;
    itemsCreated: number;
    itemsUpdated: number;
    itemsQuarantined: number;
    error: string | null;
  } | null;
};

export type EjecucionFila = {
  id: string;
  source: string;
  status: string;
  startedAt: Date;
  durationMs: number | null;
  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsQuarantined: number;
  error: string | null;
  triggeredBy: string;
};

const ESTADO: Record<
  string,
  { palabra: string; color: string; icono: typeof CircleCheck }
> = {
  ok: { palabra: 'Correcta', color: 'text-ok', icono: CircleCheck },
  parcial: { palabra: 'Parcial', color: 'text-warn', icono: CircleAlert },
  error: { palabra: 'Con error', color: 'text-danger', icono: CircleAlert },
};

function antiguedad(horas: number | null): string {
  if (horas === null) return 'Todavía no se ha leído ninguna vez';
  if (horas < 1) return 'Leída hace menos de una hora';
  if (horas < 24) return `Leída hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `Leída hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

export function SaludPanel({
  fuentes,
  cuarentenaPorFuente,
  ultimas,
}: {
  fuentes: FuenteSalud[];
  cuarentenaPorFuente: { source: string; count: number }[];
  ultimas: EjecucionFila[];
}) {
  const router = useRouter();
  const [enCurso, setEnCurso] = React.useState<string | null>(null);

  const cuarentena = new Map(cuarentenaPorFuente.map((c) => [c.source, c.count]));

  async function actualizar(source: string) {
    setEnCurso(source);
    const aviso = toast.loading(
      `Leyendo ${SOURCE_LABEL[source] ?? source}. Puede tardar un minuto.`,
    );
    try {
      const respuesta = await fetch('/api/admin/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      });
      const datos = (await respuesta.json()) as {
        ok?: boolean;
        error?: string;
        itemsSeen?: number;
        itemsCreated?: number;
        itemsUpdated?: number;
        itemsQuarantined?: number;
      };

      if (!respuesta.ok || !datos.ok) {
        toast.error(datos.error ?? 'La lectura ha terminado con error.', { id: aviso });
      } else {
        toast.success(
          `${datos.itemsSeen ?? 0} leídas · ${datos.itemsCreated ?? 0} nuevas · ` +
            `${datos.itemsUpdated ?? 0} actualizadas · ${datos.itemsQuarantined ?? 0} en cuarentena.`,
          { id: aviso },
        );
      }
      router.refresh();
    } catch {
      toast.error('No se ha podido lanzar la lectura.', { id: aviso });
    } finally {
      setEnCurso(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <ul className="flex flex-col gap-2">
        {fuentes.map((fuente) => {
          const estado = fuente.latest ? ESTADO[fuente.latest.status] : null;
          const Icono = estado?.icono ?? CircleDashed;
          const enCuarentena = cuarentena.get(fuente.source) ?? 0;

          return (
            <li
              key={fuente.source}
              className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-3 rounded-lg border bg-card px-3 py-3"
            >
              <Icono
                className={cn(
                  'mt-1 size-4 shrink-0',
                  estado?.color ?? 'text-muted-foreground',
                )}
                aria-hidden
              />

              <div className="flex min-w-48 flex-1 flex-col gap-0.5">
                <span className="font-medium">
                  {SOURCE_LABEL[fuente.source] ?? fuente.source}
                </span>
                <span className="medida text-xs text-muted-foreground">
                  {fuente.description}
                </span>
                <span
                  className={cn(
                    'text-xs',
                    fuente.stale ? 'text-warn' : 'text-muted-foreground',
                  )}
                >
                  {antiguedad(fuente.ageHours)}
                  {fuente.latest ? ` (${formatDateTimeEs(fuente.latest.startedAt)})` : ''}
                  {estado ? ` · ${estado.palabra.toLowerCase()}` : ''}
                </span>
                {/*
                  La columna `error` de una ejecución correcta trae notas, no
                  fallos («278 documentos únicos»). Pintarlas todas en rojo
                  hacía que el panel pareciera roto estando bien, así que el
                  color lo decide el estado de la ejecución, no la existencia
                  del texto.
                */}
                {fuente.latest?.error ? (
                  <span
                    title={fuente.latest.error}
                    className={cn(
                      'medida line-clamp-3 text-xs break-words',
                      estado?.color ?? 'text-muted-foreground',
                      fuente.latest.status === 'ok' && 'text-muted-foreground',
                    )}
                  >
                    {fuente.latest.error}
                  </span>
                ) : null}
              </div>

              {fuente.latest ? (
                <dl className="flex shrink-0 flex-wrap gap-x-4 gap-y-1">
                  {[
                    ['leídas', fuente.latest.itemsSeen],
                    ['nuevas', fuente.latest.itemsCreated],
                    ['actualizadas', fuente.latest.itemsUpdated],
                    ['en cuarentena', fuente.latest.itemsQuarantined],
                  ].map(([palabra, valor]) => (
                    <div key={palabra as string} className="flex flex-col">
                      <dd className="cifra text-lg">{valor as number}</dd>
                      <dt className="text-xs text-muted-foreground">
                        {palabra as string}
                      </dt>
                    </div>
                  ))}
                </dl>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Sin ninguna ejecución registrada.
                </span>
              )}

              <div className="flex shrink-0 items-center gap-2">
                {enCuarentena > 0 ? (
                  <Badge variant="outline" className="border-warn/40 font-normal text-warn">
                    {enCuarentena} en cuarentena
                  </Badge>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={enCurso !== null}
                  onClick={() => actualizar(fuente.source)}
                >
                  {enCurso === fuente.source ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <RefreshCw />
                  )}
                  Actualizar ahora
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-lg">Últimas ejecuciones</h2>
          <p className="text-sm text-muted-foreground">
            De la más reciente a la más antigua, con quién la lanzó.
          </p>
        </div>

        {ultimas.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground">
            Todavía no se ha ejecutado ninguna lectura. Pulsa «Actualizar ahora» en
            cualquier fuente para lanzar la primera.
          </p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {ultimas.map((e) => {
              const estado = ESTADO[e.status];
              return (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm"
                >
                  <span className={cn('w-20 shrink-0 text-xs', estado?.color)}>
                    {estado?.palabra ?? e.status}
                  </span>
                  <span className="min-w-32 flex-1 truncate">
                    {SOURCE_LABEL[e.source] ?? e.source}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDateTimeEs(e.startedAt)}
                    {e.durationMs !== null
                      ? ` · ${(e.durationMs / 1000).toFixed(1)} s`
                      : ''}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {e.itemsSeen} leídas · {e.itemsCreated} nuevas · {e.itemsQuarantined}{' '}
                    en cuarentena
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {e.triggeredBy === 'cron' ? 'automática' : e.triggeredBy}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
