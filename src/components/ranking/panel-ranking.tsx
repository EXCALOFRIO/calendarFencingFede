'use client';

import * as React from 'react';
import { Escudo } from '@/components/escudo';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type {
  FormatoClasificacion,
  GrupoClasificacion,
  RankingGroupKey,
} from '@/lib/queries/ranking';
import type { TablaFieCompleta } from '@/lib/ranking/tabla-fie-completa';
import { MisTiradores, type TiradorPropio } from './mis-tiradores';
import { TablaRankingFie } from './tabla-fie';

/**
 * ===========================================================================
 * LA PANTALLA DE RANKING: UN SOLO CONMUTADOR
 * ===========================================================================
 *
 * Un solo conmutador Nacional / Internacional («Mundial» es el Campeonato del
 * Mundo, no el ranking de la FIE) manda sobre la tabla. Encima, tus tiradores
 * en una tarjeta compacta con su puesto en los dos rankings; tocar uno de
 * los dos puestos cambia también el conmutador. El estado vive aquí.
 */
export type FichaPanel = TiradorPropio;

export function PanelRanking({
  fichas,
  rfee,
  fie,
  federacionInicial = 'FIE',
}: {
  /** Un enlace a una lista nacional concreta abre en Nacional. */
  federacionInicial?: 'RFEE' | 'FIE';
  fichas: FichaPanel[];
  /** La tabla oficial, ya montada por la página. */
  rfee: React.ReactNode;
  /** Los datos del ranking internacional, o `null` si no hay ninguno. */
  fie: {
    grupos: GrupoClasificacion[];
    /** El grupo con el que abre, resuelto en el servidor. */
    inicial: { format: FormatoClasificacion } & RankingGroupKey;
    primeraTabla: TablaFieCompleta | null;
    mios: string[];
    cargar: (p: {
      format: FormatoClasificacion;
      weapon: RankingGroupKey['weapon'];
      gender: RankingGroupKey['gender'];
      category: RankingGroupKey['category'];
    }) => Promise<TablaFieCompleta | null>;
  } | null;
}) {
  /**
   * ARRANCA EN LA FIE, por petición expresa: *«al entrar en ranking por
   * defecto se pone en nacional y quiero que sea por defecto en la
   * internacional, en la FIE»*. Si no hay ranking internacional cargado, se
   * queda en nacional sola: `cual` lo resuelve abajo.
   */
  const [federacion, setFederacion] = React.useState<'RFEE' | 'FIE'>(federacionInicial);

  const hayInternacional = fie !== null && fie.grupos.length > 0;
  const cual = hayInternacional ? federacion : 'RFEE';

  return (
    <div className="ranking flex min-w-0 flex-col gap-5">
      {/* Tus tiradores arriba, con su puesto nacional e internacional; tocar uno cambia la tabla. */}
      <MisTiradores tiradores={fichas} elegida={cual} onElegir={setFederacion} />
      {hayInternacional ? (
        <ToggleGroup
          type="single"
          variant="outline"
          value={cual}
          onValueChange={(v) => v && setFederacion(v as 'RFEE' | 'FIE')}
          aria-label="Qué ranking se enseña"
          spacing={1}
          className="w-full sm:w-auto"
        >
          <ToggleGroupItem value="RFEE" className="h-11 flex-1 gap-2 px-3 max-[359px]:px-2 sm:flex-none">
            <Escudo federacion="RFEE" decorativo className="max-[359px]:hidden" />
            Nacional
          </ToggleGroupItem>
          <ToggleGroupItem value="FIE" className="h-11 flex-1 gap-2 px-3 max-[359px]:px-2 sm:flex-none">
            <Escudo federacion="FIE" decorativo className="max-[359px]:hidden" />
            Internacional
          </ToggleGroupItem>
        </ToggleGroup>
      ) : null}

      {cual === 'RFEE' || !fie ? (
        rfee
      ) : (
        <TablaRankingFie
          grupos={fie.grupos}
          inicial={fie.inicial}
          primeraTabla={fie.primeraTabla}
          mios={fie.mios}
          cargar={fie.cargar}
        />
      )}
    </div>
  );
}
