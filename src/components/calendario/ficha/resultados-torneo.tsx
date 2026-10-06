'use client';

import { ChevronRight, ExternalLink, Trophy } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { BanderaPais } from '@/components/bandera';
import { Button } from '@/components/ui/button';
import type { PuestoPodio, VistaPodiosEvento } from '@/lib/queries/evento-resultados';
import {
  ETIQUETA_PROVEEDOR,
  type EnlaceDto,
  type PruebaDeEdicion,
} from '@/lib/sport/explorar/edicion-modelo';
import { construirUrlEdicion } from '@/lib/sport/explorar/edicion-url';
import { CLASES_MEDALLA, categoriaVisible, medallaDe } from '@/lib/sport/explorar/presentacion';
import { rutaFicha } from '@/lib/sport/explorar/url';
import { GENDER_LABEL, WEAPON_LABEL, cn, titular } from '@/lib/utils';
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
  'inline-flex min-h-11 items-center gap-1 text-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none md:min-h-0';

export function ResultadosTorneo({
  eventoId,
  retorno,
  pruebaElegida,
}: {
  eventoId: string;
  retorno?: string;
  /** Prueba del calendario seleccionada arriba: su podio va marcado. */
  pruebaElegida?: string | null;
}) {
  const [lectura, setLectura] = React.useState<Lectura | null>(null);

  React.useEffect(() => {
    let vigente = true;
    podiosDelEvento(eventoId)
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
  return <CuerpoPodios vista={vista} retorno={retorno} pruebaElegida={pruebaElegida ?? null} />;
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
}: {
  /** `null` mientras se lee. */
  vista: VistaPodiosEvento | 'fallo' | null;
  retorno?: string;
  pruebaElegida?: string | null;
}) {
  if (vista === null || vista === 'fallo' || vista.tipo !== 'ok') return null;
  const ediciones = vista.ediciones
    .map((e) => ({ ...e, pruebasDetalle: e.pruebasDetalle.filter((p) => conAlgo(p, vista.podios)) }))
    .filter((e) => e.pruebasDetalle.length > 0);
  if (ediciones.length === 0) return null;

  return (
    <section
      aria-labelledby="resultados-torneo"
      className="flex flex-col gap-3 border-t border-t-filete pt-4 pb-1 first:border-t-0 first:pt-0"
    >
      <h3 id="resultados-torneo" className="text-xl leading-none sm:text-lg">
        Resultados
      </h3>
      <div className="flex flex-col gap-5">
        {ediciones.map((edicion) => {
          const variasCategorias =
            new Set(edicion.pruebasDetalle.map((p) => p.categoria.codigo)).size > 1;
          return (
            <div key={edicion.id} className="flex flex-col gap-3">
              <Button asChild size="sm" className="self-start rounded-full">
                <Link href={construirUrlEdicion(edicion.id, { origen: retorno })}>
                  <Trophy />
                  Clasificación
                </Link>
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
                    elegida={
                      pruebaElegida !== null && prueba.pruebaCalendarioId === pruebaElegida
                    }
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

function nombreDePruebaCorto(p: PruebaDeEdicion, conCategoria: boolean): string {
  return `${WEAPON_LABEL[p.arma]} ${GENDER_LABEL[p.genero].toLowerCase()}${
    conCategoria ? ` ${categoriaVisible(p.categoria.codigo)}` : ''
  }${p.formato === 'EQUIPOS' ? ' · equipos' : ''}`;
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
        'flex min-w-0 flex-col gap-2 rounded-lg border border-filete bg-card p-3',
        elegida && 'border-primary/60',
      )}
    >
      <Link
        href={construirUrlEdicion(edicionId, { prueba: prueba.id, origen: retorno })}
        className={cn(ENLACE, 'justify-between text-base font-medium text-foreground sm:text-sm')}
      >
        {nombreDePruebaCorto(prueba, conCategoria)}
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </Link>

      {podio.length > 0 ? (
        <ol aria-label="Podio" className="flex flex-col gap-1.5">
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
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
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
        aria-label={`Puesto ${puesto.puesto}`}
      >
        {puesto.puesto}
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="flex min-w-0 items-center gap-1.5">
          {puesto.personaId ? (
            <Link
              href={rutaFicha(puesto.personaId)}
              className="min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline"
            >
              {nombre}
            </Link>
          ) : (
            <span className="min-w-0 truncate text-sm font-medium">{nombre}</span>
          )}
          <BanderaPais pais={puesto.pais} />
        </span>
        {puesto.club ? (
          <span className="truncate text-xs text-muted-foreground">{titular(puesto.club)}</span>
        ) : null}
      </span>
    </li>
  );
}
