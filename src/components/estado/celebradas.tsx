import type { PuntosDePrueba } from '@/app/(app)/estado/consultas';
import { FilaCompeticion } from '@/components/calendario/fila-competicion';
import { puntos as formatoPuntos } from '@/components/ranking/formato';
import { Pastilla, Puesto } from '@/components/sistema/pastilla';
import type { MyEntry } from '@/lib/queries/my-status';
import { rotuloPrueba } from '@/lib/sport/rotulos';
import { titularTorneo } from '@/lib/utils';
import { Seccion } from './piezas';

/**
 * «Ya celebradas»: qué puesto hiciste y qué te dejó en el ranking. La fila es
 * la misma que la de las competiciones por venir, con el puesto en el sitio
 * del estado. Sin resultado publicado se dice; un cero se leería «último».
 */
export function Celebradas({
  entradas,
  puntosPorPrueba,
  conNombre,
}: {
  entradas: MyEntry[];
  /** `athleteId|eventCompetitionId` -> puntos de ranking de esa prueba. */
  puntosPorPrueba: Record<string, PuntosDePrueba>;
  conNombre: boolean;
}) {
  if (entradas.length === 0) return null;

  return (
    <Seccion titulo="Ya celebradas" contexto={`${entradas.length}`}>
      <ul className="flex flex-col divide-y divide-border">
        {entradas.map((e) => (
          <Fila
            key={e.entryId}
            entrada={e}
            puntos={puntosPorPrueba[`${e.athleteId}|${e.eventCompetitionId}`] ?? null}
            conNombre={conNombre}
          />
        ))}
      </ul>
    </Seccion>
  );
}

function Fila({
  entrada: e,
  puntos,
  conNombre,
}: {
  entrada: MyEntry;
  puntos: PuntosDePrueba | null;
  conNombre: boolean;
}) {
  return (
    <li>
      <FilaCompeticion
        className="px-0"
        desde={e.startDate}
        hasta={e.endDate}
        titulo={titularTorneo(e.eventName)}
        ciudad={e.city}
        pais={e.country}
        apagado
        estado={
          e.resultPosition !== null ? (
            <Puesto puesto={e.resultPosition} />
          ) : (
            <Pastilla className="text-muted-foreground">Sin resultado</Pastilla>
          )
        }
        detalle={
          <>
            <Pastilla>
              {rotuloPrueba(
                { arma: e.weapon, genero: e.gender, categoria: e.category, formato: e.format },
                { categoria: 'siempre' },
              )}
            </Pastilla>
            {conNombre ? <span className="min-w-0 text-xs text-muted-foreground">{e.athleteName}</span> : null}
          </>
        }
      >
        {puntos ? (
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{formatoPuntos(puntos.finalPoints)}</span> puntos
            <span className="text-muted-foreground">
              {puntos.cuenta ? ' · cuentan para tu total' : ' · no cuentan: tienes mejores resultados'}
            </span>
          </p>
        ) : e.resultPoints ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{e.resultPoints}</span> puntos
            oficiales
          </p>
        ) : null}
      </FilaCompeticion>
    </li>
  );
}
