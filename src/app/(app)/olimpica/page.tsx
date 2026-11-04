import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { SeleccionOlimpica } from '@/components/olimpica/seleccion';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { getSessionProfile } from '@/lib/auth/session';
import { getPanelOlimpico } from '@/lib/queries/olimpica';
import { rotuloPrueba } from '@/lib/sport/rotulos';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Clasificación olímpica' };

/**
 * Clasificación olímpica · Los Ángeles 2028.
 *
 * Pantalla propia, fuera del ranking internacional: son dos cosas distintas
 * y acabarán siéndolo más — el ranking de clasificación arranca de cero en
 * su ciclo y se forma con las pruebas del año olímpico.
 *
 * La página pinta su cascarón (título, intro, esqueleto de los filtros) en
 * el primer byte y el panel llega por stream: `getPanelOlimpico` suele
 * estar en la caché compartida —/ranking lo deja calculado en segundo
 * plano—, pero aunque toque calcular no se queda la pantalla en blanco.
 * Dentro, los filtros de arma y género son cliente puro (`?prueba=`).
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<{ prueba?: string }>;
}) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');
  const { prueba: clave } = await searchParams;

  return (
    <main className="ancho-app mx-auto flex w-full max-w-3xl flex-col gap-3 px-3 pb-[calc(56px+env(safe-area-inset-bottom)+16px)] pt-3 sm:px-4">
      <div className="min-w-0">
        <h2 className="font-display text-xl leading-6">Los Ángeles 2028</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Quién entraría hoy, por equipos y por individual. Es una proyección:
          el ranking de clasificación arranca de cero en su ciclo y se irá
          formando con las pruebas del año olímpico.
        </p>
      </div>

      <Suspense fallback={<EsperandoPanel />}>
        <PanelServidor clave={clave} />
      </Suspense>
    </main>
  );
}

/** La parte que espera los datos: filtros, proyección y pendientes. */
async function PanelServidor({ clave }: { clave?: string }) {
  const { season, resultados, anotaciones, pendientes } = await getPanelOlimpico();
  const excluidos: Record<string, { noc: string; motivo: never }[]> = {};
  for (const r of resultados) {
    const e = anotaciones[`${r.arma}-${r.genero}`]?.excluidos;
    if (e?.length) excluidos[`${r.arma}-${r.genero}`] = e as never;
  }

  const valida = resultados.some((r) => `${r.arma}-${r.genero}` === clave);
  const pruebaInicial = valida ? clave! : `${resultados[0]?.arma ?? 'ESPADA'}-${resultados[0]?.genero ?? 'F'}`;

  return (
    <>
      <p className="sr-only">
        {season ? `Proyección con el ranking de la temporada ${season}.` : null}
      </p>
      {resultados.length > 0 ? (
        <SeleccionOlimpica resultados={resultados} excluidos={excluidos} pruebaInicial={pruebaInicial} />
      ) : (
        <EstadoVacio
          titulo="Sin datos de clasificación olímpica"
          descripcion="Cuando la FIE publique los rankings de la temporada aparecerán aquí."
        />
      )}

      {pendientes.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Sin ranking completo todavía:{' '}
          {pendientes.map((p) => rotuloPrueba({ arma: p.arma, genero: p.genero })).join(', ')}.
        </p>
      ) : null}
    </>
  );
}

/**
 * Lo que se ve el instante que tarda el panel: dos filas de chips y una
 * tarjeta de filas apagadas, la forma exacta de lo que va a llegar — así el
 * salto al contenido real no reordena la pantalla.
 */
function EsperandoPanel() {
  return (
    <div aria-hidden className="flex min-w-0 flex-col gap-3">
      {['flex gap-2', 'flex max-w-xs gap-2'].map((fila, i) => (
        <div key={i} className={fila}>
          {Array.from({ length: i === 0 ? 3 : 2 }).map((_, j) => (
            <span key={j} className="h-9 flex-1 animate-pulse rounded-full bg-secondary" />
          ))}
        </div>
      ))}
      <div className="flex min-w-0 flex-col gap-1.5 rounded-xl border bg-card p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <span key={i} className="h-9 animate-pulse rounded-md bg-secondary/70" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
    </div>
  );
}
