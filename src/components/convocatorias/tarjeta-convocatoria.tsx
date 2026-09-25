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
import { Badge } from '@/components/ui/badge';
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
import { CALL_UP_STATUS_LABEL, PLACE_TYPE_LABEL } from '@/lib/callups/tipos';
import type { CallUpForAthlete } from '@/lib/callups/tipos';
import {
  cn,
  formatDateRangeEs,
  formatDateTimeEs,
  titular,
} from '@/lib/utils';
import { CLASE_TONO, type Plazo, palabraPlazo } from './plazo';

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
    <article className="flex flex-col gap-4 rounded-lg border border-gold/35 bg-gold/[0.04] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-56 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-medium text-gold">
            <Medal className="size-3.5 shrink-0" aria-hidden />
            Convocatoria de selección
          </p>

          <h2 className="mt-1 text-xl sm:text-2xl">{titular(c.eventName)}</h2>

          {/* Una línea de contexto, con los separadores como elementos sueltos
              para que al envolver no queden puntos huérfanos al principio. */}
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            {mostrarNombre ? (
              <>
                <span className="text-foreground">{c.athleteName}</span>
                <span aria-hidden>·</span>
              </>
            ) : null}
            <span>{formatDateRangeEs(c.eventStartDate, c.eventEndDate)}</span>
            {c.eventCity ? (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" aria-hidden />
                  {titular(c.eventCity)}
                  {c.eventCountry && c.eventCountry !== 'ES'
                    ? ` (${c.eventCountry})`
                    : ''}
                </span>
              </>
            ) : null}
          </p>
        </div>

        {/* La cifra que importa: cuántos días quedan para contestar. En móvil
            baja a su propia línea; apretada contra el título no se lee. */}
        {pendiente ? (
          <div className="flex w-full shrink-0 items-baseline gap-2 sm:w-auto">
            <span className={cn('cifra text-5xl', CLASE_TONO[plazo.tono])}>
              {plazo.dias === null ? '—' : Math.abs(plazo.dias)}
            </span>
            <span
              className={cn(
                'max-w-40 text-xs leading-tight sm:max-w-24',
                plazo.vencido ? CLASE_TONO.danger : 'text-muted-foreground',
              )}
            >
              {palabraPlazo(plazo)}
              {c.respondBy ? (
                <span className="mt-0.5 block text-muted-foreground">
                  {formatDateTimeEs(c.respondBy)}
                </span>
              ) : null}
            </span>
          </div>
        ) : null}
      </div>

      {/* Tipo de plaza: es la diferencia entre "te lo has ganado en la pista"
          y "te ha elegido el seleccionador", y nadie quiere confundirlas. */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={
            c.placeType === 'ranking'
              ? 'border-gold/50 text-gold'
              : 'border-border text-foreground'
          }
        >
          {PLACE_TYPE_LABEL[c.placeType]}
          {c.placeType === 'ranking' && c.rankingPositionAtCutoff !== null
            ? ` · ${c.rankingPositionAtCutoff}.º al corte`
            : ''}
        </Badge>
        {c.competition ? <Badge variant="secondary">{c.competition}</Badge> : null}
      </div>

      {c.body ? <p className="medida text-sm whitespace-pre-line">{c.body}</p> : null}

      {c.travelNotes ? (
        <p className="medida rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-line text-muted-foreground">
          {c.travelNotes}
        </p>
      ) : null}

      {/* Respuesta ya dada. Se conserva visible: es un compromiso adquirido. */}
      {!pendiente ? (
        <div
          className={cn(
            'flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm',
            c.status === 'confirmado'
              ? 'border-ok/40 text-ok'
              : 'border-danger/40 text-danger',
          )}
        >
          {c.status === 'confirmado' ? (
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : (
            <X className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="font-medium">
              {CALL_UP_STATUS_LABEL[c.status]}
              {c.respondedAt ? (
                <span className="font-normal text-muted-foreground">
                  {' '}
                  el {formatDateTimeEs(c.respondedAt)}
                </span>
              ) : null}
            </p>
            {c.rejectionReason ? (
              <p className="medida mt-0.5 text-muted-foreground">{c.rejectionReason}</p>
            ) : null}
          </div>
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

      <Separator className="bg-gold/20" />

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
              placeholder="Lesión, examen, coste del viaje…"
            />
            {motivo.trim().length > 0 && motivo.trim().length < 3 ? (
              <p className="flex items-center gap-1.5 text-xs text-danger">
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
