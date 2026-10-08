'use client';

import {
  Check,
  CircleAlert,
  FileText,
  MapPin,
  Medal,
  Pencil,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { BanderaPais } from '@/components/bandera';
import { BloqueFecha } from '@/components/sistema/bloque-fecha';
import { Pastilla } from '@/components/sistema/pastilla';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { responderConvocatoria } from '@/lib/callups/actions';
import { CALL_UP_STATUS_LABEL } from '@/lib/callups/tipos';
import type { CallUpForAthlete } from '@/lib/callups/tipos';
import { fechaHora } from '@/lib/fechas';
import { cn, titular } from '@/lib/utils';
import { PLAZA_CORTA, partirPrueba } from './etiquetas';
import { CLASE_TONO, type Plazo, palabraPlazo } from './plazo';

/** Un dato con su rótulo encima. Nunca `A · B · C`. */
function Dato({
  rotulo,
  valor,
}: {
  rotulo: string;
  valor: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm">{valor}</dd>
    </div>
  );
}

/**
 * La convocatoria, tal y como la ve quien ha sido convocado.
 *
 * Es lo más importante que le puede pasar a un tirador en toda la aplicación,
 * y el oro está reservado para esto y para nada más. La pantalla tiene que
 * contestar cuatro cosas sin hacer scroll: a qué te convocan, por qué plaza,
 * hasta cuándo puedes contestar y qué se te pide hacer ahora.
 */
export function TarjetaConvocatoria({
  convocatoria: c,
  plazo,
  mostrarNombre,
}: {
  convocatoria: CallUpForAthlete;
  plazo: Plazo;
  /** Una cuenta con dos hijos necesita saber de quién es cada convocatoria. */
  mostrarNombre: boolean;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = React.useState<'confirmado' | 'rechazado' | null>(null);
  const [aviso, setAviso] = React.useState<{ ok: boolean; texto: string } | null>(null);
  const [dialogoAbierto, setDialogoAbierto] = React.useState(false);
  const [motivo, setMotivo] = React.useState(c.rejectionReason ?? '');

  const pendiente = c.status === 'pendiente';
  const prueba = partirPrueba(c.competition);

  async function responder(respuesta: 'confirmado' | 'rechazado', razon?: string) {
    setEnviando(respuesta);
    setAviso(null);
    const r = await responderConvocatoria(c.id, respuesta, razon);
    setEnviando(null);
    setAviso({ ok: r.ok, texto: r.ok ? r.message : r.error });
    if (r.ok) {
      setDialogoAbierto(false);
      router.refresh();
    }
  }

  return (
    /*
      El filete de arriba es de oro: es la única superficie de la aplicación
      que lo lleva, y sin leer una palabra dice «te han convocado». La
      superficie es sólida (`bg-card`), sin alfa ni textura.

      La cabecera tiene la forma de las tarjetas de competición: la fecha en
      bloque a la izquierda, el nombre en el centro y el estado a la derecha.
    */
    <article className="flex flex-col gap-4 rounded-xl border border-t-2 border-border border-t-gold bg-card p-4 sm:p-5">
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
        <BloqueFecha desde={c.eventStartDate} hasta={c.eventEndDate} tamano="tarjeta" />

        <div className="min-w-0">
          <p className="flex items-center gap-1 text-xs font-medium text-gold">
            <Medal className="size-4 shrink-0" aria-hidden />
            Convocatoria
          </p>
          <h2 className="mt-1 text-lg leading-6 font-semibold break-words">{titular(c.eventName)}</h2>
          {c.eventCity ? (
            <p className="mt-1 flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{titular(c.eventCity)}</span>
              {/* El país sólo cuando no es España: marcar «ESP» en nueve de cada diez no distingue nada. */}
              {c.eventCountry && c.eventCountry !== 'ES' ? (
                <BanderaPais pais={c.eventCountry} tamaño="fila" />
              ) : null}
            </p>
          ) : null}
        </div>

        {/* La cifra que importa: cuántos días quedan para contestar. */}
        {pendiente ? (
          <div className="flex max-w-24 shrink-0 flex-col items-end text-right">
            <span className={cn('cifra text-3xl leading-none', CLASE_TONO[plazo.tono])}>
              {plazo.dias === null ? '—' : Math.abs(plazo.dias)}
            </span>
            <span
              className={cn(
                'mt-1 text-xs leading-tight',
                plazo.vencido ? CLASE_TONO.danger : 'text-muted-foreground',
              )}
            >
              {palabraPlazo(plazo)}
            </span>
          </div>
        ) : (
          <Pastilla tono={c.status === 'confirmado' ? 'ok' : 'peligro'} tamano="md">
            {CALL_UP_STATUS_LABEL[c.status]}
          </Pastilla>
        )}
      </div>

      {/*
        Los datos, en filas con su rótulo. El tipo de plaza es la diferencia
        entre «te lo has ganado en la pista» y «te ha elegido el
        seleccionador»: va con su rótulo delante, no como una pastilla más.
      */}
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        {mostrarNombre ? <Dato rotulo="Tirador" valor={c.athleteName} /> : null}
        {prueba ? <Dato rotulo="Prueba" valor={prueba.prueba} /> : null}
        {prueba?.categoria ? (
          <Dato rotulo="Categoría" valor={prueba.categoria} />
        ) : null}
        <Dato
          rotulo="Plaza"
          valor={
            <span className={c.placeType === 'ranking' ? 'text-gold' : undefined}>
              {PLAZA_CORTA[c.placeType]}
              {c.placeType === 'ranking' && c.rankingPositionAtCutoff !== null
                ? `, ${c.rankingPositionAtCutoff}.º al corte`
                : ''}
            </span>
          }
        />
        {pendiente && c.respondBy ? <Dato rotulo="Responder antes del" valor={fechaHora(c.respondBy)} /> : null}
      </dl>
      {c.body ? <p className="medida text-sm whitespace-pre-line">{c.body}</p> : null}

      {c.travelNotes ? (
        <p className="medida rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-line text-muted-foreground">
          {c.travelNotes}
        </p>
      ) : null}

      {/* Respuesta ya dada: el estado va arriba; aquí cuándo y, si la hay, la razón. */}
      {!pendiente && (c.respondedAt || c.rejectionReason) ? (
        <div className="flex flex-col gap-1 rounded-md bg-secondary px-3 py-2 text-sm">
          {c.respondedAt ? (
            <p className="text-muted-foreground">Respondida el {fechaHora(c.respondedAt)}</p>
          ) : null}
          {c.rejectionReason ? <p className="medida">{c.rejectionReason}</p> : null}
        </div>
      ) : null}
      {aviso ? (
        <p
          className={cn(
            'text-sm',
            aviso.ok ? 'text-ok' : 'text-danger',
          )}
          role="status"
        >
          {aviso.texto}
        </p>
      ) : null}

      <Separator />

      <div className="flex flex-wrap items-center gap-2">
        {pendiente ? (
          <>
            <Button
              onClick={() => responder('confirmado')}
              disabled={enviando !== null}
              className="cursor-pointer"
            >
              <Check aria-hidden />
              {enviando === 'confirmado' ? 'Confirmando…' : 'Confirmar que voy'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setDialogoAbierto(true)}
              disabled={enviando !== null}
              className="cursor-pointer"
            >
              <X aria-hidden />
              No puedo ir
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            onClick={() => setDialogoAbierto(true)}
            disabled={enviando !== null}
            className="cursor-pointer"
          >
            <Pencil aria-hidden />
            Cambiar la respuesta
          </Button>
        )}

        {c.pdfUrl ? (
          <Button variant="ghost" asChild className="cursor-pointer">
            <a href={c.pdfUrl} target="_blank" rel="noreferrer">
              <FileText aria-hidden />
              {c.pdfName ?? 'Convocatoria en PDF'}
            </a>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            Sin PDF de convocatoria publicado
          </span>
        )}
      </div>

      {/* Rechazar exige motivo: sin él el seleccionador no puede decidir a
          quién llama en tu lugar, y es lo que dice la acción del servidor. */}
      <Dialog open={dialogoAbierto} onOpenChange={setDialogoAbierto}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {c.status === 'confirmado' ? 'Cambiar la respuesta' : 'No puedo ir'}
            </DialogTitle>
            <DialogDescription className="medida">
              Explica por qué. El seleccionador necesita saber si es una lesión, un
              examen o el coste del viaje: cada cosa se resuelve de una forma
              distinta, y de ello depende a quién llama en tu lugar.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`motivo-${c.id}`}>Motivo</Label>
            <Textarea
              id={`motivo-${c.id}`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={4}
              maxLength={500}
              placeholder="Lesión, examen, coste del viaje…"
            />
            {motivo.trim().length > 0 && motivo.trim().length < 3 ? (
              <p className="flex items-center gap-1 text-xs text-danger">
                <CircleAlert className="size-3.5" aria-hidden />
                Hace falta escribir el motivo.
              </p>
            ) : null}
          </div>

          {aviso && !aviso.ok ? (
            <p className="text-sm text-danger" role="alert">
              {aviso.texto}
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" className="cursor-pointer">
                Volver
              </Button>
            </DialogClose>
            {/* Solo cuando ya se había rechazado: si está pendiente, el botón
                de confirmar ya está en la tarjeta y aquí sobraría. */}
            {c.status === 'rechazado' ? (
              <Button
                variant="ghost"
                className="cursor-pointer"
                disabled={enviando !== null}
                onClick={() => responder('confirmado')}
              >
                <Check aria-hidden />
                Al final sí voy
              </Button>
            ) : null}
            <Button
              variant="destructive"
              className="cursor-pointer"
              disabled={enviando !== null || motivo.trim().length < 3}
              onClick={() => responder('rechazado', motivo)}
            >
              {enviando === 'rechazado' ? 'Enviando…' : 'Rechazar la convocatoria'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
