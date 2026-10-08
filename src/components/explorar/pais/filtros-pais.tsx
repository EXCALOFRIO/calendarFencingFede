import { FilaChips } from '@/components/sistema/chip-filtro';
import { SelectorSegmentado, type OpcionSegmento } from '@/components/sistema/selector-segmentado';
import { temporadaCorta } from '@/lib/sport/explorar/pais-frases';
import {
  ARMAS_PAIS,
  ETIQUETA_MODALIDAD,
  GENEROS_PAIS,
  MODALIDADES_PAIS,
  type FiltrosDuelo,
} from '@/lib/sport/explorar/pais-url';
import { ORDEN_ARMA, rotuloArma, rotuloCategoria, rotuloGenero } from '@/lib/sport/rotulos';
import { MenuEnlaces, type OpcionEnlace } from './menu-enlaces';

/**
 * Filtros de las fichas de país, arriba del todo y como enlaces: cada opción
 * lleva a la misma pantalla con ese valor. El género va primero y grande
 * (control segmentado), luego el arma; categoría, temporada y modalidad son
 * chips que abren una hoja. Nada se desplaza en horizontal.
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
  const con = (cambio: Partial<FiltrosDuelo>) => url({ ...filtros, ...cambio });
  const generos: OpcionSegmento[] = [
    ...GENEROS_PAIS.map((g) => ({ valor: g, etiqueta: rotuloGenero(g, { variante: 'corto' }), href: con({ genero: g }) })),
    { valor: '', etiqueta: 'Todos', href: con({ genero: '' }) },
  ];
  const armas: OpcionSegmento[] = [
    { valor: '', etiqueta: 'Todas', href: con({ arma: '' }) },
    ...ORDEN_ARMA.filter((a) => (ARMAS_PAIS as readonly string[]).includes(a))
      .map((a) => ({ valor: a, etiqueta: rotuloArma(a), href: con({ arma: a }) })),
  ];
  const ofrecidas = filtros.categoria && !categorias.includes(filtros.categoria) ? [...categorias, filtros.categoria] : categorias;
  const opcion = (clave: string, texto: string, cambio: Partial<FiltrosDuelo>, marcado: boolean): OpcionEnlace =>
    ({ clave, texto, href: con(cambio), marcado });
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <SelectorSegmentado etiqueta="Género" opciones={generos} valor={filtros.genero} scroll={false} anchoMinimo={4} />
      <SelectorSegmentado etiqueta="Arma" opciones={armas} valor={filtros.arma} scroll={false} tamano="sm" anchoMinimo={4} />
      <FilaChips etiqueta="Más filtros">
        {ofrecidas.length > 0 ? (
          <MenuEnlaces
            titulo="Categoría"
            rotulo="Categoría"
            elegido={filtros.categoria ? rotuloCategoria(filtros.categoria) : null}
            opciones={[
              opcion('', 'Todas', { categoria: '' }, !filtros.categoria),
              ...ofrecidas.map((c) => opcion(c, rotuloCategoria(c), { categoria: c }, filtros.categoria === c)),
            ]}
          />
        ) : null}
        {temporadas && temporadas.length > 1 ? (
          <MenuEnlaces
            titulo="Temporada"
            rotulo="Temporada"
            elegido={filtros.temporada ? temporadaCorta(filtros.temporada) : null}
            opciones={[
              opcion('', 'Todas', { temporada: '' }, !filtros.temporada),
              ...temporadas.map((t) => opcion(t, temporadaCorta(t), { temporada: t }, filtros.temporada === t)),
            ]}
          />
        ) : null}
        <MenuEnlaces
          titulo="Modalidad"
          rotulo="Modalidad"
          elegido={filtros.modalidad ? ETIQUETA_MODALIDAD[filtros.modalidad] : null}
          opciones={[
            opcion('', 'Individual y equipos', { modalidad: '' }, !filtros.modalidad),
            ...MODALIDADES_PAIS.map((m) => opcion(m, ETIQUETA_MODALIDAD[m], { modalidad: m }, filtros.modalidad === m)),
          ]}
        />
      </FilaChips>
    </div>
  );
}
