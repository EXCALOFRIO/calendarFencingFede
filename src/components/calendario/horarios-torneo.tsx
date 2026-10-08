'use client';

import { FilaHorario, MarcaDia } from '@/components/sistema/hora-doble';
import type { CompetitionView, DatoExtraidoView, EventView } from '@/lib/queries/calendar';
import { rotuloPrueba } from '@/lib/sport/rotulos';
import { cn } from '@/lib/utils';

import {
  convertirHora,
  leerHora,
  mismoReloj,
  siglasHuso,
  useHusoDispositivo,
} from '@/lib/huso-dispositivo';
import { huecoDe } from './datos-convocatoria';

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
 * Así que se enseña el torneo entero como una línea de tiempo: un titular por
 * día y debajo cada hito con su hora y la prueba a la que va. En Takamatsu:
 *
 *   JST     Horario                          Tu hora
 *   Jue 15 oct
 *   07:00   Apertura y control de armas      00:00
 *           Florete masculino
 *   09:00   Poules y primeras directas       02:00
 *           Florete masculino
 *
 * Tres columnas fijas en cada fila (`FilaHorario`): hora de la sede, qué es y
 * para qué prueba, y la hora del dispositivo con «−1 día» si cambia el día.
 *
 * Dentro del día van **por hora**: cada fila dice su prueba, así que mezclar
 * armas no confunde y es como se vive el día en el pabellón. A igual hora,
 * el orden de la competición (se abre, se verifica, se llama, se tira).
 *
 * ---------------------------------------------------------------------------
 * DE DÓNDE SALE CADA HORA, Y EN QUÉ HUSO ESTÁ
 * ---------------------------------------------------------------------------
 *  · las **columnas publicadas** de la prueba (`installation_open`,
 *    `call_time`, `scratch_time`, `start_time`), sin marca;
 *  · lo **leído de la convocatoria**, cuya frase literal se ve desde «Según la
 *    convocatoria», al pie de la banda.
 *
 * Las dos están en **hora de la sede**, que es como las escribe quien
 * organiza. Si el dispositivo está en otro reloj, cada fila lleva al lado la
 * misma hora convertida, y la cabecera dice cuál es cuál.
 *
 * ---------------------------------------------------------------------------
 * LO QUE NO SE HACE
 * ---------------------------------------------------------------------------
 * No se rellena ningún día vacío ni se deduce que «si las poules son a las 9,
 * la llamada será a las 8:30». Un día sin datos no aparece. En esta pantalla
 * una hora inventada la paga alguien llegando tarde.
 */

/** Los campos de un día de competición, en el orden en que ocurren. */
const HITOS = [
  'accreditation',
  'installation_open',
  'weapon_control',
  'call_time',
  'scratch_time',
  'pools_start',
  'start_time',
  'semifinals_start',
  'final_start',
  'teams_start',
] as const;

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

export type HitoHorario = {
  /** Campo base (`pools_start`), sin el sufijo de día y prueba. */
  campo: string;
  rotulo: string;
  hora: string;
  dato: DatoExtraidoView | null;
  /** `null` cuando el hito es del torneo y no de una prueba concreta. */
  prueba: CompetitionView | null;
  /** A qué va: «Florete femenino · equipos», o lo que diga el PDF si es del torneo. */
  aQue: string | null;
};

export type DiaHorario = {
  fecha: string;
  /**
   * La apertura del pabellón, que vale para todo el día: va en el titular del
   * día y no como una fila por prueba. Si se leyeron varias, la más temprana.
   */
  apertura: HitoHorario | null;
  hitos: HitoHorario[];
};

const esApertura = (h: HitoHorario) => h.campo === 'installation_open' && h.rotulo === 'Apertura del pabellón';

function aplanar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[’']/g, ' ')
    .toLowerCase();
}

/**
 * El nombre del hito en castellano, con lo que añade la propia frase.
 *
 * El campo dice qué tipo de hora es (`pools_start`) y la frase dice el resto:
 * «09:00 Women's Foil Pools & Preliminary DE tableau» son las poules **y las
 * primeras directas**, y «T64 starting time» es el cuadro de 64. Se lee solo
 * lo que cambia el significado; si la frase no dice nada de eso, queda el
 * nombre del campo.
 */
