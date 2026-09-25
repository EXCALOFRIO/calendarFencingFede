'use client';

import { Check, ExternalLink, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { BreakdownEntry, RankingTableView } from '@/lib/queries/ranking';
import type { CutoffStatus } from '@/lib/ranking/compute';
import { CIRCUIT_LABEL, cn, formatDateEs } from '@/lib/utils';
import { coeficiente, puntos } from './formato';

/**
 * El cálculo, abierto.
 *
 * Esta es la razón de ser de la pantalla: un ranking que no se puede auditar
 * genera más discusiones que la hoja de cálculo a la que sustituye. Aquí se
 * ve prueba por prueba de dónde sale cada punto, y —más importante— por qué
 * una prueba NO cuenta, que es la pregunta que trae aquí a casi todo el mundo.
 *
 * Las pruebas que no cuentan no se esconden: se enseñan apagadas y con su
 * motivo. Esconderlas convertiría la duda en sospecha.
 */
export function Desglose({
  puesto,
  total,
  pruebas,
  corte,
  regla,
  esTuyo,
}: {
  puesto: number;
  total: number;
  pruebas: BreakdownEntry[];
  corte: CutoffStatus | null;
  regla: RankingTableView['rule'];
  esTuyo: boolean;
}) {
  const cuentan = pruebas.filter((p) => p.counted);
  const descartadas = pruebas.filter((p) => !p.counted);
  const suma = cuentan.reduce((acc, p) => acc + p.finalPoints, 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Cabecera: la cifra manda, la palabra la acompaña. */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <Cifra valor={`${puesto}.º`} palabra="en la clasificación" grande />
        <Cifra valor={puntos(total)} palabra="puntos" grande />
        <Cifra
          valor={String(cuentan.length)}
          palabra={cuentan.length === 1 ? 'prueba cuenta' : 'pruebas cuentan'}
        />
      </div>

      {corte ? (
        <p
          className={cn(
            'medida rounded-lg border px-3 py-2.5 text-sm',
            corte.inside ? 'border-ok/40 text-ok' : 'text-muted-foreground',
          )}
        >
          {corte.explanation}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg">Qué se le ha contado</h3>
          {regla ? (
            <p className="text-xs text-muted-foreground">
              Cuentan las {regla.countingEvents} mejores pruebas de la temporada
            </p>
          ) : null}
        </div>

        {pruebas.length === 0 ? (
          <p className="medida text-sm text-muted-foreground">
            {esTuyo ? 'Todavía no tienes' : 'Todavía no hay'} resultados cargados en
            esta categoría para la temporada. En cuanto se lea un resultado de la
            fuente oficial aparecerá aquí con su puntuación.
          </p>
        ) : (
          <ul className="flex flex-col">
            {[...cuentan, ...descartadas].map((p) => (
              <Prueba key={p.eventCompetitionId} prueba={p} />
            ))}
          </ul>
        )}

        {cuentan.length > 0 ? (
          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="text-sm text-muted-foreground">
              Suma de las {cuentan.length} que cuentan
            </span>
            <span className="cifra text-xl">{puntos(suma)}</span>
          </div>
        ) : null}
      </div>

      {regla?.sourceDocument || regla?.sourceUrl ? (
        <>
          <Separator />
          <p className="medida text-xs text-muted-foreground">
            Normativa aplicada:{' '}
            {regla.sourceUrl ? (
              <a
                href={regla.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary-text underline underline-offset-4"
              >
                {regla.sourceDocument ?? 'documento oficial'}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : (
              (regla.sourceDocument ?? 'sin documento asociado')
            )}
            .
          </p>
        </>
      ) : null}
    </div>
  );
}

function Cifra({
  valor,
  palabra,
  grande,
}: {
  valor: string;
  palabra: string;
  grande?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className={cn('cifra', grande ? 'text-4xl' : 'text-2xl')}>{valor}</span>
      <span className="max-w-24 text-xs leading-tight text-muted-foreground">
        {palabra}
      </span>
    </div>
  );
}

/**
 * Una prueba del desglose.
 *
 * Se apila a propósito en vez de ir en una tabla: dentro de un panel estrecho
 * una tabla de seis columnas obliga a desplazarse en horizontal, y el dato
 * importante (los puntos finales) acabaría fuera de la pantalla.
 */
function Prueba({ prueba }: { prueba: BreakdownEntry }) {
  const circuito = CIRCUIT_LABEL[prueba.circuit] ?? prueba.circuit;

  return (
    <li
      className={cn(
        'flex flex-col gap-1 border-b py-3 last:border-b-0',
        !prueba.counted && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{prueba.eventName}</p>
          <p className="text-xs text-muted-foreground">
            {prueba.eventDate ? formatDateEs(prueba.eventDate) : 'sin fecha'} ·{' '}
            {circuito}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="cifra text-xl">{puntos(prueba.finalPoints)}</span>
          {prueba.counted ? (
            <Check className="size-4 text-ok" aria-label="Cuenta" />
          ) : (
            <Minus className="size-4 text-muted-foreground" aria-label="No cuenta" />
          )}
        </div>
      </div>

      {/* La cuenta, escrita tal cual: puesto, base, coeficiente y resultado. */}
      <p className="text-xs text-muted-foreground">
        {prueba.position}.º puesto · {puntos(prueba.basePoints)} de base ×{' '}
        {coeficiente(prueba.coefficient)} de coeficiente
      </p>

      {!prueba.counted ? (
        <Badge variant="outline" className="mt-0.5 whitespace-normal text-left">
          {prueba.explanation ?? 'No entra en las mejores de la temporada'}
        </Badge>
      ) : null}
    </li>
  );
}
