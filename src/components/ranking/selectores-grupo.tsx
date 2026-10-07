'use client';

import * as React from 'react';
import { BotonFiltros, CampoBuscar, HojaFiltros, OpcionesFiltro } from '@/components/filtros/chips';
import { ChipFiltro, FilaChips } from '@/components/sistema/chip-filtro';
import type { RankingGroupKey } from '@/lib/queries/ranking';
import { CATEGORY_LABEL, GENDER_LABEL, WEAPON_LABEL, cn } from '@/lib/utils';
import { type Ambito, useRanking } from './estado-ranking';

export type Quitable = { clave: string; texto: React.ReactNode; etiqueta: string; onQuitar: () => void };

const categoriaLegible = (c: string) => CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c;
/** «Florete masculino»: dos palabras, lo que cabe en un chip (`docs/diseno-sistema.md` § 6). */
export const armaYGenero = (g: Pick<RankingGroupKey, 'weapon' | 'gender'>) =>
  `${WEAPON_LABEL[g.weapon]} ${GENDER_LABEL[g.gender].toLowerCase()}`;

const ROTULO_AMBITO: Record<Ambito, string> = { RFEE: 'Nacional', FIE: 'Internacional', EFC: 'Europeo' };

/**
 * Los filtros de las clasificaciones, con las piezas del sistema:
 *
 *  1. Nacional / Internacional / Europeo en una fila de chips (sólo dentro de
 *     `PanelRanking` y si hay más de uno);
 *  2. el buscador y el chip «Filtros» con su cuenta;
 *  3. lo que está puesto, en chips: arma y género, categoría, los
 *     interruptores rápidos («Solo España», olímpicos) y los quitables.
 *
 * Todo lo demás vive en la `HojaInferior`. **Una sola barra para todas las
 * tablas**: con el bloque escrito dos veces, el día que se cambie uno
 * quedarían distintos sin que nadie se entere.
 *
 * Las opciones salen de los grupos QUE TIENEN DATOS, no de la lista completa
 * de armas y categorías: ofrecer «sable M9 femenino» para que al tocarlo salga
 * vacío es una promesa incumplida en cada toque.
 */
export function BarraFiltrosRanking({
  grupos,
  grupo,
  onElegir,
  busqueda,
  onBuscar,
  etiquetaBusqueda = 'Buscar un tirador',
  chips = null,
  quitables = [],
  antesEnHoja = null,
  activos = 0,
  resultados = 'Ver la clasificación',
  onRestablecer = null,
}: {
  grupos: RankingGroupKey[];
  grupo: RankingGroupKey;
  onElegir: (parcial: Partial<RankingGroupKey>) => void;
  /** Sin `onBuscar` no hay buscador. */
  busqueda?: string;
  onBuscar?: (v: string) => void;
  etiquetaBusqueda?: string;
  /** Interruptores rápidos detrás de la prueba («Solo España», olímpicos). */
  chips?: React.ReactNode;
  /** Filtros aplicados que no son el grupo (temporada pasada, Selecciones), con su aspa. */
  quitables?: Quitable[];
  /** Apartados de la hoja antes de arma, género y categoría (temporada, formato). */
  antesEnHoja?: React.ReactNode;
  /** Cuántos filtros distintos de los de partida hay puestos. */
  activos?: number;
  /** Texto del botón del pie de la hoja: «Ver 907 tiradores». */
  resultados?: string;
  onRestablecer?: (() => void) | null;
}) {
  const ranking = useRanking();
  const [abierta, setAbierta] = React.useState(false);
  const abrir = () => setAbierta(true);

  const armas = [...new Set(grupos.map((g) => g.weapon))];
  const generos = [...new Set(grupos.filter((g) => g.weapon === grupo.weapon).map((g) => g.gender))];
  const categorias = [
    ...new Set(grupos.filter((g) => g.weapon === grupo.weapon && g.gender === grupo.gender).map((g) => g.category)),
  ];
  const prueba = armaYGenero(grupo);
  const categoria = categoriaLegible(grupo.category);

  return (
    <div className="flex min-w-0 flex-col gap-[10px]" data-barra-filtros="">
      {ranking && ranking.ambitos.length > 1 ? <ChipsAmbito /> : null}

      <div className="flex min-w-0 items-center gap-[8px] sm:max-w-md">
        {onBuscar ? (
          <CampoBuscar valor={busqueda ?? ''} onCambio={onBuscar} etiqueta={etiquetaBusqueda} placeholder="Buscar" className="flex-1" />
        ) : null}
        <BotonFiltros activos={activos} onClick={abrir} />
      </div>

      <FilaChips etiqueta="Prueba y filtros puestos">
        <ChipFiltro tipo="menu" onClick={abrir} aria-label={`Prueba: ${prueba}. Cambiar`}>
          {prueba}
        </ChipFiltro>
        <ChipFiltro tipo="menu" onClick={abrir} aria-label={`Categoría: ${categoria}. Cambiar`}>
          {categoria}
        </ChipFiltro>
        {chips}
        {quitables.map((q) => (
          <ChipFiltro key={q.clave} tipo="quitar" onClick={q.onQuitar} aria-label={`Quitar filtro: ${q.etiqueta}`}>
            {q.texto}
          </ChipFiltro>
        ))}
      </FilaChips>

      <HojaFiltros abierta={abierta} onAbierta={setAbierta} resultados={resultados} onLimpiar={onRestablecer}>
        <ContenidoHoja
          antes={antesEnHoja}
          chips={chips}
          grupo={grupo}
          armas={armas}
          generos={generos}
          categorias={categorias}
          onElegir={onElegir}
        />
      </HojaFiltros>
    </div>
  );
}

