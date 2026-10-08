'use client';

import { ChevronRight, ExternalLink, Trophy } from 'lucide-react';
import { EnlaceIntencion } from '@/components/enlace-intencion';
import * as React from 'react';
import { EnlacePais } from '@/components/explorar/piezas';
import { Button } from '@/components/ui/button';
import type { PuestoPodio, VistaPodiosEvento } from '@/lib/queries/evento-resultados';
import {
  ETIQUETA_PROVEEDOR,
  type EnlaceDto,
  type PruebaDeEdicion,
} from '@/lib/sport/explorar/edicion-modelo';
import { construirUrlEdicion } from '@/lib/sport/explorar/edicion-url';
import type { CompeticionCalendario } from '@/lib/sport/explorar/enlaces-calendario';
import { CLASES_MEDALLA, medallaDe } from '@/lib/sport/explorar/presentacion';
import { rotuloPrueba } from '@/lib/sport/rotulos';
import { rutaFicha } from '@/lib/sport/explorar/url';
import { cn, titular } from '@/lib/utils';
import { fichaRecibidaDe, pedirFicha } from './precarga';
import { podiosDelEvento } from './resultados-accion';

/**
 * ===========================================================================
 * LOS RESULTADOS DE UN TORNEO QUE YA SE HA TIRADO
 * ===========================================================================
 *
 * Cuando el torneo ha terminado, lo que se viene a mirar a su ficha deja de
 * ser el plazo y pasa a ser **quién ganó**. Así que esta banda va arriba, con
 * el podio de cada prueba —oro, plata y los dos bronces, con su color de
 * medalla— y el botón a la página de la edición, que es donde está la
 * clasificación entera.
 *
 * SI NO HAY NADA QUE ENSEÑAR, NO HAY BANDA
 * ----------------------------------------
 * `UI.md`, 2 bis: lo que no se publica no se pinta. Ni «sin edición
 * vinculada», ni «sin enlaces comprobados», ni un esqueleto que se queda en
 * nada: mientras se lee, si falla, sin sesión o sin ningún podio ni enlace
 * oficial, la banda no existe. Y mientras se lee tampoco se reserva su hueco:
 * hoy ningún torneo tiene edición vinculada, y un esqueleto que aparece y
 * desaparece en cada ficha pasada sería un salto para nada.
 */

type Lectura = { evento: string; vista: VistaPodiosEvento | 'fallo' };

const ENLACE =
  'inline-flex min-h-[44px] items-center gap-1 text-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none';

export function ResultadosTorneo({
  eventoId,
  retorno,
  pruebaElegida,
  competicion = null,
}: {
  eventoId: string;
  retorno?: string;
  /** Prueba del calendario seleccionada arriba: su podio va marcado. */
  pruebaElegida?: string | null;
  /** La misma prueba con arma, género, categoría y formato: «Ver resultados» lleva a la suya exacta. */
  competicion?: CompeticionCalendario | null;
}) {
  // Lo precargado con la intención de abrir la ficha, si ya llegó.
  const [lectura, setLectura] = React.useState<Lectura | null>(() => {
    const ya = fichaRecibidaDe(eventoId, true)?.podios;
    return ya ? { evento: eventoId, vista: ya } : null;
  });

  React.useEffect(() => {
    let vigente = true;
    pedirFicha(eventoId, true)
      .then((ficha) => ficha.podios ?? podiosDelEvento(eventoId))
      .then((vista) => {
        if (vigente) setLectura({ evento: eventoId, vista });
      })
      .catch(() => {
        if (vigente) setLectura({ evento: eventoId, vista: 'fallo' });
      });
    return () => {
      vigente = false;
    };
  }, [eventoId]);

  const vista = lectura && lectura.evento === eventoId ? lectura.vista : null;
  return <CuerpoPodios vista={vista} retorno={retorno} pruebaElegida={pruebaElegida ?? null} competicion={competicion} />;
}

/**
 * La prueba de Explorar que ES la prueba del calendario elegida: por el
 * vínculo guardado si lo hay y, si no, por arma, género, categoría y formato
 * (como `destinoEnPruebas`). Sólo entre las que tienen algo que enseñar.
 */
export function pruebaExacta(
  ediciones: readonly { id: string; pruebasDetalle: PruebaDeEdicion[] }[],
  pruebaElegida: string | null,
  competicion: CompeticionCalendario | null,
): { edicionId: string; prueba: PruebaDeEdicion } | null {
  const todas = ediciones.flatMap((e) => e.pruebasDetalle.map((prueba) => ({ edicionId: e.id, prueba })));
  if (pruebaElegida) {
    const guardada = todas.find((x) => x.prueba.pruebaCalendarioId === pruebaElegida);
    if (guardada) return guardada;
  }
  if (!competicion) return null;
  return (
    todas.find(
      (x) =>
        x.prueba.arma === competicion.weapon &&
        x.prueba.genero === competicion.gender &&
        x.prueba.categoria.codigo === competicion.category &&
        x.prueba.formato === competicion.format,
    ) ?? null
  );
}

/** Enlaces oficiales que se pueden abrir: los demás no se nombran. */
function abribles(enlaces: EnlaceDto[]) {
  return enlaces.flatMap((e) => (e.tipo === 'sin_enlace' ? [] : [e]));
}

/** ¿La prueba tiene algo que enseñar? Podio o enlace oficial. */
function conAlgo(prueba: PruebaDeEdicion, podios: Record<string, PuestoPodio[]>): boolean {
  return (podios[prueba.id]?.length ?? 0) > 0 || abribles(prueba.enlaces).length > 0;
}

