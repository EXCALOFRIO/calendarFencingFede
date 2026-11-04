import { redirect } from 'next/navigation';
import { PruebaOlimpica } from '@/components/olimpica/prueba-olimpica';
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
 * su ciclo y se forma con las pruebas del año olímpico. Aquí va la
 * proyección de hoy de las seis pruebas (tres armas × dos géneros), por
 * equipos e individual, cada una plegada para leer sólo la que interesa.
 * El ranking oficial queda limpio: desde él llega un botón y nada más.
 */
export default async function Pagina() {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const { season, resultados, pendientes } = await getClasificacionOlimpica();
  // Los excluidos con motivo («RUS · participación sin decidir») los lleva la
  // anotación de cada prueba; el resultado sólo trae los códigos.
  const anotaciones = await Promise.all(
    resultados.map((r) => getAnotacionesOlimpicas(r.arma, r.genero)),
  );

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

        {resultados.map((r, i) => (
          // El ancla enlaza desde el botón del ranking (`/olimpica#ESPADA-M`);
          // 64 px de margen para que la cabecera pegajosa no la tape.
          <div key={`${r.arma}-${r.genero}`} id={`${r.arma}-${r.genero}`} className="scroll-mt-16">
            <PruebaOlimpica resultado={r} excluidos={anotaciones[i]?.excluidos} />
          </div>
        ))}

        {pendientes.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Sin ranking completo todavía:{' '}
            {pendientes.map((p) => rotuloPrueba({ arma: p.arma, genero: p.genero })).join(', ')}.
          </p>
        ) : null}

        {resultados.length === 0 && pendientes.length === 0 ? (
          <EstadoVacio
            titulo="Sin datos de clasificación olímpica"
            descripcion="Cuando la FIE publique los rankings de la temporada aparecerán aquí."
          />
        ) : null}
      </main>
  );
}