export function rotuloDeHito(campo: string, dato: DatoExtraidoView | null): string {
  const texto = aplanar(`${dato?.cita ?? ''} ${dato?.prueba ?? ''}`);
  const cuadro = texto.match(/\bt\s?(8|16|32|64|128|256)\b/)?.[1];
  const siHaceFalta = /if necessary|si (es|fuera) necesario|si procede|si hace falta/.test(texto)
    ? ' (si hace falta)'
    : '';

  switch (campo) {
    case 'accreditation':
      return 'Acreditación';
    case 'installation_open':
      return /weapon control|control de (armas|material)|verificacion/.test(texto)
        ? 'Apertura y control de armas'
        : 'Apertura del pabellón';
    case 'weapon_control':
      return /registration|acreditacion|registro|inscripcion/.test(texto)
        ? 'Control de armas y acreditación'
        : 'Control de armas';
    case 'call_time':
      return 'Llamada';
    case 'scratch_time':
      return 'Confirmación de presencia';
    case 'pools_start':
      return /preliminary|de tableau|direct elimination|eliminacion directa|directas/.test(texto)
        ? 'Poules y primeras directas'
        : 'Poules';
    case 'start_time':
      if (/training|entrenamiento|entrainement/.test(texto)) return 'Entrenamiento';
      return cuadro ? `Cuadro de ${cuadro}${siHaceFalta}` : `Inicio${siHaceFalta}`;
    case 'semifinals_start':
      return 'Semifinales';
    case 'final_start':
      return /\bfinals\b|\bfinales\b/.test(texto) ? 'Finales' : 'Final';
    case 'teams_start':
      return cuadro ? `Cuadro de ${cuadro}${siHaceFalta}` : `Comienzo${siHaceFalta}`;
    default:
      return campo;
  }
}

/** «Florete femenino», «Espada femenina M17 · Equipos»; la categoría sólo si el torneo tiene varias. */
export function nombreCortoDePrueba(p: CompetitionView, conCategoria: boolean): string {
  return rotuloPrueba(
    { arma: p.weapon, genero: p.gender, categoria: p.category, formato: p.format },
    { categoria: conCategoria ? 'si-no-absoluto' : 'nunca' },
  );
}

/**
 * A qué va un hito del torneo que el reparto no pudo atribuir a una prueba.
 *
 * Solo se dice lo que el PDF dice con claridad: «Team Event» son los equipos.
 * Lo demás («Training available in the sub-arena») ya lo cuenta el rótulo, y
 * repetir el texto en inglés al lado sería el ruido que se está quitando.
 */
function aQueDelTorneo(textoPrueba: string | null): string | null {
  if (!textoPrueba) return null;
  const t = aplanar(textoPrueba);
  if (/\bteams?\b|\bequipos?\b|\bequipes\b/.test(t)) return 'Equipos';
  if (/\bindividual\b|\bindividuel\b/.test(t)) return 'Individual';
  return null;
}

function minutosDe(hora: string): number {
  const hm = leerHora(hora);
  return hm ? hm[0] * 60 + hm[1] : 24 * 60;
}

/**
 * Los días del torneo con sus hitos, y qué datos del PDF se han usado.
 *
 * `usados` existe para la lista de «otros datos» del final de la ficha: lo que
 * entra aquí ya se ve con su cita y no se repite allí; lo que no entra —una
 * hora sin día, o la segunda lectura del mismo hito— sigue estando allí.
 *
 * Los hitos que no se pudieron atribuir a ninguna prueba —«7:30 Venue Open»,
 * que vale para todo el torneo— van en su día sin prueba: `repartirDatos` no
 * los atribuyó porque el documento no dice a cuál van, y ponerlos dentro de
 * una prueba sería adivinar.
 */
