'use client';

import { Badge } from '@/components/ui/badge';
import type { CompetitionView, DatoExtraidoView, EventView } from '@/lib/queries/calendar';
import {
  CATEGORY_LABEL,
  CATEGORY_SHORT,
  GENDER_SHORT,
  WEAPON_SHORT,
  cn,
} from '@/lib/utils';
import { CitaConvocatoria, MarcaConvocatoria, huecoDe } from './datos-convocatoria';

/**
 * ===========================================================================
 * LOS HORARIOS DEL TORNEO, DÍA A DÍA
 * ===========================================================================
 *
 * Antes esto era **una sola línea con los hitos de la prueba seleccionada**, y
 * eso se queda corto en cuanto el torneo dura más de un día, que es siempre.
 * Petición literal del usuario, con el caso:
 *
 *   «en los de la FIE o muchas TNR suele haber viernes y sábado la individual
 *    y el domingo la de por equipos, así que ponlo todo junto en la tarjeta y
 *    pon como en la tabla de horario eso por los días, que se vea claro»
 *
 *   «pon los horarios de cada prueba, no solo inicio, y de cada día, por cuál
 *    competición, son varios días»
 *
 * Así que se enseña el torneo entero: una fila por día y por prueba, con TODOS
 * los hitos que se sepan de cada una. En la Copa del Mundo de Lima eso es:
 *
 *   mié 7 oct               16:00 acreditación
 *   jue 8 oct               07:30 apertura
 *   vie 9 oct  FLO M Jún    09:00 poules
 *   vie 9 oct  FLO M        17:00 final
 *   dom 11 oct FLO M · eq.  09:00 equipos
 *
 * ---------------------------------------------------------------------------
 * DE DÓNDE SALE CADA HORA
 * ---------------------------------------------------------------------------
 * De dos sitios, y se distinguen en pantalla:
 *
 *  · las **columnas publicadas** de la prueba (`installation_open`,
 *    `call_time`, `scratch_time`, `start_time`), que es lo poco que publica
 *    Skermo. Van en blanco y sin marca;
 *  · lo **leído de la convocatoria**, que es casi todo en los torneos
 *    internacionales. Va en gris, con la marca de documento leído, y al tocarlo
 *    sale la frase literal del PDF.
 *
 * Los hitos van en el orden del día de competición, no por hora: se acredita,
 * se abre la instalación, se verifica el material, se llama, se cierra el
 * scratch, se tiran las poules y se tira el cuadro. Ordenarlos por hora
 * mezclaría la final de las 17:00 de un arma con las poules de las 09:00 de
 * otra y dejaría de leerse como un día.
 *
 * ---------------------------------------------------------------------------
 * LO QUE NO SE HACE
 * ---------------------------------------------------------------------------
 * No se rellena ningún día vacío ni se deduce que «si las poules son a las 9,
 * la llamada será a las 8:30». Un día sin datos no aparece. En esta pantalla
 * una hora inventada la paga alguien llegando tarde.
 */

/** Los hitos de un día de competición, en el orden en que ocurren. */
const HITOS: [rotulo: string, campo: string][] = [
  ['acreditación', 'accreditation'],
  ['apertura', 'installation_open'],
  ['material', 'weapon_control'],
  ['llamada', 'call_time'],
  ['scratch', 'scratch_time'],
  ['poules', 'pools_start'],
  ['inicio', 'start_time'],
  ['semifinales', 'semifinals_start'],
  ['final', 'final_start'],
  ['equipos', 'teams_start'],
];

/** Qué columna publicada corresponde a cada campo, cuando hay una. */
function horaPublicada(prueba: CompetitionView, campo: string): string | null {
  switch (campo) {
    case 'installation_open':
      return prueba.installationOpen;
    case 'call_time':
      return prueba.callTime;
    case 'scratch_time':
      return prueba.scratchTime;
    case 'start_time':
      return prueba.startTime;
    default:
      return null;
  }
}

type Hito = { rotulo: string; hora: string; dato: DatoExtraidoView | null };

