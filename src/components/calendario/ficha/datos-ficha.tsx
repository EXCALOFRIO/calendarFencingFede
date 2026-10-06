'use client';

import { ChevronDown, ExternalLink } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { CompetitionView, DatoExtraidoView, EventView } from '@/lib/queries/calendar';
import { cn, formatEur, titular } from '@/lib/utils';
import {
  CitaConvocatoria,
  MarcaConvocatoria,
  contradiccion,
  creible,
  dominioDe,
  enlacesDeConvocatoria,
  huecoDe,
  plazosDeConvocatoria,
} from '../datos-convocatoria';
import { accesoCreible, horariosDelTorneo, tituloDeDia } from '../horarios-torneo';

/**
 * ===========================================================================
 * LO QUE DICE LA CONVOCATORIA, POR GRUPOS
 * ===========================================================================
 *
 * Al final de la ficha había un desplegable «Ver las 19 frases del PDF» con
 * cada dato extraído en una fila —«Apertura de la instalación · 2026-10-18
 * team event · Team Event 06:30»— y la frase del PDF debajo de cada uno. Era
 * comprobable y era ilegible: la clave interna asomaba por el rótulo, la cuota
 * salía como «80.00» y el horario, la sede y los enlaces se repetían de lo que
 * ya estaba arriba.
 *
 * Ahora cada dato va **una sola vez**, en el grupo al que pertenece:
 *
 *  · **Inscripción** — cuotas en euros, cupos, edad mínima, forma de pago y
 *    requisitos, en la banda del plazo;
 *  · **Sede** — pabellón, dirección, acceso y lo demás del recinto, en «Dónde
 *    y cuándo», con el botón del mapa;
 *  · **Horario** — la línea de tiempo por días de `horarios-torneo.tsx`;
 *  · **Organiza** y **Enlaces** — en la banda de la convocatoria.
 *
 * La trazabilidad no se pierde: cada valor leído lleva la marca de documento
 * leído y al tocarlo sale su frase literal del PDF (`CitaConvocatoria`).
 *
 * LA RED DE SEGURIDAD
 * -------------------
 * Lo que no tiene sitio en ningún grupo —un campo nuevo, una cuota cuya frase
 * no habla de euros, una hora sin día— no desaparece: va a «Otros datos de la
 * convocatoria», plegado. Para saber qué falta se apunta qué ha usado cada
 * grupo (`usados`), en vez de mantener una segunda lista de campos que se
 * desincronizaría con la primera.
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
function euros(valor: string): string {
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
 * De qué es una cuota leída.
 *
 * `fee_eur.equipos` lo dice la clave. `fee_eur` a secas lo dice el texto de
 * la prueba («Individual», «Team»), y si no dice nada y cuelga de una prueba,
 * es la de esa prueba. Lo demás (`fee_eur.m17`) lleva su concepto en la
 * etiqueta, que ya está en castellano.
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

function rotuloDeCuota(tipo: TipoCuota, d: DatoExtraidoView | null): string {
  if (tipo === 'individual') return 'Cuota individual';
  if (tipo === 'equipos') return 'Cuota por equipos';
  return d ? d.etiqueta.replace(' · ', ' ') : 'Cuota';
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
 * «12» → «12 tiradores». La unidad la dice la clave, no se adivina:
 * `entry_quota.equipos` cuenta equipos y las demás cuentan tiradores. Un
 * valor que no es un número suelto se deja como viene.
 */
function cupo(d: DatoExtraidoView): string {
  const v = d.valor.trim();
  if (!/^\d+$/.test(v)) return v;
  const n = Number(v);
  if (d.campo === 'entry_quota.equipos') return `${n} ${n === 1 ? 'equipo' : 'equipos'}`;
  return `${n} ${n === 1 ? 'tirador' : 'tiradores'}`;
}

