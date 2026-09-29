'use client';

import { Download, Loader2, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import type { FilaInscripcion } from '@/app/(app)/admin/consultas';
import {
  exportarInscripcionesCsv,
  moverInscripciones,
} from '@/app/(app)/admin/inscripciones/actions';
import { Buscador } from '@/components/admin/buscador';
import { Vacio } from '@/components/admin/piezas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { EntryStatus } from '@/lib/entries/state-machine';
import {
  CATEGORY_LABEL,
  GENDER_LABEL,
  WEAPON_LABEL,
  cn,
  formatDateEs,
  titular,
} from '@/lib/utils';

/**
 * Bandeja de inscripciones de la dirección técnica.
 *
 * -------------------------------------------------------------------------
 * ESTA PANTALLA ESTABA EN UN CALLEJÓN SIN SALIDA, Y ESTÁ MEDIDO
 * -------------------------------------------------------------------------
 * Se escribió cuando el club era un papel de la aplicación: el club validaba
 * («pending_club» → «club_approved») y la RFEE aprobaba lo validado. Ese papel
 * ya no existe —`Role` en `src/lib/auth/session.ts` es `admin | coach |
 * athlete | guardian`— y la bandeja se quedó sin el eslabón de entrada:
 *
 *  · el filtro de arranque era «Esperan a la RFEE» = `club_approved`;
 *  · las cuatro acciones salían todas de `club_approved`;
 *  · y NINGUNA interfaz ofrecía `pending_club` → `club_approved`.
 *
 * O sea que cada inscripción nueva que se pide desde `/estado` entra como
 * `pending_club` y se queda ahí para siempre, mientras la pantalla enseña por
 * defecto una lista vacía. Las filas que hoy se ven en `club_approved` son de
 * la semilla de demostración, no de nadie usando la aplicación.
 *
 * Se arregla con la acción que faltaba, sin inventar un club: la dirección
 * técnica da por buena la solicitud ella misma. La máquina de estados
 * (`src/lib/entries/state-machine.ts`) ya lo permitía —`roles: ['club',
 * 'admin']`—, así que no hay que tocarla: solo faltaba el botón.
 *
 * Y se quita «Devolver al club», que no tiene destinatario.
 *
 * -------------------------------------------------------------------------
 * CÓMO SE MIRA EN UN MÓVIL
 * -------------------------------------------------------------------------
 * No hay tabla: en un iPhone una tabla de siete columnas se sale de la
 * pantalla o se convierte en un desplazamiento lateral que nadie descubre.
 * La fila es una TARJETA apilada en móvil y una fila alineada en `sm`.
 *
 * Se agrupa POR COMPETICIÓN y no por tirador porque la decisión se toma por
 * competición: se aprueba la lista entera de un torneo y se exporta ese CSV.
 */

type Destino = Extract<
  EntryStatus,
  'club_approved' | 'federation_approved' | 'submitted' | 'rejected'
>;

const ACCIONES: {
  destino: Destino;
  etiqueta: string;
  desde: EntryStatus[];
  motivo: boolean;
  variante: 'default' | 'outline' | 'destructive';
  ayuda: string;
}[] = [
  {
    destino: 'club_approved',
    etiqueta: 'Dar por buena',
    desde: ['pending_club'],
    motivo: false,
    variante: 'default',
    ayuda: 'Solo se da por buena una solicitud que todavía no se ha revisado.',
  },
  {
    destino: 'federation_approved',
    etiqueta: 'Aprobar para enviar',
    desde: ['club_approved'],
    motivo: false,
    variante: 'default',
    ayuda: 'Antes de aprobarla hay que darla por buena.',
  },
  {
    destino: 'submitted',
    etiqueta: 'Marcar como enviada',
    desde: ['federation_approved'],
    motivo: false,
    variante: 'outline',
    ayuda: 'Solo se marca como enviada una inscripción ya aprobada.',
  },
  {
    destino: 'rejected',
    etiqueta: 'Rechazar',
    desde: ['pending_club', 'club_approved', 'federation_approved'],
    motivo: true,
    variante: 'destructive',
    ayuda: 'Una inscripción ya enviada se retira, no se rechaza.',
  },
];

/**
 * Los cuatro montones, y el orden es el del recorrido.
 *
 * Arranca en «Sin revisar», que es donde cae todo lo que se pide de verdad.
 * Antes arrancaba en `club_approved`, que hoy no recibe nada: la pantalla
 * abría vacía y parecía rota.
 */
const FILTROS: { clave: string; etiqueta: string; estados: EntryStatus[] }[] = [
  { clave: 'nuevas', etiqueta: 'Sin revisar', estados: ['pending_club'] },
  { clave: 'buenas', etiqueta: 'Dadas por buenas', estados: ['club_approved'] },
  { clave: 'enviar', etiqueta: 'Listas para enviar', estados: ['federation_approved'] },
  { clave: 'enviadas', etiqueta: 'Ya enviadas', estados: ['submitted'] },
  {
    clave: 'todas',
    etiqueta: 'Todas',
    estados: ['pending_club', 'club_approved', 'federation_approved', 'submitted'],
  },
];

/**
 * Cómo se llama cada estado EN ESTA PANTALLA, sin nombrar al club.
 *
 * `ENTRY_STATUS_LABEL` está escrito para el tirador («Pendiente de tu club»,
 * «Aceptada por la RFEE»). Aquí quien mira es la dirección técnica, y además
 * el club ya no valida nada: los nombres de la base (`pending_club`,
 * `club_approved`) se quedan porque cambiarlos es una migración, pero lo que
 * se lee en pantalla dice lo que pasa de verdad. Es la misma máquina de
 * estados con otra voz, no otra máquina de estados.
 */
const ESTADO_FEDERACION: Record<EntryStatus, string> = {
  draft: 'Borrador, sin pedir',
  pending_club: 'Pedida, sin revisar',
  club_approved: 'Dada por buena',
  federation_approved: 'Aprobada, lista para enviar',
  submitted: 'Enviada a la organización',
  rejected: 'Rechazada',
  withdrawn: 'Retirada',
};

const TONO_ESTADO: Record<EntryStatus, string> = {
  draft: 'text-muted-foreground',
  pending_club: 'text-warn',
  club_approved: 'text-primary-text',
  federation_approved: 'text-ok',
  submitted: 'text-muted-foreground',
  rejected: 'text-danger',
  withdrawn: 'text-muted-foreground',
};

export function BandejaInscripciones({ filas }: { filas: FilaInscripcion[] }) {
  const router = useRouter();
  const [filtro, setFiltro] = React.useState('nuevas');
  const [busqueda, setBusqueda] = React.useState('');
  const [elegidas, setElegidas] = React.useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = React.useState(false);
  const [pidiendoMotivo, setPidiendoMotivo] = React.useState<Destino | null>(null);
  const [motivo, setMotivo] = React.useState('');

  const estadosVisibles =
    FILTROS.find((f) => f.clave === filtro)?.estados ?? FILTROS[0].estados;

  const visibles = React.useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return filas.filter((f) => {
      if (!estadosVisibles.includes(f.status)) return false;
      if (!texto) return true;
      return (
        f.tirador.toLowerCase().includes(texto) ||
        f.eventoNombre.toLowerCase().includes(texto) ||
        (f.clubNombre ?? '').toLowerCase().includes(texto)
      );
    });
  }, [filas, estadosVisibles, busqueda]);

  const grupos = React.useMemo(() => {
    const mapa = new Map<
      string,
      { id: string; titulo: string; fecha: string; filas: FilaInscripcion[] }
    >();
    for (const f of visibles) {
      const actual = mapa.get(f.eventId);
      if (actual) actual.filas.push(f);
      else
        mapa.set(f.eventId, {
          /*
            El id del torneo viaja DENTRO del grupo porque es lo que después
            identifica la sección en React. Ver el comentario de la clave,
            abajo.
          */
          id: f.eventId,
          titulo: titular(f.eventoNombre),
          fecha: f.eventoInicio,
          filas: [f],
        });
    }
    return [...mapa.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [visibles]);

  // Al cambiar de filtro se sueltan las que ya no se ven: aprobar a ciegas
  // algo que no está en pantalla es exactamente el error que hay que evitar.
  React.useEffect(() => {
    setElegidas((previas) => {
      const vivas = new Set(visibles.map((f) => f.id));
      const siguiente = new Set([...previas].filter((id) => vivas.has(id)));
      return siguiente.size === previas.size ? previas : siguiente;
    });
  }, [visibles]);

  const seleccionadas = filas.filter((f) => elegidas.has(f.id));
  const sinLicencia = seleccionadas.filter((f) => !f.licenciaRfee);

  /** Las acciones que de verdad moverían algo de lo que está marcado. */
  const aplicables = ACCIONES.map((accion) => ({
    ...accion,
    cuantas: seleccionadas.filter((f) => accion.desde.includes(f.status)).length,
  })).filter((accion) => accion.cuantas > 0);

  function alternar(id: string) {
    setElegidas((previas) => {
      const siguiente = new Set(previas);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }

  function alternarGrupo(ids: string[], marcar: boolean) {
    setElegidas((previas) => {
      const siguiente = new Set(previas);
      for (const id of ids) {
        if (marcar) siguiente.add(id);
        else siguiente.delete(id);
      }
      return siguiente;
    });
  }

  async function aplicar(destino: Destino, razon?: string) {
    const accion = ACCIONES.find((a) => a.destino === destino);
    if (!accion) return;

    const aplicables = seleccionadas.filter((f) => accion.desde.includes(f.status));

    if (aplicables.length === 0) {
      toast.warning('Ninguna de las seleccionadas admite esa acción', {
        description: accion.ayuda,
      });
      return;
    }

    setOcupado(true);
    try {
      const resultado = await moverInscripciones(
        aplicables.map((f) => f.id),
        destino,
        razon,
      );
      if (resultado.ok) {
        toast.success(resultado.message);
        setElegidas(new Set());
        router.refresh();
      } else {
        toast.error(resultado.error);
      }
    } catch {
      toast.error('No se ha podido guardar el cambio. Vuelve a intentarlo.');
    } finally {
      setOcupado(false);
      setPidiendoMotivo(null);
      setMotivo('');
    }
  }

  async function exportar() {
    setOcupado(true);
    try {
      const resultado = await exportarInscripcionesCsv([...elegidas]);
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      descargar(resultado.csv.filename, resultado.csv.content);
      toast.success(
        `${resultado.csv.filas} inscripciones exportadas a ${resultado.csv.filename}.`,
        { description: 'Separador «;» y acentos preparados para Excel en español.' },
      );
    } catch {
      toast.error('No se ha podido generar el CSV.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/*
        CONTROLES EN UNA FILA, Y EL MONTÓN EN UN `SELECT`.

        Eran cinco pastillas en `ToggleGroup`, y medidas en un iPhone ocupaban
        dos pisos de 62 px cada uno más un tercero para el buscador: 190 px de
        filtros antes de la primera inscripción. Además incumplía la
        convención del proyecto (`REFERENCIAS.md` § 9.1, regla 3): elegir UNO
        de varios va en `Select`, no en una fila de pastillas, y con más de
        cuatro opciones con más razón.

        El `Select` cabe al lado del buscador y deja la lista empezando en el
        primer pliegue. El recuento de cada montón no se pierde: va dentro de
        cada opción y el del elegido se lee en el disparador.
      */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Select value={filtro} onValueChange={(valor) => valor && setFiltro(valor)}>
          <SelectTrigger
            className="h-9 w-auto min-w-44 flex-1 basis-44 sm:flex-none"
            aria-label="Qué inscripciones se enseñan"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTROS.map((f) => {
              const cuantas = filas.filter((fila) =>
                f.estados.includes(fila.status),
              ).length;
              return (
                <SelectItem key={f.clave} value={f.clave}>
                  {f.etiqueta}
                  <span className="cifra ms-1.5 text-xs text-muted-foreground">
                    {cuantas}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        {/* Icono en el móvil, campo en el escritorio. Ver `admin/buscador`. */}
        <Buscador
          valor={busqueda}
          onCambio={setBusqueda}
          etiqueta="Buscar en la bandeja"
          marcador="Buscar tirador o torneo"
        />
      </div>

      {/* Barra de acciones. Solo aparece con algo seleccionado: una barra de
          botones apagados permanentemente es ruido. */}
      {elegidas.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
          <span className="text-sm">
            <span className="cifra text-lg">{elegidas.size}</span>{' '}
            <span className="text-muted-foreground">
              {elegidas.size === 1 ? 'seleccionada' : 'seleccionadas'}
            </span>
          </span>

          {/*
            SOLO LOS BOTONES QUE HARÍAN ALGO.

            Estaban los cuatro siempre, y en un iPhone eran dos pisos de
            botones de los que tres avisaban «ninguna de las seleccionadas
            admite esa acción» al tocarlos. Un botón que solo sirve para
            explicarte que no sirve no es un botón. Ahora se pinta el que tiene
            al menos una fila a la que aplicarse, así que la barra dice qué se
            puede hacer con lo que hay marcado.
          */}
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {aplicables.map((accion) => (
              <Button
                key={accion.destino}
                size="sm"
                variant={accion.variante}
                disabled={ocupado}
                onClick={() =>
                  accion.motivo ? setPidiendoMotivo(accion.destino) : aplicar(accion.destino)
                }
              >
                {accion.etiqueta}
                <span className="cifra text-xs opacity-70">{accion.cuantas}</span>
              </Button>
            ))}
            <Button size="sm" variant="secondary" disabled={ocupado} onClick={exportar}>
              {ocupado ? <Loader2 className="animate-spin" /> : <Download />}
              Exportar CSV
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setElegidas(new Set())}
              disabled={ocupado}
            >
              Quitar selección
            </Button>
          </div>

          {sinLicencia.length > 0 ? (
            <p className="flex w-full items-start gap-1.5 text-xs text-warn">
              <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
              {sinLicencia.length === 1
                ? `${sinLicencia[0].tirador} no tiene licencia RFEE en su ficha: esa celda saldrá vacía en el CSV.`
                : `${sinLicencia.length} de las seleccionadas no tienen licencia RFEE en su ficha: esas celdas saldrán vacías en el CSV.`}
            </p>
          ) : null}
        </div>
      ) : null}

      {grupos.length === 0 ? (
        <Vacio
          titulo="Aquí no hay nada esperando"
          explicacion={
            busqueda
              ? `Ninguna inscripción coincide con «${busqueda}» en este montón. Prueba con «Todas».`
              : 'Cuando alguien pida inscripción desde su pantalla de estado, aparecerá aquí en «Sin revisar» para darla por buena, aprobarla y exportarla.'
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {grupos.map((grupo) => {
            const ids = grupo.filas.map((f) => f.id);
            const todas = ids.every((id) => elegidas.has(id));
            const algunas = !todas && ids.some((id) => elegidas.has(id));

            return (
              /*
                LA CLAVE ES EL ID DEL TORNEO, NO SU NOMBRE Y SU FECHA.

                Era `titulo + fecha`, y eso se repite de verdad en este
                calendario: el 4 de octubre hay **dos** «TNR M17», uno en
                Alcobendas y otro en Sabadell. Dos torneos distintos con el
                mismo nombre el mismo día, que es lo normal en una jornada de
                liga repartida por sedes.

                React avisaba de ello en cada carga de `/admin/inscripciones`
                —«Encountered two children with the same key»— y el riesgo no
                es el aviso: con claves repetidas React puede reutilizar el
                estado de una sección en otra, o sea marcar las inscripciones
                de un torneo y que la marca aparezca en el de al lado. En una
                pantalla desde la que se aprueban inscripciones, eso no es
                cosmético.

                El grupo ya se agrupaba por `eventId`; solo faltaba usarlo.
              */
              <section key={grupo.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Checkbox
                    checked={todas}
                    onCheckedChange={(valor) => alternarGrupo(ids, valor === true)}
                    aria-label={`Seleccionar las ${ids.length} inscripciones de ${grupo.titulo}`}
                  />
                  <h2 className="min-w-0 text-base">{grupo.titulo}</h2>
                  {/* Cada dato con su rótulo, no encadenados con puntos. */}
                  <span className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                    <span>{formatDateEs(grupo.fecha)}</span>
                    <span>
                      <span className="cifra text-foreground">
                        {grupo.filas.length}
                      </span>{' '}
                      {grupo.filas.length === 1 ? 'inscripción' : 'inscripciones'}
                    </span>
                    {algunas ? (
                      <span className="text-primary-text">
                        <span className="cifra">
                          {ids.filter((id) => elegidas.has(id)).length}
                        </span>{' '}
                        seleccionadas
                      </span>
                    ) : null}
                  </span>
                </div>

                <ul className="divide-y overflow-hidden rounded-lg border-t border-filete bg-card">
                  {grupo.filas.map((f) => (
                    <li
                      key={f.id}
                      className={cn(
                        'grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 px-3 py-3 sm:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center',
                        /*
                          La fila marcada, con el token del proyecto. Iba con
                          `bg-accent/40`, que es un alfa de superficie: está
                          prohibido porque el mismo marcado sale de un color
                          distinto según lo que tenga detrás y deja pasar la
                          textura del lienzo. Y al 40 % de un gris que ya está
                          a medio paso de la tarjeta, no se veía. Ahora es la
                          misma señal que en el resto de la aplicación, y la
                          casilla marcada la acompaña como señal de forma.
                        */
                        elegidas.has(f.id) && 'bg-marcado',
                      )}
                    >
                      <Checkbox
                        checked={elegidas.has(f.id)}
                        onCheckedChange={() => alternar(f.id)}
                        aria-label={`Seleccionar la inscripción de ${f.tirador}`}
                        className="mt-1 sm:mt-0"
                      />

                      <div className="flex min-w-0 flex-col">
                        {/*
                          El nombre NO se recorta con puntos: envuelve. Un
                          nombre a medias en una bandeja donde se aprueba gente
                          es exactamente el dato que no se puede adivinar.
                        */}
                        <span className="text-[0.95rem] font-medium leading-tight">
                          {f.tirador}
                        </span>
                        <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="min-w-0">
                            {f.clubNombre ?? 'Sin club en su ficha'}
                          </span>
                          {f.licenciaRfee ? (
                            <span>
                              Licencia{' '}
                              <span className="tabular-nums text-foreground">
                                {f.licenciaRfee}
                              </span>
                            </span>
                          ) : null}
                        </span>
                      </div>

                      <div className="col-start-2 flex min-w-0 flex-col sm:col-start-3">
                        {/*
                          Arma y género en blanco, categoría y formato
                          apagados. Es la misma información que daba
                          «Sable femenino · M17» pero jerarquizada: lo que
                          se busca al repasar la bandeja es el arma.
                        */}
                        <span className="text-sm">
                          {WEAPON_LABEL[f.weapon as keyof typeof WEAPON_LABEL] ??
                            f.weapon}{' '}
                          {(
                            GENDER_LABEL[f.gender as keyof typeof GENDER_LABEL] ??
                            f.gender
                          ).toLowerCase()}{' '}
                          <span className="text-muted-foreground">
                            {CATEGORY_LABEL[
                              f.category as keyof typeof CATEGORY_LABEL
                            ] ?? f.category}
                            {f.format === 'EQUIPOS' ? ', equipos' : ''}
                          </span>
                        </span>
                        <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span>
                            {f.diasHastaEvento <= 0 ? (
                              'Empieza hoy'
                            ) : f.diasHastaEvento === 1 ? (
                              'Empieza mañana'
                            ) : (
                              <>
                                Faltan{' '}
                                <span className="cifra text-foreground">
                                  {f.diasHastaEvento}
                                </span>{' '}
                                días
                              </>
                            )}
                          </span>
                          {f.eventoCiudad ? <span>{f.eventoCiudad}</span> : null}
                        </span>
                      </div>

                      <div className="col-start-2 flex flex-wrap items-center gap-1.5 sm:col-start-4 sm:justify-end">
                        {!f.licenciaRfee ? (
                          <Badge
                            variant="outline"
                            className="gap-1 border-warn/40 font-normal text-warn"
                          >
                            <TriangleAlert className="size-3" aria-hidden />
                            Sin licencia
                          </Badge>
                        ) : null}
                        <span
                          className={cn('text-xs font-medium', TONO_ESTADO[f.status])}
                        >
                          {ESTADO_FEDERACION[f.status]}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <Dialog
        open={pidiendoMotivo !== null}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setPidiendoMotivo(null);
            setMotivo('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar la inscripción</DialogTitle>
            <DialogDescription>
              El motivo llega al tirador y queda en el historial de la
              inscripción. Sin él no se sabe qué hay que arreglar.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="motivo-inscripcion">Motivo</Label>
            <Textarea
              id="motivo-inscripcion"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              placeholder="Falta la licencia federativa en vigor."
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setPidiendoMotivo(null);
                setMotivo('');
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={ocupado || motivo.trim().length === 0}
              onClick={() => pidiendoMotivo && aplicar(pidiendoMotivo, motivo.trim())}
            >
              {ocupado ? <Loader2 className="animate-spin" /> : null}
              Rechazar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Descarga en el navegador.
 *
 * El CSV lo genera el servidor y viaja como texto: así la acción puede
 * comprobar permisos y leer la base, y el navegador solo pone el nombre del
 * fichero. Un enlace a una ruta de descarga exigiría otra ruta autenticada
 * para lo mismo.
 */
function descargar(nombre: string, contenido: string) {
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}
