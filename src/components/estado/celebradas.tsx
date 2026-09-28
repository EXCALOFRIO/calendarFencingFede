import { MarcaArma } from '@/components/calendario/iconos-arma';
import type { PuntosDePrueba } from '@/app/(app)/estado/consultas';
import type { MyEntry } from '@/lib/queries/my-status';
import {
  CATEGORY_LABEL,
  GENDER_LABEL,
  WEAPON_LABEL,
  cn,
  formatDateRangeEs,
  titular,
} from '@/lib/utils';
import { puntos as formatoPuntos } from '@/components/ranking/formato';
import { Rotulos, Seccion } from './piezas';

/**
 * «Ya celebradas»: qué puesto hiciste y qué te dejó en el ranking.
 *
 * Cierra el círculo de la pantalla: arriba se dice cuánto falta, aquí qué pasó.
 * **Del trámite no queda nada**: la fila ya no dice en qué paso estaba la
 * inscripción ni quién la validó, porque una competición celebrada no tiene
 * nada que validar y esa era la parte que sobraba.
 *
 * Y cuando la fuente no ha publicado el resultado se dice; no se pone un cero,
 * que se leería como «último».
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
      <ul className="flex flex-col divide-y">
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
  const categoria =
    CATEGORY_LABEL[e.category as keyof typeof CATEGORY_LABEL] ?? e.category;

  return (
    <li className="flex gap-3 py-4 sm:gap-4">
      <div className="w-16 shrink-0 sm:w-20">
        {e.resultPosition !== null ? (
          <>
            <span
              className={cn(
                'cifra block',
                e.resultPosition >= 100 ? 'text-3xl' : 'text-4xl',
              )}
            >
              {e.resultPosition}
              <span className="text-lg">.º</span>
            </span>
            <span className="mt-1 block text-xs leading-tight text-muted-foreground">
              puesto
            </span>
          </>
        ) : (
          <span className="block text-xs leading-tight text-muted-foreground">
            Sin resultado
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="text-base">{titular(e.eventName)}</h3>

        <Rotulos
          disposicion="linea"
          datos={[
            ['Cuándo', formatDateRangeEs(e.startDate, e.endDate)],
            [
              'Prueba',
              <span key="p" className="inline-flex items-center gap-1.5">
                <MarcaArma armas={[e.weapon]} px={22} />
                {`${WEAPON_LABEL[e.weapon]} ${GENDER_LABEL[e.gender].toLowerCase()}`}
              </span>,
            ],
            ['Categoría', categoria],
            ...(conNombre
              ? ([['Tirador', e.athleteName]] as [string, React.ReactNode][])
              : []),
          ]}
        />

        {e.resultPosition === null ? (
          <p className="text-sm text-muted-foreground">
            La fuente todavía no ha publicado el resultado de esta prueba.
          </p>
        ) : null}

        {puntos ? (
          <p className="text-sm">
            <span className="cifra text-base">
              {formatoPuntos(puntos.finalPoints)}
            </span>{' '}
            puntos para el ranking
            {puntos.cuenta
              ? ', y entran en tu total de la temporada.'
              : ', pero no entran en tu total: tienes mejores resultados.'}
          </p>
        ) : e.resultPoints ? (
          <p className="text-sm text-muted-foreground">
            Puntos oficiales de la fuente:{' '}
            <span className="cifra text-base text-foreground">
              {e.resultPoints}
            </span>
          </p>
        ) : null}
      </div>
    </li>
  );
}
