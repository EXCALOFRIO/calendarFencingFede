import { etiquetaTemporadaDeportiva, porcentajeVictorias } from '@/lib/sport/explorar/perfil-modelo';
import type { PerfilDeportivo, TemporadaPerfil } from '@/lib/sport/explorar/tipos-perfil';
import { Bloque, type Nivel } from '../piezas';
import { cn } from '@/lib/utils';
import { Medallero } from './medallas';

type Punto = { temporada: string; valor: number; texto: string };

/**
 * Serie para el gráfico: el porcentaje de asaltos ganados si hay asaltos en al
 * menos dos temporadas; si no, el mejor puesto. Cronológica (la tabla va al
 * revés, lo más reciente arriba).
 */
export function serieTemporadas(temporadas: readonly TemporadaPerfil[]):
  | { medida: 'victorias' | 'puesto'; puntos: Punto[] }
  | null {
  const cronologicas = [...temporadas].reverse();
  const conPct = cronologicas.flatMap((t) => {
    const pct = porcentajeVictorias(t.asaltos);
    return pct === null ? [] : [{ temporada: t.temporada, valor: pct, texto: `${pct}%` }];
  });
  if (conPct.length >= 2) return { medida: 'victorias', puntos: conPct };
  const conPuesto = cronologicas.flatMap((t) =>
    t.mejorPuesto === null ? [] : [{ temporada: t.temporada, valor: t.mejorPuesto, texto: `${t.mejorPuesto}º` }]);
  return conPuesto.length >= 2 ? { medida: 'puesto', puntos: conPuesto } : null;
}

const ALTO = 100;
const PASO = 40;

/** Alto de la barra en unidades del viewBox. Para el puesto, el 1º es la barra más alta. */
export function altoBarra(medida: 'victorias' | 'puesto', valor: number, peor: number): number {
  if (medida === 'victorias') return Math.max(2, Math.min(ALTO, valor));
  return Math.max(6, Math.round(ALTO * (1 - (valor - 1) / Math.max(peor, 2))));
}

function Grafico({ serie }: { serie: NonNullable<ReturnType<typeof serieTemporadas>> }) {
  const ancho = serie.puntos.length * PASO;
  const peor = Math.max(...serie.puntos.map((p) => p.valor));
  const denso = serie.puntos.length > 8;
  const salto = Math.ceil(serie.puntos.length / 5);
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-xs text-muted-foreground">
        {serie.medida === 'victorias'
          ? 'Asaltos ganados por temporada'
          : 'Mejor puesto por temporada'}
      </figcaption>
      <svg
        viewBox={`0 0 ${ancho} ${ALTO}`}
        preserveAspectRatio="none"
        className="h-28 w-full min-w-0 sm:h-36"
        aria-hidden="true"
        focusable="false"
      >
        {serie.puntos.map((p, i) => {
          const alto = altoBarra(serie.medida, p.valor, peor);
          return <rect key={p.temporada} x={i * PASO + 8} y={ALTO - alto} width={PASO - 16} height={alto} className="fill-primary" />;
        })}
        {serie.medida === 'victorias' ? (
          <line x1="0" x2={ancho} y1={ALTO / 2} y2={ALTO / 2} className="stroke-muted-foreground" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        ) : null}
        <line x1="0" x2={ancho} y1={ALTO} y2={ALTO} className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
      <ol
        className="grid min-w-0 text-center"
        style={{ gridTemplateColumns: `repeat(${serie.puntos.length}, minmax(0, 1fr))` }}
        aria-hidden="true"
      >
        {serie.puntos.map((p, i) => {
          // En móvil, con muchas temporadas, las cifras no caben bajo cada barra:
          // se dejan en la tabla y sólo se rotulan algunas temporadas.
          const rotuladaEnMovil = !denso || i % salto === 0 || i === serie.puntos.length - 1;
          return (
            <li key={p.temporada} className="flex min-w-0 flex-col items-center">
              <span className={cn('cifra truncate text-sm leading-tight sm:block sm:text-base', denso && 'hidden')}>{p.texto}</span>
              <span className="text-xs leading-tight whitespace-nowrap text-muted-foreground sm:truncate sm:text-xs">
                <span className={cn('sm:hidden', !rotuladaEnMovil && 'invisible')}>
                  {p.temporada.replace(/^\d{2}(\d{2})-\d{2}(\d{2})$/, '$1-$2')}
                </span>
                <span className="hidden sm:inline">{etiquetaTemporadaDeportiva(p.temporada)}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

function FilaTemporada({ t }: { t: TemporadaPerfil }) {
  const pct = porcentajeVictorias(t.asaltos);
  return (
    <li className="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)_2.25rem_2.25rem_2.5rem] items-center gap-x-2 bg-card px-3 py-3 sm:grid-cols-[6rem_minmax(0,1fr)_4rem_4rem_4rem] sm:px-4">
      <span className="cifra text-xl leading-none">{etiquetaTemporadaDeportiva(t.temporada)}</span>
      <span className="flex min-w-0">
        <Medallero oros={t.medallero.oros} platas={t.medallero.platas} bronces={t.medallero.bronces} ocultarCeros />
      </span>
      <span className="flex flex-col items-end leading-none">
        <span className="cifra text-xl">{t.pruebas > 0 ? t.pruebas : '—'}</span>
        <span className="text-xs text-muted-foreground">pruebas</span>
      </span>
      <span className="flex flex-col items-end leading-none">
        <span className="cifra text-xl">{t.mejorPuesto !== null ? `${t.mejorPuesto}º` : '—'}</span>
        <span className="text-xs text-muted-foreground">mejor</span>
      </span>
      <span className="flex flex-col items-end leading-none">
        <span className="cifra text-xl">{pct !== null ? `${pct}%` : '—'}</span>
        <span className="text-xs text-muted-foreground">ganados</span>
      </span>
    </li>
  );
}

/** Año a año: el gráfico y una fila por temporada deportiva, la más reciente arriba. */
export function AnioAAnio({
  perfil,
  nivel,
  enPestana = false,
}: {
  perfil: PerfilDeportivo;
  nivel: Nivel;
  enPestana?: boolean;
}) {
  if (perfil.temporadas.length === 0) return null;
  const serie = serieTemporadas(perfil.temporadas);
  return (
    <Bloque id="ficha-temporadas" titulo="Año a año" nivel={nivel} tituloOculto={enPestana}>
      {serie ? <Grafico serie={serie} /> : null}
      <ol className="grid min-w-0 gap-px overflow-hidden rounded-xl border bg-border" aria-label="Resultados por temporada">
        {perfil.temporadas.map((t) => <FilaTemporada key={t.temporada} t={t} />)}
      </ol>
    </Bloque>
  );
}