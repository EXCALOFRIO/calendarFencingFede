import { etiquetaTemporadaDeportiva, porcentajeVictorias } from '@/lib/sport/explorar/perfil-modelo';
import type { PerfilDeportivo, TemporadaPerfil } from '@/lib/sport/explorar/tipos-perfil';
import { Bloque, Nota, type Nivel } from '../piezas';

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
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-xs text-muted-foreground">
        {serie.medida === 'victorias'
          ? 'Porcentaje de asaltos ganados por temporada. La línea marca el 50 %.'
          : 'Mejor puesto por temporada: cuanto más alta la barra, mejor puesto.'}
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
        {serie.puntos.map((p) => (
          <li key={p.temporada} className="flex min-w-0 flex-col">
            <span className="cifra text-sm leading-tight sm:text-base">{p.texto}</span>
            <span className="text-[0.625rem] leading-tight text-muted-foreground break-all sm:text-xs">
              {etiquetaTemporadaDeportiva(p.temporada)}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

function Celda({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-[0.6875rem] leading-tight text-muted-foreground">{etiqueta}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function medallas(t: TemporadaPerfil): string {
  const partes = [
    t.medallero.oros ? `${t.medallero.oros} ${t.medallero.oros === 1 ? 'oro' : 'oros'}` : '',
    t.medallero.platas ? `${t.medallero.platas} ${t.medallero.platas === 1 ? 'plata' : 'platas'}` : '',
    t.medallero.bronces ? `${t.medallero.bronces} ${t.medallero.bronces === 1 ? 'bronce' : 'bronces'}` : '',
  ].filter(Boolean);
  return partes.join(', ');
}

function FilaTemporada({ t }: { t: TemporadaPerfil }) {
  const total = t.medallero.oros + t.medallero.platas + t.medallero.bronces;
  const pct = porcentajeVictorias(t.asaltos);
  const vacio = <span className="text-xs text-muted-foreground">Sin dato</span>;
  return (
    <li className="grid min-w-0 gap-3 px-4 py-4 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center sm:px-5">
      <p className="font-display text-2xl leading-none">{etiquetaTemporadaDeportiva(t.temporada)}</p>
      <dl className="grid grid-cols-5 gap-x-2 gap-y-2">
        <Celda etiqueta="Pruebas">
          {t.pruebas > 0 ? <span className="cifra text-2xl leading-none sm:text-3xl">{t.pruebas}</span> : vacio}
        </Celda>
        <Celda etiqueta="Mejor">
          {t.mejorPuesto !== null ? <span className="cifra text-2xl leading-none sm:text-3xl">{t.mejorPuesto}º</span> : vacio}
        </Celda>
        <Celda etiqueta="Medallas">
          {t.pruebas > 0 ? (
            <span className="flex flex-col">
              <span className="cifra text-2xl leading-none sm:text-3xl">{total}</span>
              {total > 0 ? <span className="text-[0.6875rem] leading-tight text-muted-foreground">{medallas(t)}</span> : null}
            </span>
          ) : vacio}
        </Celda>
        <Celda etiqueta="Asaltos">
          {t.asaltos && t.asaltos.asaltos > 0
            ? <span className="cifra text-2xl leading-none whitespace-nowrap sm:text-3xl">{t.asaltos.victorias}–{t.asaltos.derrotas}</span>
            : vacio}
        </Celda>
        <Celda etiqueta="Ganados">
          {pct !== null ? <span className="cifra text-2xl leading-none sm:text-3xl">{pct}%</span> : vacio}
        </Celda>
      </dl>
    </li>
  );
}

/** Año a año: una fila por temporada deportiva, la más reciente arriba, con su gráfico. */
export function AnioAAnio({
  perfil,
  nivel,
  enPestana = false,
}: {
  perfil: PerfilDeportivo;
  nivel: Nivel;
  enPestana?: boolean;
}) {
  const serie = serieTemporadas(perfil.temporadas);
  return (
    <Bloque id="ficha-temporadas" titulo="Año a año" nivel={nivel} tituloOculto={enPestana}>
      {perfil.temporadas.length === 0 ? (
        <p role="status" className="medida text-sm text-muted-foreground">
          Sin datos importados por temporada. Cuando se importen clasificaciones o asaltos de esta
          persona, aparecerán aquí agrupados por temporada.
        </p>
      ) : (
        <>
          {serie ? <Grafico serie={serie} /> : null}
          <ol className="divide-y border-y bg-card" aria-label="Resultados por temporada">
            {perfil.temporadas.map((t) => <FilaTemporada key={t.temporada} t={t} />)}
          </ol>
          <Nota>
            Una temporada va de septiembre a agosto. La FIE la nombra por el año en que acaba (FIE 2025
            es 2024-25) y aquí se junta con la de la RFEE. Sólo cuentan pruebas individuales; un asalto
            empatado no es victoria ni derrota.
          </Nota>
        </>
      )}
    </Bloque>
  );
}