export type DatosInscripcion = {
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
  const vistas = new Set<string>();

  /**
   * La cuota publicada manda sobre la leída del mismo tipo. Las leídas a
   * nivel de torneo nunca vienen marcadas como «pisadas» (no se sabe de qué
   * prueba son hasta leer su texto), así que se apartan aquí: si no, la
   * cuota individual saldría dos veces, la de la fuente y la del PDF.
   */
  const tipoPublicado = prueba.format === 'EQUIPOS' ? 'equipos' : 'individual';
  if (prueba.feeEur !== null) {
    // La publicada es la de esta prueba, sin duda posible: no hace falta
    // decir si es individual o por equipos, eso ya lo dice la pastilla.
    cuotas.push({
      clave: 'publicada',
      rotulo: 'Cuota de inscripción',
      valor: euros(prueba.feeEur),
      dato: null,
    });
    vistas.add(tipoPublicado);
  }

  const candidatas: [DatoExtraidoView, CompetitionView | null][] = [
    ...prueba.datosExtraidos.map((d) => [d, prueba] as [DatoExtraidoView, CompetitionView]),
    ...evento.datosExtraidos.map((d) => [d, null] as [DatoExtraidoView, null]),
  ];
  // Las revisadas por una persona primero: si dos documentos dan dos cuotas
  // del mismo tipo, gana la firmada.
  candidatas.sort(([a], [b]) => Number(b.estado === 'aprobado') - Number(a.estado === 'aprobado'));
  for (const [d, dueña] of candidatas) {
    if (!empieza(d, 'fee_eur') || d.pisadoPorPublicado || !creible(d, null)) continue;
    const tipo = tipoDeCuota(d, dueña);
    if (vistas.has(tipo)) {
      usados.add(d.id);
      continue;
    }
    vistas.add(tipo);
    usados.add(d.id);
    cuotas.push({ clave: d.id, rotulo: rotuloDeCuota(tipo, d), valor: euros(d.valor), dato: d });
  }
  // La de la prueba que se está mirando, primero.
  cuotas.sort(
    (a, b) =>
      Number(b.rotulo === rotuloDeCuota(tipoPublicado, null)) -
      Number(a.rotulo === rotuloDeCuota(tipoPublicado, null)),
  );

  const leidos = leidosDe(evento, prueba).filter((d) => !d.pisadoPorPublicado);
  const condiciones: LineaDato[] = [];
  const una = (campo: string, rotulo: string, valor: (d: DatoExtraidoView) => string) => {
    const d = huecoDe(leidos, campo);
    if (!d) return;
    usados.add(d.id);
    condiciones.push({ clave: d.id, rotulo, valor: valor(d), dato: d });
  };

  for (const d of leidos.filter((x) => x.campo.startsWith('entry_quota'))) {
    usados.add(d.id);
    condiciones.push({ clave: d.id, rotulo: d.etiqueta, valor: cupo(d), dato: d });
  }
  una('min_age', 'Edad mínima', (d) => (/^\d+$/.test(d.valor.trim()) ? `${d.valor.trim()} años` : d.valor));

  /*
    Las formas de pago pueden ser varias (`payment_method.<forma>`), y son UNA
    condición: «En efectivo o por transferencia». La cita que se enseña es la
    de la primera; las demás quedan apuntadas como usadas porque su valor está
    en la misma línea.
  */
  const pagos = leidos.filter((d) => empieza(d, 'payment_method'));
  if (pagos.length > 0) {
    for (const d of pagos) usados.add(d.id);
    const valores = [...new Set(pagos.map((d) => d.valor.trim()))];
    condiciones.push({
      clave: pagos[0].id,
      rotulo: 'Forma de pago',
      valor: valores
        .map((v, i) => (i === 0 ? v : v.charAt(0).toLowerCase() + v.slice(1)))
        .join(' o '),
      dato: pagos[0],
    });
  }

  const admitidas = leidos.filter((d) => d.campo.startsWith('category_allowed'));
  for (const d of admitidas) {
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

/** Un par rótulo/valor; el valor, si es leído del PDF, es tocable y lleva su cita. */
export function ParDato({
  linea,
  grande = false,
  className,
}: {
  linea: LineaDato;
  grande?: boolean;
  className?: string;
}) {
  const { dato } = linea;
  return (
    <CitaConvocatoria dato={dato} className={cn('py-0.5', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-muted-foreground sm:text-xs">{linea.rotulo}</span>
        <span
          className={cn(
            'min-w-0 break-words',
            grande ? 'cifra text-2xl leading-none' : 'text-base font-medium leading-snug sm:text-sm',
            dato && dato.estado !== 'aprobado' && 'text-foreground/85',
          )}
        >
          {linea.valor}
          {dato ? (
            <MarcaConvocatoria
              className={cn('ml-1.5 text-muted-foreground', grande && 'size-3.5 align-baseline')}
            />
          ) : null}
        </span>
      </div>
    </CitaConvocatoria>
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
      className={cn('flex min-w-0 flex-col gap-3 rounded-lg border border-filete bg-card p-3', className)}
    >
      {titulo || accion ? (
        <header className="flex flex-wrap items-center justify-between gap-2">
          {titulo ? <h4 className="text-base leading-none sm:text-sm">{titulo}</h4> : <span />}
          {accion}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function TarjetaInscripcion({
  evento,
  prueba,
}: {
  evento: EventView;
  prueba: CompetitionView;
}) {
  const { cuotas, condiciones, requisitos } = inscripcionDe(evento, prueba);
  // Lo que no se publica no se pinta: ni «cuota no publicada» ni recuadro vacío.
  if (cuotas.length + condiciones.length + requisitos.length === 0) return null;

  return (
    <Tarjeta titulo="Condiciones">
      {cuotas.length > 0 ? (
        <div className="grid grid-cols-2 items-start gap-x-4 gap-y-3">
          {cuotas.map((l) => (
            <ParDato key={l.clave} linea={l} grande />
          ))}
        </div>
      ) : null}

      {condiciones.length > 0 ? (
        <div
          className={cn(
            'grid grid-cols-2 items-start gap-x-4 gap-y-3',
            cuotas.length > 0 && 'border-t border-t-filete pt-3',
          )}
        >
          {condiciones.map((l) => (
            <ParDato key={l.clave} linea={l} />
          ))}
        </div>
      ) : null}

      {requisitos.length > 0 ? (
        <ul
          className={cn(
            'flex flex-col gap-1',
            cuotas.length + condiciones.length > 0 && 'border-t border-t-filete pt-3',
          )}
        >
          {requisitos.map((l) => (
            <li key={l.clave}>
              <ParDato linea={l} />
            </li>
          ))}
        </ul>
      ) : null}
    </Tarjeta>
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
 * ¿Hay sede de verdad, o el campo «sede» repite la ciudad?
 *
 * Varias fuentes rellenan la sede con el nombre de la ciudad cuando todavía
 * no se sabe el pabellón. Si se toma al pie de la letra, la ficha pone «San
 * Salvador» dos veces seguidas y el botón promete llevarte a un pabellón que
 * no existe.
 */
export function sedeDe(evento: EventView): DatosSede {
  const datos = evento.datosExtraidos;
  const sedePublicada =
    evento.venue && (!evento.city || aplanado(evento.venue) !== aplanado(evento.city))
      ? evento.venue
      : null;
  const sedeLeida = sedePublicada ? null : huecoDe(datos, 'venue', evento.city);
  const direccionLeida = evento.venueAddress ? null : huecoDe(datos, 'venue_address', evento.city);
  // Cuando la fuente ya publica la sede pero el papel dice otra, se dice. Pero
  // no si lo que «dice» el papel es la ciudad: eso no es otra sede.
  const contraria = contradiccion(datos, 'venue', sedePublicada);
  const otraSede = contraria && creible(contraria, evento.city) ? contraria : null;
  const leido = huecoDe(datos, 'venue_access', evento.city);
  // Lo que no es creíble como acceso va a «Otros datos» y no se marca usado.
  const acceso = leido && accesoCreible(leido.valor) ? leido : null;

  const usados = new Set<string>();
  for (const d of [sedeLeida, direccionLeida, contraria, acceso]) if (d) usados.add(d.id);

  const extras: LineaDato[] = [];
  for (const [campo, rotulo] of EXTRAS_SEDE) {
    const d = huecoDe(datos, campo);
    if (!d) continue;
    // Pistas y aforo son cifras. «Pistas: ESPADA MASCULINO» (leído así en un
    // TNR) es el rótulo de otra columna del PDF: va a «Otros datos», no aquí.
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
  return (
    <Tarjeta titulo="Organiza">
      <div className="flex flex-col gap-2">
        {quien ? (
          <ParDato linea={{ clave: quien.id, rotulo: 'Entidad', valor: titular(quien.valor), dato: quien }} />
        ) : null}
        {direccion ? (
          <ParDato
            linea={{ clave: direccion.id, rotulo: 'Dirección', valor: titular(direccion.valor), dato: direccion }}
          />
        ) : null}
      </div>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// Lo que no tiene sitio
// ---------------------------------------------------------------------------

/**
 * Los datos leídos que ningún grupo ha enseñado.
 *
 * No entra lo «pisado por lo publicado»: la fuente ya publica ese dato y la
 * ficha enseña el publicado; si el papel dice otra cosa, eso ya sale como
 * contradicción en su sitio.
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
 * El rótulo sin la clave interna.
 *
 * `etiquetaDeCampo` añade el sufijo de la clave, y en los horarios ese sufijo
 * es el día y la prueba en forma de slug («Inicio · 2026-10-14 training
 * available in the sub arena»). El día y la prueba se enseñan aparte y bien
 * escritos, así que aquí se quita.
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
    <Collapsible className="group/collapsible">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="self-start rounded-full px-3">
          <MarcaConvocatoria />
          Más datos
          <span className="cifra text-muted-foreground">{datos.length}</span>
          <ChevronDown className="transition-transform group-data-[state=open]/collapsible:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1">
        <ul className="flex flex-col divide-y divide-filete rounded-lg border border-filete bg-card">
          {datos.map((d) => {
            const contexto = [d.fecha ? tituloDeDia(d.fecha) : null, d.prueba ? titular(d.prueba) : null]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={d.id} className="px-3 py-2">
                {esEnlace(d) ? (
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <CitaConvocatoria dato={d}>
                      <span className="text-sm text-muted-foreground sm:text-xs">
                        <MarcaConvocatoria className="mr-1.5" />
                        {rotuloLimpio(d)}
                      </span>
                    </CitaConvocatoria>
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={/^https?:\/\//i.test(d.valor) ? d.valor : `https://${d.valor}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {dominioDe(d.valor)}
                        <ExternalLink />
                      </a>
                    </Button>
                  </div>
                ) : (
                  <CitaConvocatoria dato={d} className="w-full">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm text-muted-foreground sm:text-xs">
                        {rotuloLimpio(d)}
                        {contexto ? ` · ${contexto}` : ''}
                      </span>
                      <span className="min-w-0 break-words text-base font-medium sm:text-sm">
                        {/*
                          El VALOR pasa por `titular()` y la CITA no: el valor
                          se va a leer y las convocatorias lo escriben todo en
                          mayúsculas; la cita es la prueba de que el dato
                          existe, y una prueba retocada no prueba nada.
                        */}
                        {titular(d.valor)}
                        <MarcaConvocatoria className="ml-1.5 text-muted-foreground" />
                      </span>
                    </div>
                  </CitaConvocatoria>
                )}
              </li>
            );
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
