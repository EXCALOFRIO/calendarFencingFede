'use client';

import { ChevronDown, ExternalLink, Navigation } from 'lucide-react';
import * as React from 'react';
import { BanderaPais } from '@/components/bandera';
import { Boton } from '@/components/sistema/boton';
import { ListaDatos, ParDato } from '@/components/sistema/lista-datos';
import { mapsLinks } from '@/lib/travel';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { CompetitionView, DatoExtraidoView, EventView } from '@/lib/queries/calendar';
import { cn, formatEur, titular } from '@/lib/utils';
import {
  contradiccion,
  creible,
  dominioDe,
  enlacesDeConvocatoria,
  esImporte,
  huecoDe,
  plazosDeConvocatoria,
} from '../datos-convocatoria';
import { accesoCreible, horariosDelTorneo, tituloDeDia } from '../horarios-torneo';

/**
 * ===========================================================================
 * LO QUE DICE LA CONVOCATORIA, POR GRUPOS
 * ===========================================================================
 *
 * Cada dato leído va **una sola vez**, en el grupo al que pertenece:
 *
 *  · **Condiciones** — la cuota de la prueba, cupos, edad mínima, forma de
 *    pago y requisitos, en la banda del plazo;
 *  · **Sede** — pabellón, dirección, acceso y lo demás del recinto;
 *  · **Horario** — `horarios-torneo.tsx`;
 *  · **Organiza** y **Enlaces** — en la banda de la convocatoria.
 *
 * Todo en pares rótulo–valor (`ListaDatos`), sin nada pegado detrás del
 * valor. La frase de la que sale cada uno se ve desde el botón «Según la
 * convocatoria» de su banda (`segun-convocatoria.tsx`).
 *
 * LA RED DE SEGURIDAD
 * -------------------
 * Lo que no tiene sitio en ningún grupo —un campo nuevo, una cuota cuya frase
 * no habla de euros, una hora sin día— va a «Más datos», plegado. Para saber
 * qué falta se apunta qué ha usado cada grupo (`usados`), en vez de mantener
 * una segunda lista de campos que se desincronizaría con la primera.
 */

export type LineaDato = {
  clave: string;
  rotulo: string;
  valor: string;
  dato: DatoExtraidoView | null;
};

function aplanar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

const empieza = (d: DatoExtraidoView, campo: string) =>
  d.campo === campo || d.campo.startsWith(`${campo}.`);

/** «80.00» → «80 €»; si no es una cifra, el texto tal cual. */
export function euros(valor: string): string {
  const n = Number.parseFloat(valor.replace(',', '.'));
  return Number.isFinite(n) && /^\s*\d/.test(valor) ? formatEur(n) : valor;
}

/** Los datos que mira la ficha para la prueba elegida: los del torneo y los suyos. */
export function leidosDe(evento: EventView, prueba: CompetitionView | null): DatoExtraidoView[] {
  return [...evento.datosExtraidos, ...(prueba?.datosExtraidos ?? [])];
}

// ---------------------------------------------------------------------------
// Inscripción
// ---------------------------------------------------------------------------

type TipoCuota = 'individual' | 'equipos' | string;

/**
 * De qué es una cuota leída. `fee_eur.equipos` lo dice la clave; `fee_eur` a
 * secas lo dice el texto de la prueba («Individual», «Team») o, si cuelga de
 * una prueba, su modalidad. Lo demás (`fee_eur.m17`) es otro concepto.
 */
function tipoDeCuota(d: DatoExtraidoView, deLaPrueba: CompetitionView | null): TipoCuota {
  if (d.campo === 'fee_eur.equipos') return 'equipos';
  if (d.campo !== 'fee_eur') return d.campo;
  const texto = aplanar(d.prueba ?? '');
  if (/\bteams?\b|\bequipos?\b|\bequipes\b/.test(texto)) return 'equipos';
  if (/individual|individuel/.test(texto)) return 'individual';
  if (deLaPrueba) return deLaPrueba.format === 'EQUIPOS' ? 'equipos' : 'individual';
  return 'individual';
}

/** Requisitos que llegan en inglés de los dossieres de la FIE, en castellano. */
function requisitoLegible(valor: string): string {
  if (/fie licen[cs]e/i.test(valor)) {
    return /current season|this season/i.test(valor)
      ? 'Licencia FIE en vigor esta temporada'
      : 'Licencia FIE en vigor';
  }
  return titular(valor);
}

/**
 * «12» → «12 tiradores». La unidad la dice la clave: `entry_quota.equipos`
 * cuenta equipos y las demás, tiradores. Lo que no es un número, tal cual.
 */
