'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { BotonFiltros, HojaFiltros, OpcionesFiltro } from '@/components/filtros/chips';
import { ChipFiltro, FilaChips } from '@/components/sistema/chip-filtro';
import { categoriaRanking } from '@/lib/ranking/categoria-nacional';
import { rutaRankingNacional, temporadaCorta, type FiltroRankingNacional } from '@/lib/ranking/url-nacional';
import { rotuloArma, rotuloGenero } from '@/lib/sport/rotulos';
import { cn } from '@/lib/utils';
import { armaYGenero } from './selectores-grupo';

type Grupo = { arma: 'ESPADA' | 'FLORETE' | 'SABLE'; genero: 'M' | 'F'; categoria: string; categoriaRaw: string };

/**
 * Temporada (y, en temporadas pasadas, arma, género y categoría) de la
 * clasificación nacional. Cada cambio es una navegación: la URL es el enlace
 * que se comparte.
 *
 * Sin `grupo` es sólo el apartado «Temporada» de la hoja de filtros de la
 * tabla vigente. Con `grupo` es la barra entera de una temporada pasada, con
 * la misma forma que la de la vigente: chip del grupo, la temporada como
 * filtro quitable (quitarla vuelve a la vigente) y la hoja.
 */
export function SelectorTemporada({
  temporadas,
  vigente,
  actual,
  grupos = [],
  grupo = null,
  className,
}: {
  /** De la más reciente a la más antigua. */
  temporadas: string[];
  /** La temporada en curso: elegirla vuelve a la vista de siempre. */
  vigente: string | null;
  actual: FiltroRankingNacional;
  grupos?: Grupo[];
  grupo?: Grupo | null;
  className?: string;
}) {
  const router = useRouter();
  const [pendiente, empezar] = React.useTransition();
  const [abierta, setAbierta] = React.useState(false);
  const ir = (f: Partial<FiltroRankingNacional>) => {
    const ruta = rutaRankingNacional(f);
    // A la vigente se vuelve en Nacional, que es de donde se venía.
    const destino = f.temporada ? ruta : `${ruta}${ruta.includes('?') ? '&' : '?'}ambito=nacional`;
    empezar(() => router.push(destino, { scroll: false }));
  };

  const temporada = actual.temporada ?? vigente ?? temporadas[0] ?? '';
  const base = grupo ? { temporada, arma: grupo.arma, genero: grupo.genero, categoria: grupo.categoriaRaw } : { temporada };
  // Volver a la vigente conserva arma y género; la categoría publicada puede no existir allí.
  const aVigente = () => ir(grupo ? { arma: grupo.arma, genero: grupo.genero } : {});

  const opcionesTemporada = (
    <OpcionesFiltro
      titulo="Temporada"
      valor={temporada}
      opciones={temporadas.map((t) => ({ valor: t, etiqueta: temporadaCorta(t), detalle: t === vigente ? 'en curso' : undefined }))}
      onCambio={(t) => (t === vigente ? aVigente() : ir({ ...base, temporada: t }))}
    />
  );

  if (!grupo) return <div aria-busy={pendiente || undefined} className={className}>{opcionesTemporada}</div>;

  const armas = [...new Set(grupos.map((g) => g.arma))];
  const generos = [...new Set(grupos.filter((g) => g.arma === grupo.arma).map((g) => g.genero))];
  const categorias = grupos.filter((g) => g.arma === grupo.arma && g.genero === grupo.genero);
  const prueba = armaYGenero({ weapon: grupo.arma, gender: grupo.genero });
  const categoria = categoriaRanking(grupo.categoria, grupo.categoriaRaw);
  const abrir = () => setAbierta(true);

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)} aria-busy={pendiente || undefined} data-barra-filtros="">
      <FilaChips etiqueta="Prueba y filtros puestos">
        <BotonFiltros activos={1} onClick={abrir} />
        <ChipFiltro tipo="menu" onClick={abrir} aria-label={`Prueba: ${prueba}. Cambiar`}>{prueba}</ChipFiltro>
        <ChipFiltro tipo="menu" onClick={abrir} aria-label={`Categoría: ${categoria}. Cambiar`}>{categoria}</ChipFiltro>
        <ChipFiltro tipo="quitar" onClick={aVigente} aria-label={`Quitar filtro: temporada ${temporada}`}>
          {`Temporada ${temporadaCorta(temporada)}`}
        </ChipFiltro>
      </FilaChips>
      <HojaFiltros abierta={abierta} onAbierta={setAbierta} resultados="Ver la clasificación" onLimpiar={aVigente}>
        {opcionesTemporada}
        <OpcionesFiltro
          titulo="Arma"
          valor={grupo.arma}
          opciones={armas.map((a) => ({ valor: a, etiqueta: rotuloArma(a) }))}
          onCambio={(a) => ir({ ...base, arma: a as Grupo['arma'] })}
        />
        <OpcionesFiltro
          titulo="Género"
          valor={grupo.genero}
          opciones={generos.map((g) => ({ valor: g, etiqueta: rotuloGenero(g) }))}
          onCambio={(g) => ir({ ...base, genero: g as Grupo['genero'] })}
        />
        <OpcionesFiltro
          titulo="Categoría"
          valor={grupo.categoriaRaw}
          opciones={categorias.map((c) => ({ valor: c.categoriaRaw, etiqueta: categoriaRanking(c.categoria, c.categoriaRaw) }))}
          onCambio={(c) => ir({ ...base, categoria: c })}
        />
      </HojaFiltros>
    </div>
  );
}
