'use client';

import { ChevronDown, FileText, Send, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { eliminarConvocatoria, publicarConvocatoria } from '@/lib/callups/actions';
import { CALL_UP_STATUS_LABEL, PLACE_TYPE_LABEL } from '@/lib/callups/tipos';
import type { CallUpDetail, EventoConvocable } from '@/lib/callups/tipos';
import { cn, formatDateRangeEs, formatDateTimeEs, titular } from '@/lib/utils';
import { ElegirConvocados } from './elegir-convocados';
import { NuevaConvocatoria } from './nueva-convocatoria';

/**
 * Panel del seleccionador y de la dirección técnica.
 *
 * Lo que se viene a mirar aquí es una sola cosa: quién ha dicho que sí y
 * quién no ha dicho nada todavía, porque de eso depende llamar al siguiente.
 * Por eso los tres recuentos van en cifra y en la fila cerrada, y la lista
 * completa se despliega solo si hace falta.
 */
export function PanelConvocatorias({
  convocatorias,
  eventos,
  puedeGestionar,
}: {
  convocatorias: CallUpDetail[];
  eventos: EventoConvocable[];
  puedeGestionar: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-xl">Convocatorias que gestionas</h2>
          <p className="text-sm text-muted-foreground">
            {convocatorias.length === 0
              ? 'ninguna todavía'
              : `${convocatorias.length} en total`}
          </p>
        </div>
        {puedeGestionar ? <NuevaConvocatoria eventos={eventos} /> : null}
      </div>

      {!puedeGestionar ? (
        <p className="medida text-sm text-muted-foreground">
          Puedes ver las convocatorias y las respuestas de todas las armas. Crear,
          modificar y publicar lo hace la dirección técnica.
        </p>
      ) : null}

      {convocatorias.length === 0 ? (
        <p className="medida text-sm text-muted-foreground">
          Aquí aparecerá cada convocatoria con su lista de convocados y lo que ha
          contestado cada uno.{' '}
          {puedeGestionar
            ? 'Empieza por crear un borrador: eliges la competición, marcas las plazas y publicas cuando esté.'
            : 'Se verán en cuanto la dirección técnica cree la primera.'}
        </p>
      ) : (
        <ul className="flex flex-col">
          {convocatorias.map((c) => (
            <Fila key={c.id} convocatoria={c} puedeGestionar={puedeGestionar} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Fila({
  convocatoria: c,
  puedeGestionar,
}: {
  convocatoria: CallUpDetail;
  puedeGestionar: boolean;
}) {
  const router = useRouter();
  const [abierta, setAbierta] = React.useState(false);
  const [confirmar, setConfirmar] = React.useState<'publicar' | 'borrar' | null>(null);
  const [trabajando, setTrabajando] = React.useState(false);
  const [aviso, setAviso] = React.useState<{ ok: boolean; texto: string } | null>(null);

  async function ejecutar(que: 'publicar' | 'borrar') {
    setTrabajando(true);
    const r =
      que === 'publicar'
        ? await publicarConvocatoria(c.id)
        : await eliminarConvocatoria(c.id);
    setTrabajando(false);
    setAviso({ ok: r.ok, texto: r.ok ? r.message : r.error });
    if (r.ok) {
      setConfirmar(null);
      router.refresh();
    }
  }

  return (
    <li className="border-b py-3 last:border-b-0">
      <Collapsible open={abierta} onOpenChange={setAbierta}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <CollapsibleTrigger className="group flex min-w-48 flex-1 cursor-pointer items-start gap-2 text-left">
            <ChevronDown
              className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
              aria-hidden
            />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{c.title}</span>
                {c.published ? (
                  <Badge variant="outline" className="border-gold/50 text-gold">
                    Publicada
                  </Badge>
                ) : (
                  <Badge variant="secondary">Borrador</Badge>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {titular(c.eventName)} ·{' '}
                {formatDateRangeEs(c.eventStartDate, c.eventEndDate)}
                {c.respondBy ? ` · responder antes del ${formatDateTimeEs(c.respondBy)}` : ''}
              </span>
            </span>
          </CollapsibleTrigger>

          {/* En móvil los recuentos bajan a su propia línea: apretados contra
              el título lo partían en tres renglones de dos palabras. */}
          <div className="flex w-full shrink-0 items-start gap-2 pl-6 sm:w-auto sm:pl-0">
            <Recuento valor={c.confirmados} palabra="sí" clase="text-ok" />
            <Recuento valor={c.pendientes} palabra="sin contestar" />
            <Recuento valor={c.rechazados} palabra="no" clase="text-danger" />
          </div>
        </div>

        <CollapsibleContent className="pt-4 pl-6">
          <div className="flex flex-col gap-4">
            {c.convocados.length === 0 ? (
              <p className="medida text-sm text-muted-foreground">
                No hay nadie convocado todavía. Una convocatoria sin convocados no se
                puede publicar.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-0">Tirador</TableHead>
                    <TableHead className="hidden md:table-cell">Prueba</TableHead>
                    <TableHead className="hidden md:table-cell">Plaza</TableHead>
                    <TableHead className="pr-0 text-right">Respuesta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.convocados.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="pl-0 align-top whitespace-normal">
                        <span className="block text-sm">{a.athleteName}</span>
                        <span className="block text-xs text-muted-foreground md:hidden">
                          {[
                            a.competition,
                            PLACE_TYPE_LABEL[a.placeType].toLowerCase(),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        {a.clubName ? (
                          <span className="hidden text-xs text-muted-foreground md:block">
                            {a.clubName}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden align-top text-muted-foreground md:table-cell">
                        {a.competition ?? 'sin prueba'}
                      </TableCell>
                      <TableCell className="hidden align-top md:table-cell">
                        <span
                          className={
                            a.placeType === 'ranking'
                              ? 'text-gold'
                              : 'text-muted-foreground'
                          }
                        >
                          {a.placeType === 'ranking'
                            ? `Ranking${a.rankingPositionAtCutoff ? ` · ${a.rankingPositionAtCutoff}.º` : ''}`
                            : 'Técnica'}
                        </span>
                      </TableCell>
                      <TableCell className="pr-0 text-right align-top whitespace-normal">
                        <span
                          className={cn(
                            'text-sm',
                            a.status === 'confirmado' && 'text-ok',
                            a.status === 'rechazado' && 'text-danger',
                            a.status === 'pendiente' && 'text-muted-foreground',
                          )}
                        >
                          {CALL_UP_STATUS_LABEL[a.status]}
                        </span>
                        {a.rejectionReason ? (
                          <span className="mt-0.5 ml-auto block max-w-64 text-xs text-muted-foreground">
                            {a.rejectionReason}
                          </span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {c.body ? (
              <p className="medida text-sm whitespace-pre-line text-muted-foreground">
                {c.body}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {c.pdfUrl ? (
                <Button variant="ghost" size="sm" asChild className="cursor-pointer">
                  <a href={c.pdfUrl} target="_blank" rel="noreferrer">
                    <FileText aria-hidden />
                    {c.pdfName ?? 'PDF'}
                  </a>
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Sin PDF</span>
              )}

              {puedeGestionar ? (
                <>
                  <ElegirConvocados
                    callUpId={c.id}
                    eventId={c.eventId}
                    eventName={c.eventName}
                    yaConvocados={c.convocados}
                  />

                  {!c.published ? (
                    <>
                      <Button
                        size="sm"
                        className="cursor-pointer"
                        disabled={c.convocados.length === 0}
                        onClick={() => setConfirmar('publicar')}
                      >
                        <Send aria-hidden />
                        Publicar y avisar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="cursor-pointer text-danger"
                        onClick={() => setConfirmar('borrar')}
                      >
                        <Trash2 aria-hidden />
                        Eliminar el borrador
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Publicada
                      {c.publishedAt ? ` el ${formatDateTimeEs(c.publishedAt)}` : ''}
                      {c.createdByName ? ` por ${c.createdByName}` : ''}
                    </span>
                  )}
                </>
              ) : null}
            </div>

            {aviso ? (
              <p
                className={cn('text-sm', aviso.ok ? 'text-ok' : 'text-danger')}
                role="status"
              >
                {aviso.texto}
              </p>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Dialog
        open={confirmar !== null}
        onOpenChange={(v) => {
          if (!v) setConfirmar(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {confirmar === 'publicar'
                ? 'Publicar la convocatoria'
                : 'Eliminar el borrador'}
            </DialogTitle>
            <DialogDescription className="medida">
              {confirmar === 'publicar'
                ? `Se avisará por correo a los ${c.convocados.length} convocados (o a sus tutores). Un aviso no se puede recoger: comprueba la lista y el PDF antes de seguir.`
                : 'El borrador desaparece con su lista de convocados. Como no está publicado, nadie lo ha visto todavía.'}
            </DialogDescription>
          </DialogHeader>

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
            <Button
              variant={confirmar === 'publicar' ? 'default' : 'destructive'}
              className="cursor-pointer"
              disabled={trabajando}
              onClick={() => ejecutar(confirmar === 'publicar' ? 'publicar' : 'borrar')}
            >
              {trabajando
                ? 'Un momento…'
                : confirmar === 'publicar'
                  ? 'Publicar y avisar'
                  : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function Recuento({
  valor,
  palabra,
  clase,
}: {
  valor: number;
  palabra: string;
  clase?: string;
}) {
  return (
    <span className="flex min-w-14 flex-col items-center leading-none">
      <span className={cn('cifra text-xl', valor === 0 ? 'text-muted-foreground' : clase)}>
        {valor}
      </span>
      <span className="mt-1 text-center text-[11px] text-muted-foreground">
        {palabra}
      </span>
    </span>
  );
}
