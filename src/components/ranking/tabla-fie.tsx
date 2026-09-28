'use client';

import { ExternalLink } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { FilaFie, RankingGroupKey, TablaFie } from '@/lib/queries/ranking';
import { cn, formatDateEs } from '@/lib/utils';
import { clave, puntos } from './formato';
import { SelectoresGrupo, nombreCasa } from './selectores-grupo';

/** Filas por tanda. Igual que en la tabla oficial. */
const PASO = 50;

/**
 * El ranking MUNDIAL de la FIE, de los tiradores españoles.
 *
 * ---------------------------------------------------------------------------
 * QUÉ SE LEE AQUÍ Y QUÉ NO
 * ---------------------------------------------------------------------------
 * El número de la izquierda es el **puesto mundial**, no el español: el
 * primero de la tabla puede ser el 5 del mundo, y eso es justo lo que se
 * viene a leer. Por eso la columna se rotula «Mundial» y no «#».
 *
 * No hay club ni año de nacimiento, y no es un olvido: la FIE no publica el
 * club (viene `null` en todas las fichas) y la fecha de nacimiento **no se
 * guarda** de quien no es uno de los nuestros, porque en ese censo hay
 * menores. El porqué está en la cabecera de
 * `src/lib/ingest/sources/fie-tiradores.ts`.
 *
 * ---------------------------------------------------------------------------
 * LOS TUYOS, MARCADOS
 * ---------------------------------------------------------------------------
 * Petición literal: *«los españoles que salgan como marcados, sabes? y con
 * buscador y tal»*. Toda la tabla es española —el censo se pide por país—, así
 * que lo que se marca es **quién de esta aplicación es**: los que tienen ficha
 * y son tuyos van con fondo rojo tenue y el puesto en rojo, la misma
 * convención que en la tabla de la RFEE. Y con el nombre en negrita, que no es
 * color: en una lista de cien nombres el color solo no basta.
 *
 * Cada fila enlaza a su ficha en fie.org. Se enlaza siempre, nunca se copia:
 * es la condición de sus términos.
 */
