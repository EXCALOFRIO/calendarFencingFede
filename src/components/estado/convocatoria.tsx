'use client';

import { Check, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { MyCallUp } from '@/lib/queries/my-status';
import { formatDateEs, titular } from '@/lib/utils';
import { Rotulos } from './piezas';

export type Respuesta = (
  id: string,
  respuesta: 'confirmado' | 'rechazado',
  motivo?: string,
) => Promise<{ ok: true; message: string } | { ok: false; error: string }>;

/**
 * Convocatoria de selección.
 *
 * Es lo único de toda la aplicación que va en oro: si el oro significase
 * también "plazo próximo" o "inscripción aceptada", dejaría de significar
 * "te han convocado", que es el aviso más importante que existe aquí.
 *
 * Desde aquí solo se puede decir que sí. Decir que no exige explicar por qué
 * —el seleccionador tiene que decidir a quién llama en tu lugar— y eso se
 * hace en la pantalla de selección, no con un botón de paso.
 */
export function FilaConvocatoria({
  convocatoria,
  responder,
  conNombre,
}: {
  convocatoria: MyCallUp;
  responder: Respuesta;
  conNombre: boolean;
}) {
  const [enviando, empezar] = React.useTransition();
  const [aviso, setAviso] = React.useState<string | null>(null);

  const pendiente = convocatoria.status === 'pendiente';

  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-gold text-gold-foreground">Convocado</Badge>
        {pendiente ? (
          <span className="text-sm text-gold">Falta tu confirmación</span>
        ) : convocatoria.status === 'confirmado' ? (
          <span className="text-sm text-muted-foreground">
            Confirmaste que vas
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">
            Dijiste que no puedes ir
          </span>
        )}
      </div>

      <h3 className="text-lg">{titular(convocatoria.eventName)}</h3>

      <Rotulos
        datos={[
          ['Convocatoria', convocatoria.title],
          ['Se compite el', formatDateEs(convocatoria.startDate)],
          [
            'Plaza',
            convocatoria.placeType === 'ranking'
              ? 'Por ranking'
              : 'Técnica, a criterio del seleccionador',
          ],
          [
            'Responder antes del',
            convocatoria.respondBy
              ? formatDateEs(convocatoria.respondBy)
              : 'sin fecha límite',
          ],
          ...(conNombre
            ? ([['Tirador', convocatoria.athleteName]] as [string, string][])
            : []),
        ]}
      />

      {aviso ? <p className="text-sm">{aviso}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        {pendiente ? (
          <Button
            size="sm"
            disabled={enviando}
            onClick={() =>
              empezar(async () => {
                const r = await responder(convocatoria.id, 'confirmado');
                setAviso(r.ok ? r.message : r.error);
              })
            }
          >
            <Check /> {enviando ? 'Confirmando…' : 'Confirmar asistencia'}
          </Button>
        ) : null}

        <Button variant="outline" size="sm" asChild>
          <Link href="/convocatorias">Ver la convocatoria</Link>
        </Button>

        {convocatoria.pdfUrl ? (
          <Button variant="ghost" size="sm" asChild>
            <a href={convocatoria.pdfUrl} target="_blank" rel="noreferrer">
              Documento oficial <ExternalLink />
            </a>
          </Button>
        ) : null}
      </div>
    </li>
  );
}