export function horariosDelTorneo(evento: EventView): {
  dias: DiaHorario[];
  usados: Set<string>;
} {
  const porDia = new Map<string, HitoHorario[]>();
  const vistos = new Set<string>();
  const usados = new Set<string>();
  const conCategoria = new Set(evento.competitions.map((c) => c.category)).size > 1;

  const anota = (fecha: string | null, hito: HitoHorario) => {
    if (!fecha) return;
    // El mismo hito el mismo día y en la misma prueba es una lectura repetida
    // de dos documentos: se queda la primera.
    const clave = `${fecha}|${hito.prueba?.id ?? ''}|${hito.campo}`;
    if (vistos.has(clave)) return;
    vistos.add(clave);
    if (hito.dato) usados.add(hito.dato.id);
    const lista = porDia.get(fecha) ?? [];
    lista.push(hito);
    porDia.set(fecha, lista);
  };

  for (const prueba of evento.competitions) {
    const aQue = nombreCortoDePrueba(prueba, conCategoria);
    for (const campo of HITOS) {
      const publicada = horaPublicada(prueba, campo);
      if (publicada) {
        anota(prueba.competitionDate, {
          campo,
          rotulo: rotuloDeHito(campo, null),
          hora: publicada,
          dato: null,
          prueba,
          aQue,
        });
        continue;
      }
      /*
        Puede haber VARIOS del mismo campo en días distintos: el control de
        material de Takamatsu está el 14 para el florete masculino y el 15 para
        el femenino. Así que no vale `huecoDe`, que devuelve uno: se recorren
        todos y cada uno va a su día.
      */
      for (const d of prueba.datosExtraidos) {
        if (d.campo !== campo && !d.campo.startsWith(`${campo}.`)) continue;
        anota(d.fecha ?? prueba.competitionDate, {
          campo,
          rotulo: rotuloDeHito(campo, d),
          hora: d.valor,
          dato: d,
          prueba,
          aQue,
        });
      }
    }
  }

  for (const campo of HITOS) {
    for (const d of evento.datosExtraidos) {
      if (d.campo !== campo && !d.campo.startsWith(`${campo}.`)) continue;
      /*
        La misma hora del mismo hito ya está en una prueba de ese día: es el
        mismo dato leído sin prueba (la circular de un TNR repite «Llamada
        08:30» en la cabecera y en la tabla). Dos filas iguales, una con prueba
        y otra sin ella, se leían como dos llamadas distintas.
      */
      const repetido = (porDia.get(d.fecha ?? '') ?? []).some(
        (h) => h.prueba !== null && h.campo === campo && h.hora.trim() === d.valor.trim(),
      );
      if (repetido) {
        usados.add(d.id);
        continue;
      }
      anota(d.fecha, {
        campo,
        rotulo: rotuloDeHito(campo, d),
        hora: d.valor,
        dato: d,
        prueba: null,
        aQue: aQueDelTorneo(d.prueba),
      });
    }
  }

  const orden = new Map(evento.competitions.map((c, i) => [c.id, i]));
  const dias = [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, todos]) => {
      const hitos = todos.sort(
        (a, b) =>
          minutosDe(a.hora) - minutosDe(b.hora) ||
          HITOS.indexOf(a.campo as (typeof HITOS)[number]) -
            HITOS.indexOf(b.campo as (typeof HITOS)[number]) ||
          (a.prueba ? (orden.get(a.prueba.id) ?? 99) : -1) -
            (b.prueba ? (orden.get(b.prueba.id) ?? 99) : -1),
      );
      return { fecha, apertura: hitos.find(esApertura) ?? null, hitos: hitos.filter((h) => !esApertura(h)) };
    });
  return { dias, usados };
}