function cupo(d: DatoExtraidoView): string {
  const v = d.valor.trim();
  if (!/^\d+$/.test(v)) return v;
  const n = Number(v);
  if (d.campo === 'entry_quota.equipos') return `${n} ${n === 1 ? 'equipo' : 'equipos'}`;
  return `${n} ${n === 1 ? 'tirador' : 'tiradores'}`;
}

export type DatosInscripcion = {
  /** Como mucho una: la de la prueba elegida. */
  cuotas: LineaDato[];
  condiciones: LineaDato[];
  requisitos: LineaDato[];
  usados: Set<string>;
};

export function inscripcionDe(
  evento: EventView,
  prueba: CompetitionView,
): DatosInscripcion {
  const usados = new Set<string>();
  const cuotas: LineaDato[] = [];

  /*
    UNA cifra, la de esta prueba: la publicada si la hay y, si no, la leída de
    su misma modalidad. Los demás importes (la otra modalidad, alojamiento,
    árbitros) se dan por usados y no salen en la ficha (`esImporte`). Un
    «importe» cuya frase no habla de euros no es un precio y sigue su camino
    hasta «Más datos».
  */
  const tipoPropio = prueba.format === 'EQUIPOS' ? 'equipos' : 'individual';
  if (prueba.feeEur !== null) {
    cuotas.push({ clave: 'publicada', rotulo: 'Cuota de inscripción', valor: euros(prueba.feeEur), dato: null });
  }

  const candidatas: [DatoExtraidoView, CompetitionView | null][] = [
    ...prueba.datosExtraidos.map((d) => [d, prueba] as [DatoExtraidoView, CompetitionView]),
    ...evento.datosExtraidos.map((d) => [d, null] as [DatoExtraidoView, null]),
  ];
  // Si dos documentos dan dos cuotas, gana la revisada por una persona.
  candidatas.sort(([a], [b]) => Number(b.estado === 'aprobado') - Number(a.estado === 'aprobado'));
  for (const [d, dueña] of candidatas) {
    if (!esImporte(d.campo) || d.pisadoPorPublicado) continue;
    if (empieza(d, 'fee_eur') && !creible(d, null)) continue;
    usados.add(d.id);
    if (cuotas.length === 0 && empieza(d, 'fee_eur') && tipoDeCuota(d, dueña) === tipoPropio) {
      cuotas.push({ clave: d.id, rotulo: 'Cuota de inscripción', valor: euros(d.valor), dato: d });
    }
  }

  const leidos = leidosDe(evento, prueba).filter((d) => !d.pisadoPorPublicado);
  const condiciones: LineaDato[] = [];

  for (const d of leidos.filter((x) => x.campo.startsWith('entry_quota'))) {
    usados.add(d.id);
    condiciones.push({ clave: d.id, rotulo: d.etiqueta, valor: cupo(d), dato: d });
  }
  const edad = huecoDe(leidos, 'min_age');
  if (edad) {
    usados.add(edad.id);
    const v = edad.valor.trim();
    condiciones.push({ clave: edad.id, rotulo: 'Edad mínima', valor: /^\d+$/.test(v) ? `${v} años` : edad.valor, dato: edad });
  }

  /*
    Las formas de pago pueden ser varias (`payment_method.<forma>`) y son UNA
    condición: «En efectivo o por transferencia».
  */
  const pagos = leidos.filter((d) => empieza(d, 'payment_method'));
  if (pagos.length > 0) {
    for (const d of pagos) usados.add(d.id);
    const valores = [...new Set(pagos.map((d) => d.valor.trim()))];
    condiciones.push({
      clave: pagos[0].id,
      rotulo: 'Forma de pago',
      valor: valores.map((v, i) => (i === 0 ? v : v.charAt(0).toLowerCase() + v.slice(1))).join(' o '),
      dato: pagos[0],
    });
  }

  for (const d of leidos.filter((x) => x.campo.startsWith('category_allowed'))) {
    usados.add(d.id);
    condiciones.push({ clave: d.id, rotulo: 'Categoría admitida', valor: titular(d.valor), dato: d });
  }

  const requisitos = leidos
    .filter((d) => d.campo.startsWith('entry_requirement'))
    .map((d) => {
      usados.add(d.id);
      return { clave: d.id, rotulo: 'Requisito', valor: requisitoLegible(d.valor), dato: d };
    });

  for (const d of plazosDeConvocatoria(leidos)) usados.add(d.id);

  return { cuotas, condiciones, requisitos, usados };
}

/** Pares rótulo–valor en filas, con su filete: la forma de todos los datos de la ficha. */
export function FilasDatos({ lineas, className }: { lineas: readonly LineaDato[]; className?: string }) {
  if (lineas.length === 0) return null;
  return (
    <ListaDatos disposicion="linea" className={className}>
      {lineas.map((l) => (
        <ParDato key={l.clave} etiqueta={l.rotulo}>
          {l.valor}
        </ParDato>
      ))}
    </ListaDatos>
  );
}

