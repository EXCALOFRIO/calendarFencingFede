import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SinRanking } from '@/components/ranking/sin-ranking';
import { TablaRanking } from '@/components/ranking/tabla-ranking';
import { getManagedAthletes, getSessionProfile } from '@/lib/auth/session';
import { getRankingScreenData, groupKey, listGroupsForAthlete } from '@/lib/queries/ranking';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ranking' };

/**
 * Ranking de la temporada.
 *
 * Nunca recalcula: enseña el último cálculo guardado, con su fecha y con la
 * normativa que se le aplicó. Si el cálculo está viejo o falta, se dice.
 *
 * Todo el volumen se carga de una vez en el servidor porque es pequeño
 * (decenas de tiradores, cientos de filas de puntos) y porque así cambiar de
 * arma o abrir un desglose no depende de la cobertura del móvil.
 */
export default async function Pagina() {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const [datos, atletas] = await Promise.all([
    getRankingScreenData(),
    getManagedAthletes(perfil.profileId),
  ]);

  const contexto = datos.status.season
    ? `Temporada ${datos.status.season.label}`
    : 'Sin temporada en curso';

  if (datos.groups.length === 0) {
    return (
      <>
        <Cabecera contexto={contexto} />
        <SinRanking estado={datos.status} esAdmin={perfil.role === 'admin'} />
      </>
    );
  }

  /**
   * Se abre por el ranking del tirador que mira, no por el primero de la
   * lista. Para un padre que entra a ver cómo va su hija, "Florete femenino
   * M17" es la respuesta; "Espada masculino absoluto" es ruido.
   */
  const mios = atletas.map((a) => a.id);
  const suyos = mios.length > 0 ? await listGroupsForAthlete(mios[0]) : [];
  const grupoInicial =
    suyos.map(groupKey).find((k) => datos.tables[k]) ?? groupKey(datos.groups[0]);

  return (
    <>
      <Cabecera contexto={contexto} />

      {/*
        Una línea, no un recuadro.

        El aviso ocupaba una pantalla entera de móvil con tres frases sobre
        homónimos y acentos, y dejaba la tabla —que es a lo que se viene—
        por debajo del pliegue. Se queda lo que cambia una decisión (cuántos
        faltan y que la tabla está incompleta) y el resto se explica en la
        pantalla que sirve para arreglarlo.
      */}
      {datos.status.resultsUnmatched > 0 ? (
        <p className="mb-4 flex items-start gap-2 text-xs text-warn">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span className="medida">
            Tabla incompleta:{' '}
            <span className="cifra text-sm">
              {datos.status.resultsUnmatched}
            </span>{' '}
            resultados sin asignar a un tirador.
            {perfil.role === 'admin' ? (
              <>
                {' '}
                <Link
                  href="/admin/emparejar"
                  className="underline underline-offset-2"
                >
                  Emparejarlos
                </Link>
                .
              </>
            ) : null}
          </span>
        </p>
      ) : null}

      <TablaRanking
        grupos={datos.groups}
        tablas={datos.tables}
        cortes={datos.cutoffs}
        desgloses={datos.breakdowns}
        mios={mios}
        grupoInicial={grupoInicial}
      />
    </>
  );
}

function Cabecera({ contexto }: { contexto: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h1 className="text-2xl sm:text-3xl">Ranking</h1>
      <p className="text-sm text-muted-foreground">{contexto}</p>
    </div>
  );
}
