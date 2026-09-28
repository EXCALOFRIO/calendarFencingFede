'use client';

import { Check, CircleCheck, ExternalLink, Medal, X } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import type { MyCallUp } from '@/lib/queries/my-status';
import { cn, formatDateEs, titular } from '@/lib/utils';
import { Rotulos, Seccion } from './piezas';

export type Respuesta = (
  id: string,
  respuesta: 'confirmado' | 'rechazado',
  motivo?: string,
) => Promise<{ ok: true; message: string } | { ok: false; error: string }>;

/**
 * La banda de convocatorias, que es la única cosa de oro de la pantalla.
 *
 * Si el oro significase también «plazo próximo» o «estás inscrito», dejaría de
 * significar «te han convocado», que es el aviso más importante que existe
 * aquí. Por eso está reservado, y por eso esta banda no se pinta si no hay nada
 * que contestar ni nada que recordar.
 */
export function Convocatorias({
  convocatorias,
  responder,
  conNombre,
}: {
  convocatorias: MyCallUp[];
  responder: Respuesta;
  conNombre: boolean;
}) {
  if (convocatorias.length === 0) return null;

  const sinResponder = convocatorias.filter(
    (c) => c.status === 'pendiente',
  ).length;

  return (
    <Seccion
      titulo="Selección"
      contexto={
        sinResponder > 0
          ? sinResponder === 1
            ? 'falta tu respuesta'
            : `faltan ${sinResponder} respuestas`
          : 'ya has contestado a todas'
      }
      accion={
        <Link
          href="/convocatorias"
          className="text-sm text-primary-text underline underline-offset-4 transition-colors hover:text-foreground"
        >
          Ver la selección
        </Link>
      }
    >
      <ul className="flex flex-col gap-3 pt-3">
        {convocatorias.map((c) => (
          <Fila
            key={c.id}
            convocatoria={c}
            responder={responder}
            conNombre={conNombre}
          />
        ))}
      </ul>
    </Seccion>
  );
}

/**
 * Una convocatoria.
 *
 * La superficie es **sólida** con la textura teñida de oro encima
 * (`fondo-cabecera tinte-oro` sobre `bg-card`), no una tarjeta translúcida: el
 * acrílico se reserva para lo que de verdad flota sobre una imagen y el tinte
 * con alfa baja es lo que el usuario ha rechazado tres veces. Lo que la marca es
 * el **filete de oro de arriba**, que es el canto de chapa del tema aplicado a
 * lo único que lo merece.
 *
 * Desde aquí solo se puede decir que sí. Decir que no exige explicar por qué
 * —el seleccionador tiene que decidir a quién llama en tu lugar— y eso se hace
 * en la pantalla de selección, con su cuadro de motivo.
 */
function Fila({
  convocatoria: c,
  responder,
  conNombre,
}: {
  convocatoria: MyCallUp;
  responder: Respuesta;
  conNombre: boolean;
}) {
  const [enviando, empezar] = React.useTransition();
  const [aviso, setAviso] = React.useState<string | null>(null);

  const pendiente = c.status === 'pendiente';

  return (
    <li className="fondo-cabecera tinte-oro flex flex-col gap-3 rounded-lg border-t-2 border-gold bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="flex items-center gap-1.5 text-xs font-medium text-gold">
          <Medal className="size-3.5 shrink-0" aria-hidden />
          Convocatoria de selección
        </p>
        <Estado estado={c.status} />
      </div>

      <h3 className="text-lg sm:text-xl">{titular(c.eventName)}</h3>

      {/* En línea, no apilado: apilados, los cinco rótulos hacían la banda de
          450 px en un iPhone y el botón de confirmar caía fuera de pantalla. */}
      <Rotulos
        disposicion="linea"
        datos={[
          ['Convocatoria', c.title],
          ['Se compite el', formatDateEs(c.startDate)],
          [
            'Plaza',
            c.placeType === 'ranking'
              ? 'Por ranking'
              : 'Técnica, a criterio del seleccionador',
          ],
          [
            'Responder antes del',
            c.respondBy ? formatDateEs(c.respondBy) : 'sin fecha límite',
          ],
          ...(conNombre
            ? ([['Tirador', c.athleteName]] as [string, React.ReactNode][])
            : []),
        ]}
      />

      {aviso ? (
        <p className="text-sm" role="status">
          {aviso}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {/*
          El único relleno de acento de esta pantalla, y por eso está aquí: la
          sección 9.1 de `REFERENCIAS.md` lo reserva para la acción principal, y
          confirmar una convocatoria de selección lo es sin discusión.
        */}
        {pendiente ? (
          <Button
            size="sm"
            className="cursor-pointer"
            disabled={enviando}
            onClick={() =>
              empezar(async () => {
                const r = await responder(c.id, 'confirmado');
                setAviso(r.ok ? r.message : r.error);
              })
            }
          >
            <Check aria-hidden /> {enviando ? 'Confirmando…' : 'Confirmar que voy'}
          </Button>
        ) : null}

        <Button variant="outline" size="sm" asChild className="cursor-pointer">
          <Link href="/convocatorias">
            {pendiente ? 'No puedo ir' : 'Cambiar la respuesta'}
          </Link>
        </Button>

        {c.pdfUrl ? (
          <Button variant="ghost" size="sm" asChild className="cursor-pointer">
            <a href={c.pdfUrl} target="_blank" rel="noreferrer">
              Documento oficial <ExternalLink aria-hidden />
            </a>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            Sin PDF de convocatoria publicado
          </span>
        )}
      </div>
    </li>
  );
}

/** La respuesta ya dada, con forma además de color. */
function Estado({ estado }: { estado: MyCallUp['status'] }) {
  if (estado === 'pendiente') {
    return (
      <span className="text-sm font-medium text-gold">Falta tu confirmación</span>
    );
  }

  const confirmado = estado === 'confirmado';
  const Icono = confirmado ? CircleCheck : X;

  return (
    <span
      className={cn(
        'flex items-center gap-1.5 text-sm',
        confirmado ? 'text-ok' : 'text-muted-foreground',
      )}
    >
      <Icono className="size-4 shrink-0" aria-hidden />
      {confirmado ? 'Confirmaste que vas' : 'Dijiste que no puedes ir'}
    </span>
  );
}
