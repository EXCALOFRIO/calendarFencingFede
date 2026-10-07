import Link from 'next/link';
import { clasesChip, FilaChips } from '@/components/sistema/chip-filtro';
import { temporadaCorta } from '@/lib/sport/explorar/pais-frases';
import {
  ARMAS_PAIS,
  ETIQUETA_ARMA,
  ETIQUETA_CATEGORIA,
  ETIQUETA_GENERO,
  ETIQUETA_MODALIDAD,
  GENEROS_PAIS,
  MODALIDADES_PAIS,
  type FiltrosDuelo,
} from '@/lib/sport/explorar/pais-url';

/**
 * Filtros de las fichas de país como enlaces: cada chip lleva a la misma
 * pantalla con ese valor puesto (o quitado, si ya estaba marcado). Sin
 * JavaScript propio; la navegación es una Transition y la pantalla anterior
 * se queda hasta que llega la nueva.
 */
export function FiltrosPais({
  filtros,
  categorias,
  temporadas,
  url,
}: {
  filtros: FiltrosDuelo;
  /** Categorías con datos, en el orden en que se ofrecen. */
  categorias: readonly string[];
  /** Sólo en el cara a cara: temporadas con cruces, la más reciente primero. */
  temporadas?: readonly string[];
  url: (f: FiltrosDuelo) => string;
}) {
  const chip = (clave: keyof FiltrosDuelo, valor: string, texto: string) => {
    const marcado = filtros[clave] === valor;
    return (
      <Link
        key={`${clave}-${valor}`}
        href={url({ ...filtros, [clave]: marcado ? '' : valor })}
        prefetch={false}
        scroll={false}
        aria-current={marcado ? 'true' : undefined}
        className={clasesChip(marcado)}
      >
        {texto}
      </Link>
    );
  };
  const categoriasOfrecidas = filtros.categoria && !categorias.includes(filtros.categoria)
    ? [...categorias, filtros.categoria]
    : categorias;
  return (
    <div className="flex min-w-0 flex-col gap-[12px]">
      <FilaChips etiqueta="Arma, género y modalidad">
        {ARMAS_PAIS.map((a) => chip('arma', a, ETIQUETA_ARMA[a]))}
        {GENEROS_PAIS.map((g) => chip('genero', g, ETIQUETA_GENERO[g]))}
        {MODALIDADES_PAIS.map((m) => chip('modalidad', m, ETIQUETA_MODALIDAD[m]))}
      </FilaChips>
      {categoriasOfrecidas.length > 0 ? (
        <FilaChips etiqueta="Categoría">
          {categoriasOfrecidas.map((c) => chip('categoria', c, ETIQUETA_CATEGORIA[c] ?? c))}
        </FilaChips>
      ) : null}
      {temporadas && temporadas.length > 1 ? (
        <FilaChips etiqueta="Temporada">
          {temporadas.map((t) => chip('temporada', t, temporadaCorta(t)))}
        </FilaChips>
      ) : null}
    </div>
  );
}
