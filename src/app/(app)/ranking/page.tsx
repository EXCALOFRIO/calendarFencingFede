import { IdCard, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SinRanking } from '@/components/ranking/sin-ranking';
import { TablaRanking } from '@/components/ranking/tabla-ranking';
import { TablaRankingOficial } from '@/components/ranking/tabla-oficial';
import { getManagedAthletes, getSessionProfile } from '@/lib/auth/session';
import {
  type RankingRowView,
  getRankingOficialScreenData,
  getRankingScreenData,
  groupKey,
  listGroupsForAthlete,
} from '@/lib/queries/ranking';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ranking' };

/**
 * Ranking de la temporada.
 *
 * -------------------------------------------------------------------------
 * DOS NÚMEROS, Y SE DICE CUÁL ES CUÁL
 * -------------------------------------------------------------------------
 * Manda la clasificación OFICIAL de la RFEE: 1.235 filas y 808 tiradores
 * leídos de Skermo. Es la que la gente reconoce y la que decide convocatorias,
 * y hasta ahora no se enseñaba en ninguna parte: esta pantalla mostraba el
 * cálculo interno, que tenía tres filas de datos de demostración.
 *
 * El cálculo interno no se tira, porque es lo único auditable: entra dentro del
 * panel de cada tirador con ficha, debajo del puesto oficial y con su nombre
 * puesto. El razonamiento de por qué no son dos pestañas está en
 * `tabla-oficial.tsx`.
 *
 * Si algún día no hubiera clasificación oficial ingerida —una base recién
 * creada—, se cae a la tabla del cálculo interno, que es mejor que una pantalla
 * vacía. Nunca se enseñan las dos a la vez.
 *
 * Ninguna de las dos recalcula nada al vuelo: se enseña lo que hay, con su
 * fecha. Si falta, se dice.
 */
export default async function Pagina() {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const [oficial, interno, atletas] = await Promise.all([
    getRankingOficialScreenData(),
    getRankingScreenData(),
    getManagedAthletes(perfil.profileId),
  ]);

  const mios = atletas.map((a) => a.id);
  const esAdmin = perfil.role === 'admin';
  const esPersonal = perfil.role === 'athlete' || perfil.role === 'guardian';
  const sinFicha = atletas.length === 0;

  if (oficial.groups.length > 0) {
    /**
     * Se abre por el grupo del tirador que mira, no por el primero de la lista.
     * Para un padre que entra a ver cómo va su hija, «florete femenino M17» es
     * la respuesta; «espada masculino absoluto» es ruido.
     */
    const suyos = Object.values(oficial.tables)
      .filter((t) => t.rows.some((r) => r.athleteId && mios.includes(r.athleteId)))
      .map((t) => groupKey(t.group));
    const grupoInicial = suyos[0] ?? groupKey(oficial.groups[0]);

    /** Fila del cálculo interno por `grupo|athleteId`, para el panel. */
    const internos: Record<string, RankingRowView> = {};
    for (const [clave, tabla] of Object.entries(interno.tables)) {
      for (const fila of tabla.rows) internos[`${clave}|${fila.athleteId}`] = fila;
    }

    return (
      <>
        <Cabecera
          contexto={`Clasificación oficial de la RFEE, temporada ${oficial.seasonLabel}`}
        />

        {/*
          Una línea, no un recuadro: la tabla es a lo que se viene y el aviso no
          puede dejarla por debajo del pliegue. Y el aviso va unido a la acción
          que lo arregla, que es lo que le faltaba: decir «1.233 sin emparejar»
          sin decir qué hacer no cambia ninguna decisión.
        */}
        {oficial.sinFicha > 0 ? (
          <p className="mb-4 flex items-start gap-2 text-xs text-warn">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            <span className="medida">
              <span className="cifra text-sm">{oficial.sinFicha}</span> de las{' '}
              <span className="cifra text-sm">{oficial.total}</span> filas del
              ranking oficial no tienen ficha en la aplicación, así que de esos
              tiradores no se siguen plazos ni inscripciones.
              {sinFicha && esPersonal ? (
                <>
                  {' '}
                  ¿Estás tú en la lista?{' '}
                  <Link href="/alta" className="underline underline-offset-2">
                    Vincula tu ficha
                  </Link>{' '}
                  y tu puesto aparecerá en «Mi estado».
                </>
              ) : null}
              {esAdmin ? (
                <>
                  {' '}
                  <Link
                    href="/admin/emparejar"
                    className="underline underline-offset-2"
                  >
                    Emparejar a mano
                  </Link>
                  , o que cada uno se vincule desde{' '}
                  <Link href="/alta" className="underline underline-offset-2">
                    /alta
                  </Link>
                  .
                </>
              ) : null}
            </span>
          </p>
        ) : null}

        {interno.status.resultsUnmatched > 0 ? (
          <p className="mb-4 flex items-start gap-2 text-xs text-muted-foreground">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            <span className="medida">
              El cálculo propio está incompleto:{' '}
              <span className="cifra text-sm">{interno.status.resultsUnmatched}</span>{' '}
              resultados leídos siguen sin asignar a un tirador. No afecta al
              puesto oficial, que lo publica la federación.
            </span>
          </p>
        ) : null}

        <TablaRankingOficial
          grupos={oficial.groups}
          tablas={oficial.tables}
          cortes={oficial.cutoffs}
          desgloses={interno.breakdowns}
          internos={internos}
          mios={mios}
          grupoInicial={grupoInicial}
        />

        {sinFicha && esPersonal ? (
          <p className="mt-6 flex items-start gap-2 text-sm text-muted-foreground">
            <IdCard className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="medida">
              Tu cuenta todavía no tiene ficha, así que la aplicación no sabe
              cuál de estas filas eres tú.{' '}
              <Link href="/alta" className="underline underline-offset-2">
                Búscate y confírmalo con tu licencia
              </Link>
              .
            </span>
          </p>
        ) : null}
      </>
    );
  }

  const contexto = interno.status.season
    ? `Temporada ${interno.status.season.label}`
    : 'Sin temporada en curso';

  if (interno.groups.length === 0) {
    return (
      <>
        <Cabecera contexto={contexto} />
        <SinRanking estado={interno.status} esAdmin={esAdmin} />
      </>
    );
  }

  const suyos = mios.length > 0 ? await listGroupsForAthlete(mios[0]) : [];
  const grupoInicial =
    suyos.map(groupKey).find((k) => interno.tables[k]) ??
    groupKey(interno.groups[0]);

  return (
    <>
      <Cabecera contexto={`${contexto}, cálculo de la aplicación`} />

      {interno.status.resultsUnmatched > 0 ? (
        <p className="mb-4 flex items-start gap-2 text-xs text-warn">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span className="medida">
            Tabla incompleta:{' '}
            <span className="cifra text-sm">{interno.status.resultsUnmatched}</span>{' '}
            resultados sin asignar a un tirador.
            {esAdmin ? (
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
        grupos={interno.groups}
        tablas={interno.tables}
        cortes={interno.cutoffs}
        desgloses={interno.breakdowns}
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