const DIA = new Intl.DateTimeFormat('es-ES', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** «Jue 16 oct», sin los puntos ni la coma que pone Intl. */
export function tituloDeDia(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const texto = DIA.format(new Date(Date.UTC(y, m - 1, d, 12)))
    .replace(/\./g, '')
    .replace(',', '');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Las tres columnas del horario, las mismas que `FilaHorario`: la cabecera y
 * el titular de cada día caen así en la misma vertical que las filas.
 */
const COLUMNAS = 'grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] gap-x-3';

export function HorariosTorneo({
  evento,
  prueba,
}: {
  evento: EventView;
  /** La prueba que está seleccionada arriba, para destacar sus filas. */
  prueba: CompetitionView | null;
}) {
  const huso = useHusoDispositivo();
  const { dias } = horariosDelTorneo(evento);

  // Sin horas publicadas no hay recuadro ni frase que lo diga (`UI.md`, 2 bis).
  if (dias.length === 0) return null;

  const husoSede = evento.timezone;
  /**
   * La columna de la derecha sólo se rellena cuando los relojes no coinciden.
   * Sin huso de la sede no se convierte nada: la hora es la que escribe la
   * convocatoria, que es la local.
   */
  const dosRelojes = husoSede !== null && !mismoReloj(husoSede, huso, evento.startDate);
  const tuya = (fecha: string, hora: string) =>
    dosRelojes && husoSede ? convertirHora(fecha, hora, husoSede, huso) : null;

  return (
    <section aria-label="Horario" className="flex flex-col overflow-hidden rounded-xl border border-filete bg-card">
      <header className={cn(COLUMNAS, 'items-center border-b border-filete px-3 py-2 text-xs text-muted-foreground')}>
        <span>{dosRelojes && husoSede ? siglasHuso(husoSede, evento.startDate) : null}</span>
        <h4 className="text-sm font-semibold text-foreground">Horario</h4>
        <span className="text-right">{dosRelojes ? 'Tu hora' : null}</span>
      </header>

      <ol className="flex flex-col">
        {dias.map((dia) => {
          const apertura = dia.apertura ? tuya(dia.fecha, dia.apertura.hora) : null;
          return (
            <li key={dia.fecha} className="border-b border-filete last:border-b-0">
              {/* El día, y la apertura del pabellón, que vale para todo el día. */}
              <div className={cn(COLUMNAS, 'items-start px-3 pt-3 pb-1')}>
                <h5 className="col-span-2 text-sm font-medium text-muted-foreground">
                  {tituloDeDia(dia.fecha)}
                  {dia.apertura ? (
                    <>
                      {' · '}abre <span className="font-semibold text-foreground tabular-nums">{dia.apertura.hora}</span>
                    </>
                  ) : null}
                </h5>
                <span className="flex flex-col items-end gap-1 text-sm text-muted-foreground tabular-nums">
                  {apertura ? (
                    <>
                      {apertura.hora}
                      <MarcaDia dias={apertura.dias} />
                    </>
                  ) : null}
                </span>
              </div>
              <ul className="flex flex-col divide-y divide-filete">
                {dia.hitos.map((h) => {
                  const destacada = prueba !== null && h.prueba?.id === prueba.id;
                  return (
                    <li
                      key={`${h.prueba?.id ?? ''}|${h.campo}|${h.hora}|${h.dato?.id ?? ''}`}
                      data-destacada={destacada || undefined}
                      // La prueba elegida, con fondo y filete interior: no desplaza el texto.
                      className={cn(destacada && 'bg-marcado shadow-[inset_2px_0_0_var(--primary)]')}
                    >
                      <FilaHorario
                        hora={h.hora}
                        titulo={h.rotulo}
                        subtitulo={h.aQue}
                        local={tuya(dia.fecha, h.hora)}
                        etiquetaLocal="tu hora"
                        className="px-3"
                      />
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * El acceso al pabellón, que NO es la dirección: en Lima el pabellón es
 * «VELODROMO - CAR VIDENA (GATE 7)» y se entra por «Av. San Luis N° 1308»,
 * otra calle. Quien llega a la dirección del recinto y no sabe esto se queda
 * fuera. `null` si no se sabe, no es creíble o repite la dirección.
 */
export function accesoVisible(evento: EventView, direccion: string | null = null): DatoExtraidoView | null {
  const acceso = huecoDe(evento.datosExtraidos, 'venue_access', evento.city);
  if (!acceso || !accesoCreible(acceso.valor) || accesoRepiteDireccion(acceso.valor, direccion)) return null;
  return acceso;
}

/**
 * ¿El acceso dice lo mismo que la dirección? En Samsun el dossier escribe la
 * misma calle en «dirección» y en «acceso», y la ficha la repetía dos líneas
 * más abajo con otro rótulo.
 */
export function accesoRepiteDireccion(acceso: string, direccion: string | null): boolean {
  if (!direccion) return false;
  const a = aplanar(acceso).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const d = aplanar(direccion).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return a === d || d.includes(a) || a.includes(d);
}

/**
 * Un acceso que es el nombre de una prueba no es un acceso. En un TNR de
 * Medina del Campo se leyó «Se entra por: ESPADA MASCULINO», que es el rótulo
 * de la columna de al lado en la circular.
 */
export function accesoCreible(acceso: string): boolean {
  return !/^\s*(espada|florete|sable|epee|foil|sabre)\b[\s\w’']*$/i.test(aplanar(acceso));
}