export function TablaRankingFie({
  grupos,
  tablas,
  grupoInicial,
  mios,
}: {
  grupos: (RankingGroupKey & { tiradores: number })[];
  tablas: Record<string, TablaFie>;
  grupoInicial: string;
  /** Ids de los tiradores de esta cuenta, para marcarlos. */
  mios: string[];
}) {
  const [claveActual, setClaveActual] = React.useState(grupoInicial);
  const [tope, setTope] = React.useState(PASO);
  const [busqueda, setBusqueda] = React.useState('');

  const tabla = tablas[claveActual] ?? Object.values(tablas)[0] ?? null;
  const grupo = tabla?.group ?? grupos[0];

  /**
   * Al cambiar de grupo se vuelve al tope de partida y se limpia la búsqueda:
   * arrastrar «juan» de una categoría a otra hace que la siguiente parezca
   * vacía y nadie relaciona la causa con un campo que se quedó escrito.
   */
  const elegir = (parcial: Partial<RankingGroupKey>) => {
    if (!grupo) return;
    const pedido = { ...grupo, ...parcial };
    // Si la combinación pedida no existe, se cae a una que sí, empezando por
    // lo que se acaba de tocar: cambiar de arma no puede dejar la pantalla en
    // blanco porque esa arma no tenga esa categoría.
    const existe = grupos.some((g) => clave(g) === clave(pedido));
    const destino = existe
      ? pedido
      : (grupos.find(
          (g) =>
            (parcial.weapon ? g.weapon === parcial.weapon : true) &&
            (parcial.gender ? g.gender === parcial.gender : true) &&
            (parcial.category ? g.category === parcial.category : true),
        ) ?? grupos[0]);
    if (!destino) return;
    setClaveActual(clave(destino));
    setTope(PASO);
    setBusqueda('');
  };

  if (!tabla || !grupo) return null;

  const filtradas = busqueda
    ? tabla.rows.filter((f) => nombreCasa(f.nombre, busqueda))
    : tabla.rows;

  /**
   * Buscando se enseña TODO lo que casa, sin «ver más»: quien escribe un
   * nombre quiere ese nombre, y esconderlo detrás de un botón porque está en
   * el puesto 120 convierte el buscador en un adorno.
   */
  const visibles = busqueda ? filtradas : filtradas.slice(0, tope);
  const quedan = filtradas.length - visibles.length;

  /**
   * La columna de pruebas, SOLO si este grupo la tiene.
   *
   * El nº de pruebas que puntúan sale de otro endpoint de la FIE
   * (`detailed-ranking`, ~250 KB por combinación) y solo se pide para las
   * combinaciones donde hay alguien nuestro enlazado: 74 de 402 filas lo
   * tienen. Enseñar una columna entera de guiones es peor que no enseñarla,
   * así que aparece cuando hay algo que poner.
   */
  const hayPruebas = tabla.rows.some((f) => f.eventCount !== null);

  return (
    <div className="flex flex-col gap-5">
      <SelectoresGrupo
        grupos={grupos}
        grupo={grupo}
        onElegir={elegir}
        busqueda={busqueda}
        onBuscar={setBusqueda}
      />

      <p className="medida text-xs text-muted-foreground">
        Ranking mundial de la FIE, temporada {tabla.season}
        {tabla.actualizadoEl ? ` · leído el ${formatDateEs(tabla.actualizadoEl)}` : ''}
        {' · '}
        <span>solo tiradores españoles</span>
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            {/* «Mundial» y no «#»: el número no es el puesto en esta lista. */}
            <TableHead className="w-16 pl-0 text-right">Mundial</TableHead>
            <TableHead>Tirador</TableHead>
            {hayPruebas ? (
              <TableHead className="hidden w-20 text-right sm:table-cell">
                Pruebas
              </TableHead>
            ) : null}
            <TableHead className="w-20 pr-0 text-right">Puntos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibles.map((fila) => (
            <Fila
              key={fila.fieId}
              fila={fila}
              marca={marcaDe(fila, mios)}
              conPruebas={hayPruebas}
            />
          ))}
        </TableBody>
      </Table>

      {busqueda && filtradas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nadie con ese nombre en {tabla.rows.length} tiradores de esta
          clasificación. La FIE los publica al revés y en mayúsculas («CASAUS
          PIELAGO Jorge»), pero aquí da igual el orden.
        </p>
      ) : null}

      {quedan > 0 ? (
        <Button
          variant="outline"
          className="h-11 w-full"
          onClick={() => setTope(tope + PASO)}
        >
          Ver {Math.min(quedan, PASO)} más de {filtradas.length}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Qué se marca y con qué fuerza.
 *
 * Dos niveles, porque son dos preguntas distintas:
 *
 *  - **`nuestro`**: está en esta aplicación. Es lo que pidió el usuario
 *    —*«los españoles que salgan como marcados»*— y lo que le sirve al
 *    seleccionador, que no gestiona fichas de nadie y con la marca limitada a
 *    «los míos» no vería ni una en 343 filas.
 *  - **`mio`**: además es uno de los tuyos. Va en negrita, que no es color: en
 *    una lista larga el color solo no basta.
 */
function marcaDe(fila: FilaFie, mios: string[]): { nuestro: boolean; mio: boolean } {
  const mio = fila.athleteId !== null && mios.includes(fila.athleteId);
  return { nuestro: fila.athleteId !== null, mio };
}

function Fila({
  fila,
  marca,
  conPruebas,
}: {
  fila: FilaFie;
  marca: { nuestro: boolean; mio: boolean };
  conPruebas: boolean;
}) {
  return (
    <TableRow className={cn(marca.nuestro && 'bg-primary/10 hover:bg-primary/15')}>
      <TableCell className="pl-0 text-right align-top">
        <span
          className={cn(
            'cifra text-xl',
            marca.nuestro ? 'text-primary-text' : 'text-foreground',
          )}
        >
          {fila.position ?? '—'}
        </span>
      </TableCell>
      <TableCell className="align-top">
        <a
          href={fila.fichaUrl}
          target="_blank"
          rel="noreferrer"
          className={cn(
            'inline-flex items-center gap-1.5 hover:underline',
            marca.mio && 'font-semibold',
          )}
        >
          {fila.nombre}
          <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        </a>
        {/* Las pruebas, cuando la columna está escondida en el móvil. */}
        {fila.eventCount !== null ? (
          <span className="block text-xs text-muted-foreground sm:hidden">
            {fila.eventCount} {fila.eventCount === 1 ? 'prueba' : 'pruebas'}
          </span>
        ) : null}
      </TableCell>
      {conPruebas ? (
        <TableCell className="hidden text-right align-top sm:table-cell">
          <span className="cifra text-sm text-muted-foreground">
            {fila.eventCount ?? '—'}
          </span>
        </TableCell>
      ) : null}
      <TableCell className="pr-0 text-right align-top">
        <span className="cifra font-medium">
          {fila.points === null ? '—' : puntos(fila.points)}
        </span>
      </TableCell>
    </TableRow>
  );
}
