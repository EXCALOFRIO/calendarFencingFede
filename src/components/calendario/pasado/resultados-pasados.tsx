'use client';

import { ChevronRight, ExternalLink, FileText, Flag, Trophy } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { BanderaPais } from '@/components/bandera';
import type { EventView } from '@/lib/queries/calendar';
import type { PruebaPasada } from '@/lib/queries/calendario-pasado-modelo';
import { categoriaVisible, COLOR_MEDALLA } from '@/lib/sport/explorar/presentacion';
import { construirUrlEdicion } from '@/lib/sport/explorar/edicion-url';
import { cn, formatDateEs, GENDER_LABEL, WEAPON_LABEL } from '@/lib/utils';

/**
 * ===========================================================================
 * LO YA CELEBRADO: «TERMINADA», QUIÉN GANÓ Y DÓNDE ESTÁN LOS RESULTADOS
 * ===========================================================================
 *
 * Tres piezas pequeñas que comparten la tarjeta del calendario, la hoja de
 * resultados y cualquier sitio que pinte un torneo pasado. Ninguna inventa un
 * dato: el ganador es el puesto 1 que publica la fuente, «Resultados» solo
 * aparece si hay al menos un puesto importado y el enlace oficial es el que
 * guardó la importación.
 */

/**
 * La pastilla de «Terminada». Icono y palabra, no solo color: es la misma de la
 * cabecera de la ficha, para que el torneo se lea igual en los dos sitios.
 */
export function Terminada({ clase }: { clase?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-[3px] bg-muted px-1.5 py-px text-[0.68rem] font-medium leading-[1.4] text-muted-foreground',
        clase,
      )}
    >
      <Flag className="size-3" aria-hidden />
      Terminada
    </span>
  );
}

/**
 * Las pruebas de Explorar que corresponden a lo que se está mirando.
 *
 * Con el calendario filtrado por espada femenina, el ganador que interesa es
 * el de la espada femenina, no el del florete masculino del mismo torneo. Si
 * ninguna encaja con el filtro —puede pasar: el cruce trae la prueba de la FIE
 * y el calendario la publica con otra categoría— se devuelven todas, porque
 * esconder los resultados de un torneo que sí se ve sería peor.
 */
export function pruebasVisibles(evento: EventView, pruebas: PruebaPasada[]): PruebaPasada[] {
  const ids = new Set(evento.competitions.map((c) => c.id));
  const claves = new Set(
    evento.competitions.map((c) => `${c.weapon}|${c.gender}|${c.category}|${c.format}`),
  );
  const visibles = pruebas.filter(
    (p) => ids.has(p.id) || claves.has(`${p.arma}|${p.genero}|${p.categoria}|${p.formato}`),
  );
  return visibles.length > 0 ? visibles : pruebas;
}

/** «+50» en una prueba de veteranos que lo publica; `null` en cualquier otra. */
export function tramoDeEdad(p: PruebaPasada): string | null {
  return p.categoria === 'VET' ? (p.categoriaRaw?.trim().match(/^\+\d{2}$/)?.[0] ?? null) : null;
}

/** «Espada femenina · M17 · equipos». */
export function nombreDePruebaPasada(p: PruebaPasada, { conTramo = true } = {}): string {
  // «Espada» es la única de las tres que pide el adjetivo en femenino.
  const genero =
    p.genero === 'MIXTO'
      ? 'mixto'
      : p.arma === 'ESPADA'
        ? GENDER_LABEL[p.genero].toLowerCase().replace(/o$/, 'a')
        : GENDER_LABEL[p.genero].toLowerCase();
  const tramo = conTramo ? tramoDeEdad(p) : null;
  const categoria = categoriaVisible(p.categoria) + (tramo ? ` ${tramo}` : '');
  const partes = [`${WEAPON_LABEL[p.arma]} ${genero}`, categoria];
  if (p.formato === 'EQUIPOS') partes.push('equipos');
  return partes.join(' · ');
}

/**
 * Acción secundaria compacta: el control mide los 44 px táctiles (y
 * `globals.css` se los impone a todo botón y enlace del calendario), pero lo
 * que se ve es la pastilla de dentro, de 28 px.
 */
