'use client';

import * as React from 'react';
import { Escudo } from '@/components/escudo';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { RankingGroupKey, TablaFie } from '@/lib/queries/ranking';
import { TablaRankingFie } from './tabla-fie';

/**
 * RFEE o FIE: las dos clasificaciones de la pantalla de ranking.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTÁ AQUÍ Y NO DENTRO DE LA TABLA
 * ---------------------------------------------------------------------------
 * Petición literal: *«en lo del ranking no puedo cambiar entre FIE y RFEE»*.
 * El conmutador con los dos escudos ya existía, pero dentro del panel de un
 * tirador concreto (`ficha-ranking.tsx`), y solo se enciende cuando ese
 * tirador tiene ficha en la FIE. Lo que faltaba era poder cambiar la TABLA.
 *
 * Envuelve las dos tablas en lugar de vivir dentro de una porque son dos
 * componentes distintos con columnas distintas —el oficial lleva club, año de
 * nacimiento, corte de convocatoria y el panel del cálculo; el mundial lleva
 * puesto mundial y pruebas—, y meter los dos modos en un componente de
 * setecientas líneas es como se acaba con una pantalla que hace dos cosas mal.
 * Lo que sí comparten, los selectores y el buscador, está compartido de verdad
 * (`selectores-grupo.tsx`).
 *
 * El marcado sigue la convención de la casa: contorno rojo, superficie teñida
 * y rótulo en rojo (`variant="outline"` de `ToggleGroup`). El relleno sólido
 * de acento está reservado a la acción principal de una pantalla, y elegir
 * clasificación no lo es.
 *
 * El escudo va decorativo porque al lado se lee el nombre: si no, un lector de
 * pantalla diría «Real Federación Española de Esgrima, RFEE».
 */
export function ConmutadorFederacion({
  rfee,
  fie,
}: {
  /** La tabla oficial, ya montada por la página. */
  rfee: React.ReactNode;
  /**
   * Los datos del mundial. `null` cuando no hay ninguno: entonces no hay
   * conmutador que enseñar, porque un botón que lleva a una tabla vacía es
   * peor que no tener botón.
   */
  fie: {
    grupos: (RankingGroupKey & { tiradores: number })[];
    tablas: Record<string, TablaFie>;
    grupoInicial: string;
    mios: string[];
  } | null;
}) {
  const [cual, setCual] = React.useState<'RFEE' | 'FIE'>('RFEE');

  if (!fie || fie.grupos.length === 0) return <>{rfee}</>;

  return (
    <div className="flex flex-col gap-5">
      <ToggleGroup
        type="single"
        variant="outline"
        value={cual}
        onValueChange={(v) => v && setCual(v as 'RFEE' | 'FIE')}
        aria-label="Qué clasificación se enseña"
        spacing={1}
        className="w-full sm:w-auto"
      >
        <ToggleGroupItem value="RFEE" className="h-11 flex-1 gap-2 px-3 sm:flex-none">
          <Escudo federacion="RFEE" decorativo />
          Nacional
        </ToggleGroupItem>
        <ToggleGroupItem value="FIE" className="h-11 flex-1 gap-2 px-3 sm:flex-none">
          <Escudo federacion="FIE" decorativo />
          Mundial
        </ToggleGroupItem>
      </ToggleGroup>

      {cual === 'RFEE' ? (
        rfee
      ) : (
        <TablaRankingFie
          grupos={fie.grupos}
          tablas={fie.tablas}
          grupoInicial={fie.grupoInicial}
          mios={fie.mios}
        />
      )}
    </div>
  );
}
