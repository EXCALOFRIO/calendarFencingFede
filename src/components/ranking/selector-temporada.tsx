'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { categoriaRanking } from '@/lib/ranking/categoria-nacional';
import { rutaRankingNacional, temporadaCorta, type FiltroRankingNacional } from '@/lib/ranking/url-nacional';
import { GENDER_LABEL, WEAPON_LABEL, cn } from '@/lib/utils';

type Grupo = { arma: 'ESPADA' | 'FLORETE' | 'SABLE'; genero: 'M' | 'F'; categoria: string; categoriaRaw: string };

/**
 * Temporada (y, en temporadas pasadas, arma, género y categoría) de la
 * clasificación nacional. Cada cambio es una navegación: la URL es el enlace
 * que se comparte.
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
  const [pendiente, empezar] = useTransition();
  const ir = (f: Partial<FiltroRankingNacional>) =>
    empezar(() => router.push(rutaRankingNacional(f), { scroll: false }));

  const temporada = actual.temporada ?? vigente ?? temporadas[0] ?? '';
  const armas = [...new Set(grupos.map((g) => g.arma))];
  const generos = grupo ? [...new Set(grupos.filter((g) => g.arma === grupo.arma).map((g) => g.genero))] : [];
  const categorias = grupo ? grupos.filter((g) => g.arma === grupo.arma && g.genero === grupo.genero) : [];
  const base = grupo ? { temporada, arma: grupo.arma, genero: grupo.genero, categoria: grupo.categoriaRaw } : { temporada };

  // Mismo aspecto que `SelectoresGrupo`: rótulo pequeño encima y el control a lo ancho.
  const campo = (rotulo: string, control: React.ReactNode, clave: string) => (
    <label key={clave} className="min-w-0 flex-[1_1_7rem] sm:max-w-44">
      <span className="mb-1 block text-xs text-muted-foreground">{rotulo}</span>
      {control}
    </label>
  );

  const selectorTemporada = campo('Temporada', (
    <Select value={temporada} onValueChange={(t) => ir(t === vigente ? {} : { ...base, temporada: t })}>
      <SelectTrigger className="w-full" aria-label="Temporada" aria-busy={pendiente}>
        <SelectValue>{temporadaCorta(temporada)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {temporadas.map((t) => (
          <SelectItem key={t} value={t}>{t}{t === vigente ? ' (en curso)' : ''}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  ), 'temporada');

  // Sin grupo es sólo el primer campo de la fila de filtros de la tabla vigente.
  if (!grupo) return <div className={cn('contents', pendiente && '[&>label]:opacity-70', className)}>{selectorTemporada}</div>;

  return (
    <div className={cn('flex min-w-0 flex-wrap items-end gap-2', pendiente && 'opacity-70', className)} aria-busy={pendiente}>
      {selectorTemporada}
      {campo('Arma', (
        <Select value={grupo.arma} onValueChange={(a) => ir({ ...base, arma: a as Grupo['arma'] })}>
          <SelectTrigger className="w-full" aria-label="Arma">
            <SelectValue>{WEAPON_LABEL[grupo.arma]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {armas.map((a) => <SelectItem key={a} value={a}>{WEAPON_LABEL[a]}</SelectItem>)}
          </SelectContent>
        </Select>
      ), 'arma')}
      {campo('Género', (
        <Select value={grupo.genero} onValueChange={(g) => ir({ ...base, genero: g as Grupo['genero'] })}>
          <SelectTrigger className="w-full" aria-label="Género">
            <SelectValue>{GENDER_LABEL[grupo.genero]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {generos.map((g) => <SelectItem key={g} value={g}>{GENDER_LABEL[g]}</SelectItem>)}
          </SelectContent>
        </Select>
      ), 'genero')}
      {campo('Categoría', (
        <Select value={grupo.categoriaRaw} onValueChange={(c) => ir({ ...base, categoria: c })}>
          <SelectTrigger className="w-full" aria-label="Categoría">
            <SelectValue>{categoriaRanking(grupo.categoria, grupo.categoriaRaw)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {categorias.map((c) => (
              <SelectItem key={c.categoriaRaw} value={c.categoriaRaw}>{categoriaRanking(c.categoria, c.categoriaRaw)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ), 'categoria')}
    </div>
  );
}