type FilaDia = {
  fecha: string;
  /** `null` cuando el hito es del torneo y no de una prueba concreta. */
  prueba: CompetitionView | null;
  hitos: Hito[];
};

const DIA_LARGO = new Intl.DateTimeFormat('es-ES', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Madrid',
});

/** «vie 9 oct», sin los puntos que Intl pone en algunos meses. */
function diaLargo(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return DIA_LARGO.format(new Date(Date.UTC(y, m - 1, d, 12))).replace(/\./g, '');
}

function etiquetaPrueba(p: CompetitionView): string {
  const categoria =
    CATEGORY_SHORT[p.category] ??
    CATEGORY_LABEL[p.category as keyof typeof CATEGORY_LABEL] ??
    p.category;
  return `${WEAPON_SHORT[p.weapon]} ${GENDER_SHORT[p.gender]} ${categoria}${
    p.format === 'EQUIPOS' ? ' · equipos' : ''
  }`;
}

/**
 * Construye las filas: un día y una prueba por fila.
 *
 * Los hitos del evento que no se pudieron atribuir a ninguna prueba —«7:30
 * Venue Open», que vale para todo el torneo— salen con `prueba: null` y en su
 * día, antes de las pruebas de ese mismo día. Es lo honesto: `repartirDatos`
 * no los atribuyó porque el documento no dice a cuál van, y ponerlos dentro de
 * una prueba sería adivinar.
 */
function filasPorDia(evento: EventView): FilaDia[] {
  const filas = new Map<string, FilaDia>();

  const anota = (
    fecha: string | null,
    prueba: CompetitionView | null,
    hito: Hito,
  ) => {
    if (!fecha) return;
    const clave = `${fecha}|${prueba?.id ?? ''}`;
    const fila = filas.get(clave) ?? { fecha, prueba, hitos: [] };
    // Un mismo rótulo dos veces en el mismo día y la misma prueba es el mismo
    // hito leído de dos documentos: se queda el primero, que es el que ganó en
    // `huecoDe`, y el otro sigue en la lista de frases del PDF.
    if (!fila.hitos.some((h) => h.rotulo === hito.rotulo)) fila.hitos.push(hito);
    filas.set(clave, fila);
  };

  for (const prueba of evento.competitions) {
    for (const [rotulo, campo] of HITOS) {
      const publicada = horaPublicada(prueba, campo);
      if (publicada) {
        anota(prueba.competitionDate, prueba, { rotulo, hora: publicada, dato: null });
        continue;
      }
      /*
        Puede haber VARIOS del mismo campo en días distintos: el control de
        material de Takamatsu está el 14 para el florete masculino y el 15 para
        el femenino. Así que no vale `huecoDe`, que devuelve uno: se recorren
        todos los que hay de ese campo y cada uno va a su día.
      */
      const leidos = prueba.datosExtraidos.filter(
        (d) => d.campo === campo || d.campo.startsWith(`${campo}.`),
      );
      for (const d of leidos) {
        anota(d.fecha ?? prueba.competitionDate, prueba, {
          rotulo,
          hora: d.valor,
          dato: d,
        });
      }
    }
  }

  // Y los del torneo, sin prueba asignada.
  for (const [rotulo, campo] of HITOS) {
    const leidos = evento.datosExtraidos.filter(
      (d) => d.campo === campo || d.campo.startsWith(`${campo}.`),
    );
    for (const d of leidos) anota(d.fecha, null, { rotulo, hora: d.valor, dato: d });
  }

  const orden = new Map(evento.competitions.map((c, i) => [c.id, i]));
  return [...filas.values()]
    .map((f) => ({
      ...f,
      // Dentro de la fila, el orden del día de competición.
      hitos: f.hitos.sort(
        (a, b) =>
          HITOS.findIndex(([r]) => r === a.rotulo) -
          HITOS.findIndex(([r]) => r === b.rotulo),
      ),
    }))
    .sort(
      (a, b) =>
        a.fecha.localeCompare(b.fecha) ||
        (a.prueba ? (orden.get(a.prueba.id) ?? 99) : -1) -
          (b.prueba ? (orden.get(b.prueba.id) ?? 99) : -1),
    );
}

