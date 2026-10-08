import { BarrasDivergentes } from '@/components/explorar/graficos/barras-divergentes';
import { COLOR } from '@/components/explorar/graficos/comun';
import { LineaTemporal } from '@/components/explorar/graficos/linea-temporal';
import { Celda, Rejilla } from '@/components/explorar/graficos/piezas-graficos';
import type { Marcador, TemporadaDuelo } from '@/lib/sport/explorar/pais';
import { temporadaCorta } from '@/lib/sport/explorar/pais-frases';

const MAX_TEMPORADAS = 20;

export type PuntoSerie = { temporada: string; victorias: number; derrotas: number; balance: number; porcentaje: number };

/**
 * La serie por temporada de la modalidad que se enseña, con el balance
 * acumulado (victorias menos derrotas) desde la primera temporada con cruces,
 * aunque sólo se pinten las últimas `MAX_TEMPORADAS`.
 */
export function serieTemporadas(temporadas: readonly TemporadaDuelo[], equipos: boolean): PuntoSerie[] {
  let balance = 0;
  const serie: PuntoSerie[] = [];
  for (const t of temporadas) {
    const m: Marcador = equipos ? t.equipos : t.individual;
    const total = m.victorias + m.derrotas;
    if (total === 0) continue;
    balance += m.victorias - m.derrotas;
    serie.push({ temporada: t.temporada, victorias: m.victorias, derrotas: m.derrotas, balance, porcentaje: Math.round((m.victorias / total) * 100) });
  }
  return serie.slice(-MAX_TEMPORADAS);
}

const corta = (t: string) => `’${t.slice(-2)}`;

/** Victorias y derrotas, balance acumulado y porcentaje por temporada, desde `nuestro`. */
export function GraficosDuelo({
  temporadas,
  equipos,
  nuestro,
  suyo,
}: {
  temporadas: readonly TemporadaDuelo[];
  equipos: boolean;
  /** Códigos de país, para las leyendas. */
  nuestro: string;
  suyo: string;
}) {
  const serie = serieTemporadas(temporadas, equipos);
  if (serie.length < 2) return null;
  const etiquetas = serie.map((p) => corta(p.temporada));
  const lectura = (p: PuntoSerie) => `${temporadaCorta(p.temporada)}: ${p.victorias}–${p.derrotas} (${p.porcentaje} %), balance ${p.balance > 0 ? '+' : ''}${p.balance}`;
  const lecturas = serie.map(lectura);
  const balances = serie.map((p) => p.balance);
  const bajo = Math.min(0, ...balances);
  const alto = Math.max(1, ...balances);
  const margen = Math.max(1, (alto - bajo) * 0.08);
  const ultimo = serie[serie.length - 1];
  return (
    <Rejilla className="sm:grid-cols-2">
      <Celda rotulo="Por temporada" className="sm:col-span-2">
        <BarrasDivergentes
          titulo={`Victorias y derrotas de ${nuestro} contra ${suyo} por temporada`}
          columnas={serie.map((p, i) => ({ etiqueta: etiquetas[i], arriba: p.victorias, abajo: p.derrotas, lectura: lecturas[i] }))}
          arriba={{ nombre: nuestro, color: COLOR.victoria }}
          abajo={{ nombre: suyo, color: COLOR.derrota }}
          inicial={lectura(ultimo)}
        />
      </Celda>
      <Celda rotulo="Balance acumulado" cifra={`${ultimo.balance > 0 ? '+' : ''}${ultimo.balance}`}>
        <LineaTemporal
          etiquetas={etiquetas}
          titulo={`Balance acumulado de ${nuestro} contra ${suyo}: ${ultimo.balance}`}
          series={[{ clave: 'balance', nombre: 'Balance', color: COLOR.marca, valores: balances, area: true, lecturas }]}
          min={bajo - (bajo < 0 ? margen : 0)}
          max={alto + margen}
          marcas={[{ valor: 0, rotulo: '0' }]}
          alto="sm"
        />
      </Celda>
      <Celda rotulo="% de victorias" cifra={`${ultimo.porcentaje}`} unidad="%">
        <LineaTemporal
          etiquetas={etiquetas}
          titulo={`Porcentaje de victorias de ${nuestro} por temporada`}
          series={[{ clave: 'porcentaje', nombre: '% de victorias', color: COLOR.marca, valores: serie.map((p) => p.porcentaje), lecturas }]}
          min={0}
          max={100}
          marcas={[{ valor: 50, rotulo: '50 %' }]}
          alto="sm"
        />
      </Celda>
    </Rejilla>
  );
}