const AREA_PASTILLA =
  'group inline-flex min-h-11 shrink-0 items-center rounded-full focus-visible:outline-none';
const PASTILLA =
  'inline-flex h-7 items-center gap-1 rounded-full border border-filete px-2.5 text-xs font-semibold text-primary-text transition-colors group-hover:bg-muted group-focus-visible:ring-2 group-focus-visible:ring-ring';

/** Solo icono; `min-h-0 min-w-0` anulan el mínimo de `.calendario a[href]` y el `after` da el área. */
const ICONO_EXTERNO =
  "relative inline-flex size-7 min-h-0 min-w-0 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * El punto de oro y el nombre de quien ganó, con su bandera. En el pie de la
 * tarjeta el nombre se recorta en vez de partir la fila: «Resultados» tiene que
 * quedarse en el mismo renglón, o cada torneo pasado crece 44 px en el móvil.
 */
function Ganador({
  ganador,
  recortar = false,
}: {
  ganador: NonNullable<PruebaPasada['ganador']>;
  recortar?: boolean;
}) {
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', recortar && 'flex-1')}>
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: COLOR_MEDALLA.oro }}
      />
      <span className="sr-only">Primer puesto:</span>
      <span
        title={recortar ? ganador.nombre : undefined}
        className={cn(
          'min-w-0 font-medium text-foreground',
          recortar ? 'truncate' : 'break-words',
        )}
      >
        {ganador.nombre}
      </span>
      {ganador.pais ? (
        <BanderaPais pais={ganador.pais} soloBandera={recortar} className="shrink-0 normal-case tracking-tight" />
      ) : null}
    </span>
  );
}

/**
 * EL PIE DE UNA TARJETA PASADA: QUIÉN GANÓ Y «RESULTADOS».
 *
 * Va FUERA del botón que abre la ficha, como hermano suyo, porque es otro
 * destino: un enlace dentro de un botón no es HTML válido y el lector de
 * pantalla lo anunciaría mal.
 *
 * Con una sola edición detrás, «Resultados» es un enlace directo a ella (y a
 * la prueba, si es una). Con varias —la FIE publica una edición por prueba, así
 * que una Copa del Mundo con individual y equipos son dos—, abre la hoja con la
 * lista para elegir.
 *
 * Sin ningún puesto importado no se pinta nada: la tarjeta ya dice «Terminada»
 * y un «sin resultados» en cada torneo pasado sería ruido.
 */
