'use client';

import { ChevronDown, FileText, Send, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { convocatoriaVisible, ocultasPorArma } from '@/app/(app)/convocatorias/filtro';
import { MarcaArma } from '@/components/calendario/iconos-arma';
import { CabeceraSeccion } from '@/components/sistema/cabecera-seccion';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { Pastilla } from '@/components/sistema/pastilla';
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
import { ARMAS } from '@/lib/ambito';
import type { Weapon } from '@/lib/auth/session';
import { eliminarConvocatoria, publicarConvocatoria } from '@/lib/callups/actions';
import { CALL_UP_STATUS_LABEL } from '@/lib/callups/tipos';
import type { CallUpDetail, EventoConvocable } from '@/lib/callups/tipos';
import { fechaHora, rangoFechas } from '@/lib/fechas';
import { rotuloArma } from '@/lib/sport/rotulos';
import { cn, titular } from '@/lib/utils';
import { ElegirConvocados } from './elegir-convocados';
import { PLAZA_CORTA } from './etiquetas';
import { FiltroArmas } from './filtro-armas';
import { NuevaConvocatoria } from './nueva-convocatoria';
import { Respuestas } from './respuestas';

/**
 * ===========================================================================
 * EL PANEL DEL SELECCIONADOR Y DE LA DIRECCIÓN TÉCNICA
 * ===========================================================================
 *
 * Lo que se viene a mirar aquí es una sola cosa: **quién ha dicho que sí y
 * quién no ha dicho nada todavía**, porque de eso depende llamar al siguiente.
 * Por eso los tres recuentos van en cifra y con su barra en la fila cerrada, y
 * la lista completa se despliega solo si hace falta.
 *
 * ---------------------------------------------------------------------------
 * Y AHORA FILTRA POR ARMA, QUE ERA EL FALLO
 * ---------------------------------------------------------------------------
 * Antes decía, con todas las letras, «puedes ver las convocatorias y las
 * respuestas de todas las armas», y eso hacía que el seleccionador de florete
 * entrase viendo «Selección Sub-23 de espada femenina». Ahora arranca con su
 * arma —`armasDeArranque()` de `src/lib/ambito.ts`, la misma regla que el
 * calendario y la pantalla de tiradores— y tiene el botón para salir de ahí,
 * igual que en el calendario. La dirección técnica arranca con las tres.
 */
export function PanelConvocatorias({
  convocatorias,
  eventos,
  puedeGestionar,
  armasPorConvocatoria,
  armasArranque,
}: {
  convocatorias: CallUpDetail[];
  eventos: EventoConvocable[];
  puedeGestionar: boolean;
  /** `callUpId` -> armas de las pruebas a las que se convoca. */
  armasPorConvocatoria: Record<string, Weapon[]>;
  /** Con qué armas se abre, según quién mire. Sale de `armasDeArranque()`. */
  armasArranque: Weapon[];
}) {
  const [armas, setArmas] = React.useState<Weapon[]>(armasArranque);

  const visibles = convocatorias.filter((c) =>
    convocatoriaVisible(armasPorConvocatoria[c.id] ?? [], armas),
  );
  const ocultas = ocultasPorArma(convocatorias, armasPorConvocatoria, armas);

  const sinContestar = visibles.reduce((n, c) => n + c.pendientes, 0);

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <CabeceraSeccion
        titulo="Convocatorias que gestionas"
        contexto={
          visibles.length === 0
            ? 'Ninguna'
            : sinContestar > 0
              ? `${visibles.length}, con ${sinContestar} sin contestar`
              : `${visibles.length}, todas contestadas`
        }
        accion={puedeGestionar ? <NuevaConvocatoria eventos={eventos} /> : null}
      />


      {convocatorias.length > 0 ? (
        <FiltroArmas
          armas={armas}
          onCambiar={setArmas}
          arranque={armasArranque}
          conAtajo={visibles.length > 0}
        />
      ) : null}

      {!puedeGestionar ? (
        <p className="medida text-sm text-muted-foreground">
          Puedes ver y seguir las respuestas de{' '}
          {armasArranque.length < ARMAS.length
            ? `tu arma (${armasArranque.map((a) => rotuloArma(a).toLowerCase()).join(' y ')}), con los dos géneros`
            : 'todas las armas'}
          . Crear, modificar y publicar lo hace la dirección técnica.
        </p>
      ) : null}

      {convocatorias.length === 0 ? (
        <EstadoVacio
          titulo="Todavía no hay convocatorias"
          descripcion={
            puedeGestionar
              ? 'Crea un borrador: eliges la competición, marcas las plazas y publicas cuando esté.'
              : 'Se verán en cuanto la dirección técnica cree la primera.'
          }
        />

      ) : visibles.length === 0 ? (
        /*
          El estado vacío del filtro dice el número, no solo «nada»: «ninguna de
          florete» a secas deja pensando si el panel está roto. Con «hay 2 de
          otras armas» se entiende que el filtro está puesto y que quitarlo las
          trae, y el botón lo hace.
        */
        /*
          En una banda con su filete, no suelto en medio de la página. En
          escritorio, dos frases flotando dejaban 500 px de vacío debajo y la
          pantalla se leía como si hubiera fallado la carga. Visto en
          `capturas/prueba-coach-escritorio-convocatorias.png`.
        */
        <EstadoVacio
          className="rounded-xl bg-card"
          titulo={`Ninguna convocatoria de ${armas.map((a) => rotuloArma(a).toLowerCase()).join(' ni ')}`}
          descripcion={ocultas > 0 ? (ocultas === 1 ? 'Hay 1 de otra arma.' : `Hay ${ocultas} de otras armas.`) : undefined}
          accion={
            ocultas > 0 ? (
              <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => setArmas([...ARMAS])}>
                Ver todas las armas
              </Button>
            ) : undefined
          }
        />

      ) : (
        <ul className="flex flex-col divide-y">
          {visibles.map((c) => (
            <Fila
              key={c.id}
              convocatoria={c}
              puedeGestionar={puedeGestionar}
              armas={armasPorConvocatoria[c.id] ?? []}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Fila({
  convocatoria: c,
  puedeGestionar,
  armas,
}: {
  convocatoria: CallUpDetail;
  puedeGestionar: boolean;
  armas: Weapon[];
}) {
  const router = useRouter();
  /**
   * Abierta de entrada si queda alguien por contestar.
   *
   * A esta pantalla se viene a saber QUIÉN no ha contestado, porque de eso
   * depende llamar al siguiente. Si para averiguarlo hay que desplegar una a
   * una las convocatorias, la pantalla no contesta la pregunta: la esconde. Las
   * que ya están resueltas siguen plegadas, que es lo que evita el muro de
   * veinte tablas.
   */
  const [abierta, setAbierta] = React.useState(c.pendientes > 0);
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
    <li className="py-4">
      <Collapsible open={abierta} onOpenChange={setAbierta}>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
          <CollapsibleTrigger className="group flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left">
            <ChevronDown
              className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                {/* El arma primero y en dibujo: es lo que distingue una
                    convocatoria de otra de un vistazo, y ahora además es lo que
                    dice el filtro. */}
                {armas.length > 0 ? (
                  <MarcaArma armas={armas} px={22} className="text-muted-foreground" />
                ) : null}
                <span className="min-w-0 text-base font-medium">{c.title}</span>
                {c.published ? (
                  <Pastilla tono="oro">Publicada</Pastilla>
                ) : (
                  <Pastilla>Borrador</Pastilla>
                )}

              </span>

              {/* Con el rótulo delante, no encadenados con puntos medios. */}
              <span className="mt-1 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">{titular(c.eventName)}</span>
                <span>
                  {rangoFechas(c.eventStartDate, c.eventEndDate, 'linea', { anio: 'auto' })}
                </span>
                {c.respondBy ? (
                  <span>
                    Responden antes del {fechaHora(c.respondBy)}
                  </span>
                ) : null}
              </span>
            </span>
          </CollapsibleTrigger>

          {/* En móvil los recuentos bajan a su propia línea: apretados contra
              el título lo partían en tres renglones de dos palabras. */}
          <Respuestas
            confirmados={c.confirmados}
            pendientes={c.pendientes}
            rechazados={c.rechazados}
            className="w-full shrink-0 pl-6 sm:w-56 sm:pl-0"
          />
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
                  {c.convocados.map((a) => {
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="pl-0 align-top whitespace-normal">
                          <span className="block text-sm">{a.athleteName}</span>
                          <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground md:hidden">
                            {a.competition ? <span>{a.competition}</span> : null}
                            <span
                              className={
                                a.placeType === 'ranking' ? 'text-gold' : undefined
                              }
                            >
                              {PLAZA_CORTA[a.placeType]}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="hidden align-top md:table-cell">
                          {a.competition ? (
                            <span className="text-foreground">{a.competition}</span>
                          ) : (
                            <span className="text-muted-foreground">sin prueba</span>
                          )}
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
                              ? `Ranking${a.rankingPositionAtCutoff ? `, ${a.rankingPositionAtCutoff}.º al corte` : ''}`
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
                            <span className="mt-1 ml-auto block max-w-64 text-xs text-muted-foreground">
                              {a.rejectionReason}
                            </span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
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
                      {c.publishedAt ? ` el ${fechaHora(c.publishedAt)}` : ''}
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
