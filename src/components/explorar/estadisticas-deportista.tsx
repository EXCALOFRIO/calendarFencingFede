import { useId } from 'react';
import { CATEGORY_LABEL, GENDER_LABEL, WEAPON_LABEL } from '@/lib/utils';
import { etiquetaTipoEstadistico } from '@/lib/sport/explorar/estadisticas-tipo';
import { segmentosCronologia } from '@/lib/sport/explorar/estadisticas';
import type { EstadisticasDeportista, ResumenEstadistico } from '@/lib/sport/explorar/tipos';
import { etiquetaTemporada } from '@/lib/sport/explorar/url';
import { fechaLegible, Nota } from './piezas';

function Cifras({ r }: { r: ResumenEstadistico }) {
  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-5 border-y bg-card px-4 py-5 sm:grid-cols-4 sm:px-6">
      <div>
        <dt className="text-xs text-muted-foreground">Pruebas individuales importadas</dt>
        <dd className="cifra mt-1 text-5xl leading-none sm:text-6xl">{r.pruebas}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Con puesto numérico</dt>
        <dd>
          <span className="cifra mt-1 block text-5xl leading-none sm:text-6xl">{r.conPuesto}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{r.sinPuesto} sin puesto numérico</span>
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Podios de torneo</dt>
        <dd>
          <span className="cifra mt-1 block text-5xl leading-none sm:text-6xl">{r.podios}</span>
          <span className="mt-1 block text-xs text-muted-foreground">de {r.conPuesto} puestos numéricos</span>
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Primeros puestos de torneo</dt>
        <dd>
          <span className="cifra mt-1 block text-5xl leading-none sm:text-6xl">{r.victorias}</span>
          <span className="mt-1 block text-xs text-muted-foreground">de {r.conPuesto} puestos numéricos</span>
        </dd>
      </div>
    </dl>
  );
}

function Cronologia({ detalle }: { detalle: EstadisticasDeportista }) {
  const patron = useId();
  const maximo = Math.max(1, ...detalle.porTemporada.map((r) => r.pruebas));
  return (
    <div className="min-w-0">
      <p className="mb-3 font-medium">Historial importado por temporada</p>
      <p className="mb-3 text-xs text-muted-foreground">
        Volumen de clasificaciones, no evolución del ranking. Relleno: con puesto; trama: sin puesto.
      </p>
      <ol className="divide-y border-y" aria-label="Clasificaciones individuales por temporada">
        {detalle.porTemporada.map((r) => {
          const segmentos = segmentosCronologia(r, maximo);
          return (
            <li key={r.temporada} className="min-w-0 py-3 sm:grid sm:grid-cols-[9rem_minmax(0,1fr)_12rem] sm:items-center sm:gap-4">
              <p className="text-sm font-medium">{etiquetaTemporada(r.temporada)}</p>
              <svg viewBox="0 0 240 18" className="my-2 h-5 w-full min-w-0" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                <defs>
                  <pattern id={`${patron}-${r.temporada}`} width="5" height="5" patternUnits="userSpaceOnUse">
                    <path d="M-1 1L1-1M0 5L5 0M4 6L6 4" stroke="currentColor" strokeWidth="1" className="text-muted-foreground" />
                  </pattern>
                </defs>
                <rect width="240" height="18" className="fill-muted" />
                <rect width={segmentos.conPuesto} height="18" className="fill-primary" />
                <rect x={segmentos.conPuesto} width={segmentos.sinPuesto} height="18" fill={`url(#${patron}-${r.temporada})`} />
              </svg>
              <p className="text-xs text-muted-foreground">
                <strong className="text-foreground">{r.pruebas} {r.pruebas === 1 ? 'prueba' : 'pruebas'}</strong>, {r.conPuesto} con puesto, {r.sinPuesto} sin puesto
              </p>
            </li>
          );
        })}
      </ol>
      {detalle.temporadasRecortadas ? (
        <Nota>Se muestran las 24 temporadas importadas más recientes. El resumen incluye también las anteriores.</Nota>
      ) : null}
    </div>
  );
}