/** El recuadro de un grupo de datos: titular pequeño y contenido. */
export function Tarjeta({
  titulo,
  accion,
  children,
  className,
}: {
  titulo?: string;
  accion?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={titulo}
      className={cn('flex min-w-0 flex-col gap-2 rounded-xl border border-filete bg-card px-3 pt-3 pb-1', className)}
    >
      {titulo || accion ? (
        <header className="flex flex-wrap items-center justify-between gap-2">
          {titulo ? <h4 className="text-sm font-semibold text-foreground">{titulo}</h4> : <span />}
          {accion}
        </header>
      ) : null}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sede
// ---------------------------------------------------------------------------

/** Lo demás del recinto, cuando la convocatoria lo dice. */
const EXTRAS_SEDE: [campo: string, rotulo: string][] = [
  ['venue_pistas', 'Pistas'],
  ['venue_pista_central', 'Pista central'],
  ['venue_entrenamiento', 'Sala de entrenamiento'],
  ['venue_aforo', 'Aforo'],
  ['venue_condiciones', 'Condiciones'],
  ['venue_plus_code', 'Código de Google Maps'],
  ['venue_map_place', 'Sitio en el mapa'],
];

function aplanado(v: string) {
  return aplanar(v).trim();
}

export type DatosSede = {
  sede: string | null;
  sedeLeida: DatoExtraidoView | null;
  direccion: string | null;
  direccionLeida: DatoExtraidoView | null;
  otraSede: DatoExtraidoView | null;
  acceso: DatoExtraidoView | null;
  extras: LineaDato[];
  usados: Set<string>;
};

/**
 * ¿Hay sede de verdad, o el campo «sede» repite la ciudad? Varias fuentes
 * rellenan la sede con la ciudad cuando todavía no se sabe el pabellón, y la
 * ficha ponía «San Salvador» dos veces seguidas.
 */
export function sedeDe(evento: EventView): DatosSede {
  const datos = evento.datosExtraidos;
  const sedePublicada =
    evento.venue && (!evento.city || aplanado(evento.venue) !== aplanado(evento.city))
      ? evento.venue
      : null;
  const sedeLeida = sedePublicada ? null : huecoDe(datos, 'venue', evento.city);
  const direccionLeida = evento.venueAddress ? null : huecoDe(datos, 'venue_address', evento.city);
  // Si el papel nombra otra sede se dice, salvo que esa «sede» sea la ciudad.
  const contraria = contradiccion(datos, 'venue', sedePublicada);
  const otraSede = contraria && creible(contraria, evento.city) ? contraria : null;
  const leido = huecoDe(datos, 'venue_access', evento.city);
  // Lo que no es creíble como acceso va a «Más datos» y no se marca usado.
  const acceso = leido && accesoCreible(leido.valor) ? leido : null;

  const usados = new Set<string>();
  for (const d of [sedeLeida, direccionLeida, contraria, acceso]) if (d) usados.add(d.id);

  const extras: LineaDato[] = [];
  for (const [campo, rotulo] of EXTRAS_SEDE) {
    const d = huecoDe(datos, campo);
    if (!d) continue;
    // «Pistas: ESPADA MASCULINO» es el rótulo de otra columna del PDF, no una cifra.
    if ((campo === 'venue_pistas' || campo === 'venue_aforo') && !/\d/.test(d.valor)) continue;
    usados.add(d.id);
    extras.push({ clave: d.id, rotulo, valor: d.valor, dato: d });
  }

  return {
    sede: sedePublicada ?? sedeLeida?.valor ?? null,
    sedeLeida,
    direccion: evento.venueAddress ?? direccionLeida?.valor ?? null,
    direccionLeida,
    otraSede,
    acceso,
    extras,
    usados,
  };
}

// ---------------------------------------------------------------------------
// Organiza
// ---------------------------------------------------------------------------

export function organizaDe(evento: EventView) {
  const quien = huecoDe(evento.datosExtraidos, 'organizer');
  const direccion = huecoDe(evento.datosExtraidos, 'organizer_address');
  const usados = new Set<string>([quien, direccion].flatMap((d) => (d ? [d.id] : [])));
  return { quien, direccion, usados };
}

export function TarjetaOrganiza({ evento }: { evento: EventView }) {
  const { quien, direccion } = organizaDe(evento);
  if (!quien && !direccion) return null;
  const mapa = direccion ? mapsLinks({ venueAddress: direccion.valor })?.google ?? null : null;
  return (
    <Tarjeta titulo="Organiza">
      {quien ? <p className="text-base font-medium text-foreground">{titular(quien.valor)}</p> : null}
      {direccion ? <LineaDireccion texto={titular(direccion.valor)} mapa={mapa} /> : null}
    </Tarjeta>
  );
}

/**
 * Una dirección en una sola línea que abre el mapa. Entera va en el `title` y
 * en el propio mapa.
 */
export function LineaDireccion({
  pais,
  texto,
  mapa,
}: {
  pais?: string | null;
  texto: string;
  mapa: string | null;
}) {
  const contenido = (
    <>
      {pais ? <BanderaPais pais={pais} tamaño="ficha" /> : null}
      <span className="min-w-0 flex-1 truncate">{texto}</span>
    </>
  );
  return mapa ? (
    <a
      href={mapa}
      target="_blank"
      rel="noreferrer"
      title={texto}
      className="flex min-h-[44px] min-w-0 items-center gap-2 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {contenido}
      <Navigation className="size-4 shrink-0 text-primary-text" aria-hidden />
      {/* Detrás de la dirección visible, no en un aria-label que la tape (WCAG 2.5.3). */}
      <span className="sr-only">: abrir en el mapa (se abre en otra pestaña)</span>
    </a>
  ) : (
    <p title={texto} className="flex min-h-[44px] min-w-0 items-center gap-2 text-sm text-muted-foreground">
      {contenido}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Lo que no tiene sitio
// ---------------------------------------------------------------------------

/**
 * Los datos leídos que ningún grupo ha enseñado. No entra lo «pisado por lo
 * publicado»: la ficha enseña el publicado.
 */
export function otrosDatosDe(evento: EventView, prueba: CompetitionView | null): DatoExtraidoView[] {
  const usados = new Set<string>([
    ...sedeDe(evento).usados,
    ...organizaDe(evento).usados,
    ...horariosDelTorneo(evento).usados,
    ...(prueba ? inscripcionDe(evento, prueba).usados : []),
    ...enlacesDeConvocatoria(evento.datosExtraidos).map((d) => d.id),
  ]);
  const vistos = new Set<string>();
  return leidosDe(evento, prueba).filter((d) => {
    if (usados.has(d.id) || d.pisadoPorPublicado || vistos.has(d.id)) return false;
    vistos.add(d.id);
    return true;
  });
}

/**
 * El rótulo sin la clave interna. En los horarios el sufijo de la clave es el
 * día y la prueba en forma de slug («Inicio · 2026-10-14 training…»); el día y
 * la prueba se enseñan aparte y bien escritos.
 */
export function rotuloLimpio(d: DatoExtraidoView): string {
  const [base, ...resto] = d.etiqueta.split(' · ');
  const cola = resto.join(' · ');
  return cola && !/\d{4}-\d{2}-\d{2}/.test(cola) ? `${base} · ${cola}` : base;
}

function esEnlace(d: DatoExtraidoView): boolean {
  return d.campo.startsWith('link.') || /^https?:\/\//i.test(d.valor) || /^www\./i.test(d.valor);
}

export function OtrosDatos({ datos }: { datos: DatoExtraidoView[] }) {
  if (datos.length === 0) return null;
  return (
    <Collapsible className="group/collapsible flex flex-col gap-2">
      <CollapsibleTrigger asChild>
        <Boton variante="fantasma" tamano="sm" className="self-start">
          Más datos ({datos.length})
          <ChevronDown aria-hidden className="transition-transform group-data-[state=open]/collapsible:rotate-180 motion-reduce:transition-none" />
        </Boton>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Tarjeta className="pb-3">
          {/* En columna: estos rótulos traen el día y la prueba y no caben al lado del valor. */}
          <ListaDatos disposicion="columna">
            {datos.map((d) => {
              const contexto = [d.fecha ? tituloDeDia(d.fecha) : null, d.prueba ? titular(d.prueba) : null]
                .filter(Boolean)
                .join(' · ');
              return (
                <ParDato key={d.id} etiqueta={contexto ? `${rotuloLimpio(d)} · ${contexto}` : rotuloLimpio(d)}>
                  {esEnlace(d) ? (
                    <a
                      href={/^https?:\/\//i.test(d.valor) ? d.valor : `https://${d.valor}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-[44px] items-center gap-1 text-primary-text underline-offset-4 hover:underline"
                    >
                      {dominioDe(d.valor)}
                      <ExternalLink className="size-4 shrink-0" aria-hidden />
                    </a>
                  ) : (
                    // El valor pasa por `titular()` (las convocatorias lo escriben en mayúsculas); la cita, no.
                    titular(d.valor)
                  )}
                </ParDato>
              );
            })}
          </ListaDatos>
        </Tarjeta>
      </CollapsibleContent>
    </Collapsible>
  );
}
