'use client';

import type { CompetitionView, DatoExtraidoView, EventView } from '@/lib/queries/calendar';
import {
  CATEGORY_LABEL,
  CATEGORY_SHORT,
  GENDER_LABEL,
  WEAPON_LABEL,
  cn,
} from '@/lib/utils';

import {
  leerHora,
  mismoReloj,
  siglasHuso,
  useHusoDispositivo,
} from '@/lib/huso-dispositivo';
import { CitaConvocatoria, MarcaConvocatoria, huecoDe } from './datos-convocatoria';
import { HoraEnTuHuso } from './ficha/horas';

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
 *   Jue 15 oct
 *     07:00  Apertura y control de armas · Florete masculino   00:00 tu hora
 *     09:00  Poules y primeras directas · Florete masculino    02:00
 *     13:00  Control de armas y acreditación · Florete femenino
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
 *  · lo **leído de la convocatoria**, con la marca de documento leído; al
 *    tocar la fila sale la frase literal del PDF.
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
      return 'Cierre del scratch';
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

/** «Florete femenino», «Florete masculino · equipos»; con categoría si el torneo tiene varias. */
export function nombreCortoDePrueba(p: CompetitionView, conCategoria: boolean): string {
  const categoria = conCategoria
    ? ` ${
        CATEGORY_SHORT[p.category] ??
        CATEGORY_LABEL[p.category as keyof typeof CATEGORY_LABEL] ??
        p.category
      }`
    : '';
  return `${WEAPON_LABEL[p.weapon]} ${GENDER_LABEL[p.gender].toLowerCase()}${categoria}${
    p.format === 'EQUIPOS' ? ' · equipos' : ''
  }`;
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
   * Solo hay dos columnas cuando los relojes no coinciden. Sin huso de la
   * sede no se convierte nada: se enseña la hora tal cual la escribe la
   * convocatoria, que es hora local, y no se dice de dónde porque no se sabe.
   */
  const dosRelojes =
    husoSede !== null && !mismoReloj(husoSede, huso, evento.startDate);

  return (
    <section
      aria-label="Horario"
      className="flex flex-col overflow-hidden rounded-lg border border-filete bg-card"
    >
      {/*
        La cabecera es la de una tabla: el titular en la columna del texto y,
        encima de cada columna de horas, su rótulo diminuto —las siglas del
        huso de la sede y «tu hora»—. Sustituye a «Hora local de Japón (JST)
        | Tu hora (CEST)», que era una frase para decir dos palabras.
      */}
      <header className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-baseline gap-x-[12px] border-b border-b-filete px-3 py-2">
        <span className="text-[12px] text-muted-foreground">
          {dosRelojes && husoSede ? siglasHuso(husoSede, evento.startDate) : null}
        </span>
        <h4 className="text-[14px] leading-[20px] font-semibold">Horario</h4>
        <span className="text-right text-[12px] text-muted-foreground">
          {dosRelojes ? 'tu hora' : null}
        </span>
      </header>

      <ol className="flex flex-col">
        {dias.map((dia) => (
          <li key={dia.fecha} className="border-b border-b-filete last:border-b-0">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 px-3 pt-2.5 pb-1">
              <h5 className="cifra text-[14px] text-muted-foreground">
                {tituloDeDia(dia.fecha)}
                {dia.apertura ? (
                  <CitaConvocatoria dato={dia.apertura.dato} className="mx-0 inline px-1">
                    <span className="font-sans text-[12px]">
                      {' · '}abre <span className="cifra text-[14px] text-foreground">{dia.apertura.hora}</span>
                    </span>
                  </CitaConvocatoria>
                ) : null}
              </h5>
              {dia.apertura && dosRelojes && husoSede ? (
                <HoraEnTuHuso fecha={dia.fecha} hora={dia.apertura.hora} husoSede={husoSede} />
              ) : null}
            </div>
            <ul className="flex flex-col pb-1.5">
              {dia.hitos.map((h) => (
                <FilaHito
                  key={`${h.prueba?.id ?? ''}|${h.campo}|${h.hora}|${h.dato?.id ?? ''}`}
                  hito={h}
                  fecha={dia.fecha}
                  husoSede={dosRelojes ? husoSede : null}
                  destacada={prueba !== null && h.prueba?.id === prueba.id}
                />
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

function FilaHito({
  hito,
  fecha,
  husoSede,
  destacada,
}: {
  hito: HitoHorario;
  fecha: string;
  /** `null` = no hay que convertir. */
  husoSede: string | null;
  destacada: boolean;
}) {
  const sinRevisar = hito.dato !== null && hito.dato.estado !== 'aprobado';
  return (
    <li
      className={cn(
        'border-l-2 border-l-transparent',
        /* La prueba que se está mirando, con el filete rojo a la izquierda:
           es la señal que el resto de la aplicación usa para «esto es lo
           tuyo», y no depende solo del color porque además es una arista. */
        destacada && 'border-l-primary bg-marcado',
      )}
    >
      <CitaConvocatoria dato={hito.dato} className="mx-0 w-full rounded-none px-0">
        <div className="grid w-full grid-cols-[48px_minmax(0,1fr)_auto] items-baseline gap-x-[12px] px-[12px] py-[6px]">
          <span
            className={cn(
              'cifra text-[16px] leading-[20px]',
              sinRevisar && 'text-muted-foreground',
            )}
          >
            {hito.hora}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[14px] leading-[20px] break-words hyphens-auto">
              {hito.rotulo}
              {hito.dato ? (
                <MarcaConvocatoria className="ml-1.5 size-3 align-baseline text-muted-foreground/70" />
              ) : null}
            </span>
            {hito.aQue ? (
              <span className="text-[13px] leading-[16px] text-muted-foreground">
                {hito.aQue}
              </span>
            ) : null}
          </span>
          {husoSede ? (
            <HoraEnTuHuso fecha={fecha} hora={hito.hora} husoSede={husoSede} />
          ) : (
            <span />
          )}
        </div>
      </CitaConvocatoria>
    </li>
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
export function AccesoAlPabellon({
  evento,
  direccion = null,
}: {
  evento: EventView;
  /** La dirección que ya se enseña: si el acceso la repite, no sale. */
  direccion?: string | null;
}) {
  const acceso = huecoDe(evento.datosExtraidos, 'venue_access', evento.city);
  if (!acceso || !accesoCreible(acceso.valor) || accesoRepiteDireccion(acceso.valor, direccion)) {
    return null;
  }

  return (
    <CitaConvocatoria dato={acceso}>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
        <span className="text-muted-foreground">Se entra por</span>
        <span className="min-w-0 text-foreground">
          {acceso.valor}
          <MarcaConvocatoria className="ml-1.5 text-muted-foreground" />
        </span>
      </p>
    </CitaConvocatoria>
  );
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