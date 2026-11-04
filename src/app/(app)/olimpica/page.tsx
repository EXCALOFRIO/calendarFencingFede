import { redirect } from 'next/navigation';
import { PruebaOlimpica } from '@/components/olimpica/prueba-olimpica';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { SelectorSegmentado } from '@/components/sistema/selector-segmentado';
import { getSessionProfile } from '@/lib/auth/session';
import { getAnotacionesOlimpicas, getClasificacionOlimpica } from '@/lib/queries/olimpica';
import { capitalizar } from '@/lib/utils';
import { rotuloPrueba } from '@/lib/sport/rotulos';
import type { ArmaOlimpica, GeneroOlimpico } from '@/lib/ranking/olimpica';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Clasificación olímpica' };

const ARMAS: readonly ArmaOlimpica[] = ['FLORETE', 'ESPADA', 'SABLE'];
const GENEROS: readonly { valor: GeneroOlimpico; etiqueta: string }[] = [
  { valor: 'F', etiqueta: 'Femenino' },
  { valor: 'M', etiqueta: 'Masculino' },
];

/**
 * Clasificación olímpica · Los Ángeles 2028.
 *
 * Pantalla propia, fuera del ranking internacional: son dos cosas distintas
 * y acabarán siéndolo más — el ranking de clasificación arranca de cero en
 * su ciclo y se forma con las pruebas del año olímpico.
 *
 * Se mira como una clasificación más: filtros de arma y género arriba —la
 * URL (`?prueba=ESPADA-M`) guarda la elección, y es el mismo enlace que
 * pone el botón del ranking— y debajo la proyección de esa prueba con la
 * forma del ranking: en verde quien tiene la plaza, en amarillo el primero
 * que se queda fuera de cada camino y en gris quien aparece en el ranking
 * sin contar (la participación de BLR y RUS está sin decidir).
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

  // La prueba pedida manda; sin `?prueba=` se abre la primera con datos.
  const pedida = resultados.find((r) => `${r.arma}-${r.genero}` === clave);
  const armaSel: ArmaOlimpica =
    (pedida?.arma ?? ARMAS.find((a) => clave === a || clave?.startsWith(`${a}-`))) ??
    resultados[0]?.arma ??
    'ESPADA';
  const generoSel: GeneroOlimpico =
    pedida?.genero ?? (clave?.endsWith('-M') ? 'M' : clave?.endsWith('-F') ? 'F' : undefined) ??
    resultados[0]?.genero ??
    'F';
  const sel = resultados.find((r) => r.arma === armaSel && r.genero === generoSel) ?? null;
  const indice = sel ? resultados.indexOf(sel) : -1;

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

      <div className="flex min-w-0 flex-col gap-2">
        <SelectorSegmentado
          etiqueta="Arma"
          valor={armaSel}
          opciones={ARMAS.map((a) => ({
            valor: a,
            etiqueta: capitalizar(a.toLowerCase()),
            href: `/olimpica?prueba=${a}-${generoSel}`,
          }))}
          replace
          scroll={false}
        />
        <SelectorSegmentado
          etiqueta="Género"
          valor={generoSel}
          opciones={GENEROS.map((g) => ({
            valor: g.valor,
            etiqueta: g.etiqueta,
            href: `/olimpica?prueba=${armaSel}-${g.valor}`,
          }))}
          replace
          scroll={false}
        />
      </div>

      {sel ? (
        <PruebaOlimpica resultado={sel} excluidos={indice >= 0 ? anotaciones[indice]?.excluidos : undefined} />
      ) : (
        <EstadoVacio
          titulo="Sin ranking completo todavía"
          descripcion={`La FIE aún no ha publicado el ranking de ${rotuloPrueba({ arma: armaSel, genero: generoSel })} de la temporada.`}
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