/** Qué ranking se enseña. El chip tocado se marca al momento, aunque su tabla tarde en llegar. */
function ChipsAmbito() {
  const ranking = useRanking();
  if (!ranking) return null;
  const marcado = ranking.pendiente ?? ranking.ambito;
  return (
    <FilaChips etiqueta="Qué ranking se enseña">
      {ranking.ambitos.map((a) => (
        <ChipFiltro
          key={a}
          marcado={a === marcado}
          aria-busy={ranking.pendiente === a || undefined}
          onClick={() => ranking.cambiarAmbito(a)}
          onPointerEnter={() => ranking.intencion(a)}
          onPointerDown={() => ranking.intencion(a)}
          onFocus={() => ranking.intencion(a)}
        >
          {ROTULO_AMBITO[a]}
        </ChipFiltro>
      ))}
    </FilaChips>
  );
}

/** Lo que va dentro de la hoja. Exportado para pintarlo fuera del portal en las capturas. */
export function ContenidoHoja({
  antes,
  chips,
  grupo,
  armas,
  generos,
  categorias,
  onElegir,
}: {
  antes: React.ReactNode;
  chips: React.ReactNode;
  grupo: RankingGroupKey;
  armas: RankingGroupKey['weapon'][];
  generos: RankingGroupKey['gender'][];
  categorias: RankingGroupKey['category'][];
  onElegir: (parcial: Partial<RankingGroupKey>) => void;
}) {
  return (
    <>
      {antes}
      <OpcionesFiltro
        titulo="Arma"
        valor={grupo.weapon}
        opciones={armas.map((a) => ({ valor: a, etiqueta: WEAPON_LABEL[a] }))}
        onCambio={(v) => onElegir({ weapon: v as RankingGroupKey['weapon'] })}
      />
      <OpcionesFiltro
        titulo="Género"
        valor={grupo.gender}
        opciones={generos.map((g) => ({ valor: g, etiqueta: GENDER_LABEL[g] }))}
        onCambio={(v) => onElegir({ gender: v as RankingGroupKey['gender'] })}
      />
      <OpcionesFiltro
        titulo="Categoría"
        valor={grupo.category}
        opciones={categorias.map((c) => ({ valor: c, etiqueta: categoriaLegible(c) }))}
        onCambio={(v) => onElegir({ category: v as RankingGroupKey['category'] })}
      />
      {chips ? (
        <fieldset className="flex min-w-0 flex-col">
          <legend className="mb-[8px] text-[12px] font-medium text-muted-foreground">Mostrar</legend>
          <div className={cn('flex min-w-0 flex-wrap gap-[8px]')}>{chips}</div>
        </fieldset>
      ) : null}
    </>
  );
}

/*
  `nombreCasa` vivía aquí y se ha subido a `src/lib/nombres.ts`.

  Motivo: este fichero lleva `'use client'`, y la búsqueda por nombre de
  `/alta` —que corre en el servidor— necesitaba la misma idea. Importarla
  desde aquí se habría llevado por delante media biblioteca de React al
  servidor. Allí está, junto con la versión que además perdona erratas.
*/