export function PieResultados({
  evento,
  pruebas,
  retorno,
  onVer,
  clase,
}: {
  evento: EventView;
  pruebas: PruebaPasada[] | undefined;
  retorno?: string;
  onVer: (e: EventView) => void;
  clase?: string;
}) {
  const visibles = React.useMemo(
    () => (pruebas ? pruebasVisibles(evento, pruebas).filter((p) => p.conResultados) : []),
    [evento, pruebas],
  );
  if (visibles.length === 0) return null;

  const ediciones = [...new Set(visibles.map((p) => p.edicionId))];
  const unica = visibles.length === 1 ? visibles[0] : null;
  const destino =
    ediciones.length === 1
      ? construirUrlEdicion(ediciones[0], { prueba: unica?.id, origen: retorno })
      : null;
  const etiqueta = `Resultados de ${evento.name}`;
  // Con varias pruebas se enseña el oro de la primera y cuántas más hay.
  const primera = visibles.find((p) => p.ganador) ?? null;
  const mas = visibles.length - (primera ? 1 : 0);

  return (
    <div
      data-resultados={visibles.length}
      className={cn(
        'flex min-h-11 min-w-0 items-center gap-x-2 border-t border-filete pl-3 text-xs text-muted-foreground',
        clase,
      )}
    >
      <Trophy className="size-3.5 shrink-0 opacity-70" aria-hidden />
      {primera?.ganador ? <Ganador ganador={primera.ganador} recortar /> : <span className="flex-1" />}
      {mas > 0 ? (
        <span className="cifra shrink-0 text-muted-foreground">
          +{mas}
          <span className="sr-only"> pruebas</span>
        </span>
      ) : null}
      {destino ? (
        <Link href={destino} className={cn(AREA_PASTILLA, 'ml-auto')} aria-label={etiqueta}>
          <span className={PASTILLA}>
            Resultados
            <ChevronRight className="size-3.5" aria-hidden />
          </span>
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => onVer(evento)}
          className={cn(AREA_PASTILLA, 'ml-auto')}
          aria-label={etiqueta}
        >
          <span className={PASTILLA}>
            Resultados
            <ChevronRight className="size-3.5" aria-hidden />
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * LA HOJA DE RESULTADOS DE UN TORNEO PASADO.
 *
 * Una fila por prueba con su ganador, la clasificación completa en Explorar y
 * la página oficial de la fuente. Para un torneo que solo existe en Explorar es
 * lo único que se abre; para uno del calendario, va con un botón de vuelta a su
 * ficha, que sigue teniendo los documentos y la sede.
 */
export function ResultadosPasados({
  evento,
  pruebas,
  retorno,
  onAbrirFicha,
}: {
  evento: EventView;
  pruebas: PruebaPasada[];
  retorno?: string;
  /** Solo para torneos del calendario: vuelve a su ficha. */
  onAbrirFicha?: () => void;
}) {
  const visibles = pruebasVisibles(evento, pruebas);
  // Si todas son del mismo día, la fecha va una vez en la cabecera y no en cada fila.
  const fechas = new Set(visibles.flatMap((p) => (p.fecha ? [p.fecha] : [])));
  const fechaComun = fechas.size === 1 ? [...fechas][0] : null;
  return (
    <section
      aria-labelledby="resultados-pasados"
      className="flex flex-col gap-3 px-4 pt-4 pb-6"
    >
      <div className="flex items-center gap-2 border-t border-filete pt-4">
        <h3 id="resultados-pasados" className="text-xl leading-none">
          Resultados
        </h3>
        {fechaComun ? (
          <span className="cifra text-xs text-muted-foreground">{formatDateEs(fechaComun)}</span>
        ) : null}
        {onAbrirFicha ? (
          <button type="button" className={cn(AREA_PASTILLA, 'ml-auto')} onClick={onAbrirFicha}>
            <span className={cn(PASTILLA, 'text-foreground')}>
              <FileText className="size-3.5" aria-hidden />
              Ficha
            </span>
          </button>
        ) : null}
      </div>

      {visibles.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {visibles.map((p) => {
            const nombre = nombreDePruebaPasada(p);
            // El tramo de edad va aparte para que el recorte del nombre no se lo coma.
            const tramo = tramoDeEdad(p);
            const cuerpo = (
              <>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="min-w-0 truncate text-sm font-semibold text-foreground" title={nombre}>
                      {nombreDePruebaPasada(p, { conTramo: false })}
                    </span>
                    {tramo ? (
                      <span className="cifra shrink-0 text-sm font-semibold text-foreground">{tramo}</span>
                    ) : null}
                    {p.fecha && !fechaComun ? (
                      <span className="cifra ml-auto shrink-0 text-xs text-muted-foreground">
                        {formatDateEs(p.fecha)}
                      </span>
                    ) : null}
                  </span>
                  {p.ganador ? (
                    <span className="flex min-w-0 text-xs text-muted-foreground">
                      <Ganador ganador={p.ganador} recortar />
                    </span>
                  ) : null}
                </span>
                {p.conResultados ? (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : null}
              </>
            );
            return (
              <li
                key={p.id}
                className="flex min-w-0 items-center gap-1 rounded-md border border-filete bg-card pr-1"
              >
                {p.conResultados ? (
                  <Link
                    href={construirUrlEdicion(p.edicionId, { prueba: p.id, origen: retorno })}
                    className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-md py-2 pl-3 pr-1 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {cuerpo}
                  </Link>
                ) : (
                  <div className="flex min-h-12 min-w-0 flex-1 items-center gap-2 py-2 pl-3 pr-1">{cuerpo}</div>
                )}
                {p.urlOficial ? (
                  <a
                    href={p.urlOficial}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={ICONO_EXTERNO}
                    aria-label="Resultados oficiales (se abre en otra pestaña)"
                    title="Resultados oficiales"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