/** La banda con datos ya leídos; `null` si no hay nada que enseñar todavía. */
export function CuerpoPodios({
  vista,
  retorno,
  pruebaElegida = null,
  competicion = null,
}: {
  /** `null` mientras se lee. */
  vista: VistaPodiosEvento | 'fallo' | null;
  retorno?: string;
  pruebaElegida?: string | null;
  competicion?: CompeticionCalendario | null;
}) {
  if (vista === null || vista === 'fallo' || vista.tipo !== 'ok') return null;
  const ediciones = vista.ediciones
    .map((e) => ({ ...e, pruebasDetalle: e.pruebasDetalle.filter((p) => conAlgo(p, vista.podios)) }))
    .filter((e) => e.pruebasDetalle.length > 0);
  if (ediciones.length === 0) return null;
  const exacta = pruebaExacta(ediciones, pruebaElegida, competicion);

  return (
    <section
      aria-labelledby="resultados-torneo"
      className="flex flex-col gap-3 border-t border-filete pt-4"
    >
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h3 id="resultados-torneo" className="text-xl leading-tight">
          Resultados
        </h3>
        {/* La prueba elegida arriba, con su clasificación, poules y directas. */}
        {exacta ? (
          <Button asChild size="sm" className="rounded-full">
            <EnlaceIntencion
              href={construirUrlEdicion(exacta.edicionId, { prueba: exacta.prueba.id, origen: retorno })}
              data-resultados-prueba={exacta.prueba.id}
            >
              Ver resultados
              <ChevronRight />
            </EnlaceIntencion>
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-5">
        {ediciones.map((edicion) => {
          const variasCategorias =
            new Set(edicion.pruebasDetalle.map((p) => p.categoria.codigo)).size > 1;
          return (
            <div key={edicion.id} className="flex flex-col gap-3">
              <Button asChild size="sm" className="self-start rounded-full">
                <EnlaceIntencion href={construirUrlEdicion(edicion.id, { origen: retorno })}>
                  <Trophy />
                  Clasificación
                </EnlaceIntencion>
              </Button>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {edicion.pruebasDetalle.map((prueba) => (
                  <TarjetaPodio
                    key={prueba.id}
                    edicionId={edicion.id}
                    prueba={prueba}
                    podio={vista.podios[prueba.id] ?? []}
                    conCategoria={variasCategorias}
                    retorno={retorno}
                    elegida={exacta?.prueba.id === prueba.id}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** «Florete femenino», «Espada femenina M17 · Equipos». */
function nombreDePruebaCorto(p: PruebaDeEdicion, conCategoria: boolean): string {
  return rotuloPrueba(p, { categoria: conCategoria ? 'siempre' : 'nunca' });
}

function TarjetaPodio({
  edicionId,
  prueba,
  podio,
  conCategoria,
  retorno,
  elegida,
}: {
  edicionId: string;
  prueba: PruebaDeEdicion;
  podio: PuestoPodio[];
  conCategoria: boolean;
  retorno?: string;
  elegida: boolean;
}) {
  const oficiales = abribles(prueba.enlaces);
  return (
    <li
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-xl border border-filete bg-card p-3',
        elegida && 'border-primary-text',
      )}
    >
      <EnlaceIntencion
        href={construirUrlEdicion(edicionId, { prueba: prueba.id, origen: retorno })}
        className={cn(ENLACE, 'justify-between font-medium text-foreground')}
      >
        {nombreDePruebaCorto(prueba, conCategoria)}
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </EnlaceIntencion>

      {podio.length > 0 ? (
        <ol aria-label="Podio" className="flex flex-col gap-1">
          {podio.map((p, i) => (
            <FilaPodio key={`${p.puesto}-${i}`} puesto={p} />
          ))}
        </ol>
      ) : null}

      {/*
        Los resultados oficiales, como pastillas con el nombre del proveedor
        y su icono de enlace externo: el único sitio de la ficha donde un
        enlace a la fuente sirve de verdad (`UI.md`, 2 bis, regla 2).
      */}
      {oficiales.length > 0 ? (
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {oficiales.map((e) => (
            <Button key={e.proveedor} variant="outline" size="sm" className="rounded-full" asChild>
              <a href={e.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                {ETIQUETA_PROVEEDOR[e.proveedor]}
              </a>
            </Button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function FilaPodio({ puesto }: { puesto: PuestoPodio }) {
  const medalla = medallaDe(puesto.puesto);
  const nombre = titular(puesto.nombre);
  return (
    <li className="flex min-w-0 items-center gap-2">
      <span
        className={cn(
          'cifra inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-sm',
          medalla ? CLASES_MEDALLA[medalla] : 'border-filete',
        )}
      >
        <span className="sr-only">Puesto </span>
        {puesto.puesto}
      </span>
      {puesto.personaId ? (
        // La fila entera es el enlace: el nombre solo medía 23 px de alto.
        <EnlaceIntencion
          href={rutaFicha(puesto.personaId)}
          className="group flex min-h-[44px] min-w-0 flex-1 flex-col justify-center rounded-md leading-tight focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        >
          <DatosPodio puesto={puesto} nombre={nombre} />
        </EnlaceIntencion>
      ) : (
        <span className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center leading-tight">
          <DatosPodio puesto={puesto} nombre={nombre} />
        </span>
      )}
      {/* Hermana del enlace a la persona, no dentro: la bandera lleva a su país. */}
      {puesto.pais ? <EnlacePais pais={puesto.pais} soloBandera={false} className="justify-end" /> : null}
    </li>
  );
}

function DatosPodio({ puesto, nombre }: { puesto: PuestoPodio; nombre: string }) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium underline-offset-4 group-hover:underline">{nombre}</span>
      </span>
      {puesto.club ? (
        <span className="truncate text-xs text-muted-foreground">{titular(puesto.club)}</span>
      ) : null}
    </>
  );
}