/** Vista equivalente de valores siempre visible: no depende del color ni de un tooltip. */
export function EstadisticasDeportistaVista({ detalle }: { detalle: EstadisticasDeportista }) {
  const r = detalle.resumen;
  if (r.pruebas === 0) {
    return (
      <p role="status" className="medida text-sm text-muted-foreground">
        No hay clasificaciones individuales importadas. Puede que falte importar esa información;
        no equivale a cero participaciones ni a derrotas.
      </p>
    );
  }
  const maximo = Math.max(1, ...detalle.porCategoria.map((c) => c.pruebas));
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Cifras r={r} />
      <div className="flex flex-col gap-2">
        <Nota>
          Historia parcial: sólo clasificaciones individuales importadas, no una carrera completa.
          Las estadísticas no siguen la temporada ni la modalidad del ranking, ni la página del historial.
          Los equipos quedan fuera.
        </Nota>
        <Nota>
          Fechas de competición publicadas: {r.desde && r.hasta
            ? `${fechaLegible(r.desde)} a ${fechaLegible(r.hasta)}`
            : 'no publicadas'}.
          {' '}{r.sinFecha} {r.sinFecha === 1 ? 'prueba' : 'pruebas'} sin fecha verificable.
        </Nota>
        {r.conflictos > 0 ? (
          <p className="medida text-sm">
            {r.conflictos} {r.conflictos === 1 ? 'prueba con resultados en conflicto. Cuenta' : 'pruebas con resultados en conflicto. Cuentan'} en el conjunto, pero no en los
            puestos numéricos, podios ni primeros puestos.
          </p>
        ) : null}
      </div>
      <Cronologia detalle={detalle} />
      <div className="min-w-0">
        <p className="mb-3 font-medium">Tipo de torneo y categoría publicada</p>
        <ul className="divide-y border-y bg-card" aria-label="Estadísticas por tipo, categoría, arma y género">
          {detalle.porCategoria.map((c) => {
            const categoria = CATEGORY_LABEL[c.categoria.codigo as keyof typeof CATEGORY_LABEL] ?? c.categoria.codigo;
            return (
              <li key={JSON.stringify([c.tipo, c.categoria, c.arma, c.genero])} className="min-w-0 px-4 py-4 sm:px-6">
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                  <p className="min-w-0 font-medium break-words">{etiquetaTipoEstadistico(c.tipo)}</p>
                  <p className="text-xs text-muted-foreground">{c.pruebas} de {r.pruebas} pruebas importadas</p>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                  <div><dt className="text-xs text-muted-foreground">Categoría</dt><dd className="text-sm break-words">{categoria}{c.categoria.raw ? ` («${c.categoria.raw}»)` : ''}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Arma</dt><dd className="text-sm">{WEAPON_LABEL[c.arma]}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Género</dt><dd className="text-sm">{GENDER_LABEL[c.genero]}</dd></div>
                </dl>
                <div aria-hidden="true" className="my-3 h-1.5 bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${(c.pruebas / maximo) * 100}%` }} />
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
                  <div><dt className="text-xs text-muted-foreground">Con puesto</dt><dd className="cifra text-3xl">{c.conPuesto}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Mejor puesto</dt><dd>{c.mejorPuesto === null ? <span className="text-sm text-muted-foreground">No publicado</span> : <span className="cifra text-3xl">{c.mejorPuesto}</span>}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Podios</dt><dd><span className="cifra text-3xl">{c.podios}</span><span className="ml-1 text-xs text-muted-foreground">de {c.conPuesto}</span></dd></div>
                  <div><dt className="text-xs text-muted-foreground">Primeros puestos</dt><dd><span className="cifra text-3xl">{c.victorias}</span><span className="ml-1 text-xs text-muted-foreground">de {c.conPuesto}</span></dd></div>
                  <div><dt className="text-xs text-muted-foreground">Sin puesto numérico</dt><dd className="cifra text-3xl">{c.sinPuesto}</dd></div>
                </dl>
              </li>
            );
          })}
        </ul>
        {detalle.categoriasRecortadas ? <Nota>Desglose limitado a 120 grupos. Los totales incluyen todos los grupos importados.</Nota> : null}
      </div>
      <Nota>
        Una inscripción sin final no cuenta como participación. Sólo se unen resultados idénticos
        de la misma prueba o de pruebas con equivalencia explícita. Un resultado discrepante no se
        convierte en puesto cero. El tipo nunca se deduce del título ni se convierte en una puntuación
        oficial: «Tipo no publicado» significa que el historial importado no conserva evidencia
        verificable del tipo. Los tipos históricos de Skermo afinados por nombre quedan en ese grupo.
      </Nota>
    </div>
  );
}
