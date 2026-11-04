import { redirect } from 'next/navigation';
import { SeleccionOlimpica } from '@/components/olimpica/seleccion';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { getSessionProfile } from '@/lib/auth/session';
import { getAnotacionesOlimpicas, getClasificacionOlimpica } from '@/lib/queries/olimpica';
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
 * Se mira como una clasificación más: filtros de arma y género arriba y
 * debajo la proyección de esa prueba con la forma del ranking —en verde
 * quien tiene la plaza, en amarillo el primero que se queda fuera de cada
 * camino, en gris quien aparece en el ranking sin contar—. Las seis
 * proyecciones se cargan de una vez: cambiar de arma o de género no pide
 * nada al servidor, sólo `?prueba=` guarda la elección en la URL (y es el
 * enlace que pone el botón del ranking).
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<{ prueba?: string }>;
}) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');
  const { prueba: clave } = await searchParams;

  const { season, resultados, pendientes } = await getClasificacionOlimpica();
  const anotaciones = await Promise.all(
    resultados.map((r) => getAnotacionesOlimpicas(r.arma, r.genero)),
  );
  const excluidos: Record<string, { noc: string; motivo: never }[]> = {};
  resultados.forEach((r, i) => {
    const e = anotaciones[i]?.excluidos;
    if (e?.length) excluidos[`${r.arma}-${r.genero}`] = e as never;
  });

  // La prueba pedida manda; sin `?prueba=` se abre la primera con datos.
  const valida = resultados.some((r) => `${r.arma}-${r.genero}` === clave);
  const pruebaInicial = valida ? clave! : `${resultados[0]?.arma ?? 'ESPADA'}-${resultados[0]?.genero ?? 'F'}`;

  return (
    <main className="ancho-app mx-auto flex w-full max-w-3xl flex-col gap-3 px-3 pb-[calc(56px+env(safe-area-inset-bottom)+16px)] pt-3 sm:px-4">
      <div className="min-w-0">
        <h2 className="font-display text-xl leading-6">Los Ángeles 2028</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Quién entraría hoy, por equipos y por individual. Es una proyección
          {season ? ` con el ranking de la temporada ${season}` : ''}: el
          ranking de clasificación arranca de cero en su ciclo y se irá
          formando con las pruebas del año olímpico.
        </p>
      </div>

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
    </main>
  );
}
