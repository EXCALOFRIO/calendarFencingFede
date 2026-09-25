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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
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
 * Bandeja federativa.
 *
 * Se agrupa POR COMPETICIÓN y no por tirador porque la decisión se toma por
 * competición: se aprueba la lista entera de un torneo y se exporta ese CSV,
 * no una inscripción suelta. Agrupado por tirador habría que ir saltando de
 * un sitio a otro para reunir la misma lista.
 *
 * No hay tabla: en un iPhone una tabla de siete columnas se sale de la
 * pantalla o se convierte en un desplazamiento lateral que nadie descubre.
 * Cada fila es una rejilla que se apila en móvil y se alinea en columnas a
 * partir de `sm`.
 */

type Destino = Extract<
  EntryStatus,
  'federation_approved' | 'submitted' | 'pending_club' | 'rejected'
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
    destino: 'federation_approved',
    etiqueta: 'Aprobar (federación)',
    desde: ['club_approved'],
    motivo: false,
    variante: 'default',
    ayuda: 'Solo se puede aprobar lo que ya validó el club.',
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
    destino: 'pending_club',
    etiqueta: 'Devolver al club',
    desde: ['club_approved'],
    motivo: true,
    variante: 'outline',
    ayuda: 'Solo se devuelve al club lo que el club ya había validado.',
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

const FILTROS: { clave: string; etiqueta: string; estados: EntryStatus[] }[] = [
  { clave: 'rfee', etiqueta: 'Esperan a la RFEE', estados: ['club_approved'] },
  { clave: 'enviar', etiqueta: 'Listas para enviar', estados: ['federation_approved'] },
  { clave: 'club', etiqueta: 'En el club', estados: ['pending_club'] },
  { clave: 'enviadas', etiqueta: 'Enviadas', estados: ['submitted'] },
  {
    clave: 'todas',
    etiqueta: 'Todas',
    estados: ['pending_club', 'club_approved', 'federation_approved', 'submitted'],
  },
];

/**
 * Cómo se llama cada estado DESDE LA FEDERACIÓN.
 *
 * `ENTRY_STATUS_LABEL` está escrito para el tirador («Pendiente de tu club»,
 * «Aceptada por la RFEE») y aquí quedaba raro: en esta pantalla la RFEE es
 * quien mira, así que el club es «su club» y la RFEE somos nosotros. Es la
 * misma máquina de estados con otra voz, no otra máquina de estados.
 */
const ESTADO_FEDERACION: Record<EntryStatus, string> = {
  draft: 'Borrador del club',
  pending_club: 'En su club, sin validar',
  club_approved: 'Validada por su club',
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
  const [filtro, setFiltro] = React.useState('rfee');
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
    const mapa = new Map<string, { titulo: string; fecha: string; filas: FilaInscripcion[] }>();
    for (const f of visibles) {
      const actual = mapa.get(f.eventId);
      if (actual) actual.filas.push(f);
      else
        mapa.set(f.eventId, {
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
      {/* Controles en UNA fila que envuelve. */}
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          value={filtro}
          onValueChange={(valor) => valor && setFiltro(valor)}
          variant="outline"
          size="sm"
          spacing={1}
          className="max-w-full flex-wrap"
        >
          {FILTROS.map((f) => {
            const cuantas = filas.filter((fila) => f.estados.includes(fila.status)).length;
            return (
              <ToggleGroupItem key={f.clave} value={f.clave} className="gap-1.5">
                {f.etiqueta}
                <span className="cifra text-xs text-muted-foreground">{cuantas}</span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>

        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar tirador, club o torneo"
          className="h-8 w-full sm:w-56"
          aria-label="Buscar en la bandeja"
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

          <div className="ms-auto flex flex-wrap items-center gap-2">
            {ACCIONES.map((accion) => (
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
              ? `Ninguna inscripción coincide con «${busqueda}» en este filtro. Prueba con «Todas».`
              : 'Cuando un club valide una solicitud, aparecerá en esta lista para que la federación la apruebe y la exporte.'
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {grupos.map((grupo) => {
            const ids = grupo.filas.map((f) => f.id);
            const todas = ids.every((id) => elegidas.has(id));
            const algunas = !todas && ids.some((id) => elegidas.has(id));

            return (
              <section key={grupo.titulo + grupo.fecha} className="flex flex-col gap-2">
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

                <ul className="divide-y overflow-hidden rounded-lg border bg-card">
                  {grupo.filas.map((f) => (
                    <li
                      key={f.id}
                      className={cn(
                        'grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 px-3 py-3 sm:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1.2fr)_auto] sm:items-center',
                        elegidas.has(f.id) && 'bg-accent/40',
                      )}
                    >
                      <Checkbox
                        checked={elegidas.has(f.id)}
                        onCheckedChange={() => alternar(f.id)}
                        aria-label={`Seleccionar la inscripción de ${f.tirador}`}
                        className="mt-0.5 sm:mt-0"
                      />

                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{f.tirador}</span>
                        <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                          <span className="min-w-0 truncate">
                            {f.clubNombre ?? 'Sin club en su ficha'}
                          </span>
                          {f.licenciaRfee ? (
                            <span>
                              Licencia{' '}
                              <span className="text-foreground">
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
                        <span className="truncate text-sm">
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
                        <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
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
                          {f.eventoCiudad ? (
                            <span className="min-w-0 truncate">
                              {f.eventoCiudad}
                            </span>
                          ) : null}
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
            <DialogTitle>
              {pidiendoMotivo === 'rejected' ? 'Rechazar' : 'Devolver al club'}
            </DialogTitle>
            <DialogDescription>
              El motivo llega al club y al tirador, y queda en el historial de la
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
              disabled={ocupado || motivo.trim().length === 0}
              onClick={() => pidiendoMotivo && aplicar(pidiendoMotivo, motivo.trim())}
            >
              {ocupado ? <Loader2 className="animate-spin" /> : null}
              {pidiendoMotivo === 'rejected' ? 'Rechazar' : 'Devolver al club'}
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
