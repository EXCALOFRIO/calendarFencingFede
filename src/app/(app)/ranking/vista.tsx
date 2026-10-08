import { IdCard } from 'lucide-react';
import Link from 'next/link';
import { PanelRanking } from '@/components/ranking/panel-ranking';
import { SelectorTemporada } from '@/components/ranking/selector-temporada';
import { TablaTemporada } from '@/components/ranking/tabla-temporada';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import type { cargarClasificacionFie, cargarRankingEuropeo, cargarRankingNacional } from './consultas';
import type { PantallaRanking } from './datos';

/**
 * Lo que pinta /ranking con los datos ya leídos (`cargarPantallaRanking`).
 * El título «Ranking» lo pone la cabecera compacta (`cabeceraDeRuta`).
 */
export function VistaRanking({
  datos,
  cargar,
  cargarNacional,
  cargarEuropeo,
}: {
  datos: PantallaRanking;
  cargar: typeof cargarClasificacionFie;
  cargarNacional: typeof cargarRankingNacional;
  cargarEuropeo?: typeof cargarRankingEuropeo;
}) {
  if (datos.tipo === 'historica') {
    const { temporadas, vigente, filtro, grupos, grupo, tabla, misPersonas } = datos;
    return (
      <>
        <SelectorTemporada temporadas={temporadas} vigente={vigente} actual={filtro} grupos={grupos} grupo={grupo} className="mb-4" />
        {tabla && tabla.filas.length > 0 ? (
          <TablaTemporada tabla={tabla} mios={misPersonas} />
        ) : (
          <EstadoVacio titulo="Sin clasificación publicada" />
        )}
      </>
    );
  }

  if (datos.tipo === 'vacia') {
    return (
      <EstadoVacio titulo="Sin clasificación todavía" descripcion="Saldrá aquí en cuanto la federación la publique." />
    );
  }

  const { ambito, mios, temporadas, vigente, filtro, nacional, fichas, conMiFicha, grupoInicial, mundial, grupoMundial, primeraTablaMundial, europeo, sinFicha, esPersonal } = datos;
  return (
    <>
      <PanelRanking
        key={grupoInicial}
        federacionInicial={ambito}
        fichas={fichas}
        nacional={{ datos: nacional, cargar: cargarNacional, grupoInicial, conMiFicha, temporadas, vigente, filtro }}
        fie={
          grupoMundial
            ? { grupos: mundial.grupos, inicial: grupoMundial, primeraTabla: primeraTablaMundial, mios, cargar }
            : null
        }
        europeo={
          cargarEuropeo && europeo.inicial && europeo.grupos.length > 0
            ? { grupos: europeo.grupos, inicial: europeo.inicial, primeraTabla: europeo.primeraTabla, mios: europeo.mios, cargar: cargarEuropeo }
            : null
        }
      />
      {sinFicha && esPersonal ? (
        <p className="mt-6 flex items-start gap-2 text-sm text-muted-foreground">
          <IdCard className="mt-1 size-4 shrink-0" aria-hidden />
          <span className="medida">
            Vincula tu ficha para ver tu puesto.{' '}
            <Link href="/alta" className="inline-flex min-h-[44px] items-center text-primary-text underline underline-offset-4">
              Buscar mi ficha
            </Link>
            .
          </span>
        </p>
      ) : null}
    </>
  );
}