export function HorariosTorneo({
  evento,
  prueba,
}: {
  evento: EventView;
  /** La prueba que está seleccionada arriba, para destacar sus filas. */
  prueba: CompetitionView | null;
}) {
  const filas = filasPorDia(evento);

  if (filas.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Los horarios no están publicados. Suelen salir en la convocatoria unos
        días antes.
      </p>
    );
  }

  /** Si todo cae el mismo día, el día no distingue nada y sobra la etiqueta. */
  const variosDias = new Set(filas.map((f) => f.fecha)).size > 1;

  return (
    <div className="flex flex-col divide-y divide-filete overflow-hidden rounded-md border border-t-filete bg-card">
      {filas.map((f) => {
        const esLaSuya = prueba !== null && f.prueba?.id === prueba.id;
        return (
          <div
            key={`${f.fecha}|${f.prueba?.id ?? ''}`}
            className={cn(
              'flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-baseline sm:gap-4',
              /* La prueba que se está mirando, con el filete rojo a la
                 izquierda: es la misma señal que el resto de la aplicación usa
                 para «esto es lo tuyo», y no depende solo del color porque
                 además es una arista. */
              esLaSuya && 'border-l-2 border-l-primary bg-primary/5 pl-[10px]',
            )}
          >
            {/*
              `min-w` y no `w`: con ancho fijo, la pastilla «FLO M M20 ·
              equipos» se salía de la columna y se comía el hueco, así que
              «09:00» quedaba pegado al texto. Visto en la captura de Lima.
              Así las columnas siguen alineadas cuando los rótulos son cortos
              —que es lo que hace que esto se lea como una tabla— y crecen
              cuando uno es largo, en vez de solaparse.
            */}
            <div className="flex shrink-0 items-baseline gap-2 sm:min-w-44">
              {variosDias ? (
                <span className="cifra text-sm whitespace-nowrap">
                  {diaLargo(f.fecha)}
                </span>
              ) : null}
              {f.prueba ? (
                <Badge variant="outline" className="whitespace-nowrap text-xs">
                  {etiquetaPrueba(f.prueba)}
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">todo el torneo</span>
              )}
            </div>

            <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
              {f.hitos.map((h) => (
                <CitaConvocatoria key={h.rotulo} dato={h.dato}>
                  <span className="flex items-baseline gap-1.5">
                    <span
                      className={cn(
                        'cifra text-base leading-none sm:text-sm',
                        h.dato && h.dato.estado !== 'aprobado'
                          ? 'text-muted-foreground'
                          : '',
                      )}
                    >
                      {h.hora}
                    </span>
                    <span className="flex items-center gap-1 text-xs leading-none text-muted-foreground">
                      {h.dato ? <MarcaConvocatoria className="opacity-70" /> : null}
                      {h.rotulo}
                    </span>
                  </span>
                </CitaConvocatoria>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * El acceso al pabellón, que NO es la dirección.
 *
 * Separado a propósito, y el caso que lo justifica está en `campos.ts`: en
 * Lima el pabellón es «VELODROMO - CAR VIDENA (GATE 7)» y la entrada está en
 * «Av. San Luis N° 1308», que es otra calle. El dato se estaba leyendo y se
 * quedaba en la lista de frases del PDF, al final y plegado, o sea invisible.
 * Petición literal: *«si sabemos ya por dónde es el acceso, ponlo directo»*.
 *
 * Va debajo de la dirección y con su propio rótulo, porque quien llega a la
 * dirección del recinto y no sabe esto se queda fuera.
 */
export function AccesoAlPabellon({ evento }: { evento: EventView }) {
  const acceso = huecoDe(evento.datosExtraidos, 'venue_access', evento.city);
  if (!acceso) return null;

  return (
    <CitaConvocatoria dato={acceso}>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
        <span className="text-muted-foreground">Se entra por</span>
        <span className="min-w-0 text-foreground">
          <MarcaConvocatoria className="mr-1.5 opacity-70" />
          {acceso.valor}
        </span>
      </p>
    </CitaConvocatoria>
  );
}
