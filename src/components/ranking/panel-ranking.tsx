'use client';

import * as React from 'react';
import { Escudo } from '@/components/escudo';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type {
  FormatoClasificacion,
  GrupoClasificacion,
  RankingGroupKey,
  TablaClasificacionFie,
} from '@/lib/queries/ranking';
import { FichaRanking, type LadoRanking } from './ficha-ranking';
import type { FotoTirador } from '@/components/tirador/cabecera';
import { TablaRankingFie } from './tabla-fie';

/**
 * ===========================================================================
 * LA PANTALLA DE RANKING: UN SOLO CONMUTADOR
 * ===========================================================================
 *
 * Había DOS conmutadores Nacional/Mundial en la misma pantalla: uno dentro de
 * la ficha del tirador, arriba a la derecha, y otro debajo para la tabla. Dos
 * controles que dicen lo mismo, en la misma pantalla, y con estados
 * independientes: se podía tener «Mundial» arriba y «Nacional» abajo. Petición
 * literal, con la captura delante: *«pon solo un selector de nacional o
 * mundial, el de arriba»*.
 *
 * Ahora el estado vive aquí y baja a los dos sitios: la ficha lo recibe como
 * prop controlada y la tabla se elige con él. El conmutador que se ve es el de
 * la ficha, y no hay otro.
 *
 * ---------------------------------------------------------------------------
 * Y SI NO HAY FICHA, EL CONMUTADOR TIENE QUE SEGUIR ESTANDO
 * ---------------------------------------------------------------------------
 * Un seleccionador no gestiona tiradores, así que no tiene ficha arriba y se
 * quedaría sin forma de llegar al mundial. En ese caso —y solo en ese— se
 * pinta un conmutador suelto. No es una excepción estética: es que el control
 * no puede vivir dentro de una cosa que a veces no existe.
 */
export type FichaPanel = {
  athleteId: string;
  apellidos: string;
  nombre: string;
  pais: string | null;
  foto: FotoTirador | null;
  lados: LadoRanking[];
};

export function PanelRanking({
  fichas,
  rfee,
  fie,
}: {
  fichas: FichaPanel[];
  /** La tabla oficial, ya montada por la página. */
  rfee: React.ReactNode;
  /** Los datos del mundial, o `null` si no hay ninguno. */
  fie: {
    grupos: GrupoClasificacion[];
    /** El grupo con el que abre, resuelto en el servidor. */
    inicial: { format: FormatoClasificacion } & RankingGroupKey;
    primeraTabla: TablaClasificacionFie | null;
    mios: string[];
    cargar: (p: {
      format: FormatoClasificacion;
      weapon: RankingGroupKey['weapon'];
      gender: RankingGroupKey['gender'];
      category: RankingGroupKey['category'];
    }) => Promise<TablaClasificacionFie | null>;
  } | null;
}) {
  /**
   * ARRANCA EN LA FIE, por petición expresa: *«al entrar en ranking por
   * defecto se pone en nacional y quiero que sea por defecto en la
   * internacional, en la FIE»*.
   *
   * Y tiene sentido con lo que enseña la ficha de arriba: el puesto mundial,
   * la foto y el histórico de diecinueve temporadas son de la FIE, así que
   * abrir en nacional obligaba a tocar el conmutador para que la tabla dijera
   * lo mismo que la ficha. Si no hay mundial cargado, se queda en nacional
   * sola: `cual` lo resuelve abajo.
   */
  const [federacion, setFederacion] = React.useState<'RFEE' | 'FIE'>('FIE');

  const hayMundial = fie !== null && fie.grupos.length > 0;
  const cual = hayMundial ? federacion : 'RFEE';

  return (
    <div className="ranking min-w-0">
      {fichas.length > 0 ? (
        <div className="mb-6 flex flex-col gap-4">
          {fichas.map((f) => (
            <FichaRanking
              key={f.athleteId}
              apellidos={f.apellidos}
              nombre={f.nombre}
              pais={f.pais}
              foto={f.foto}
              lados={f.lados}
              elegida={cual === 'FIE' ? 'FIE' : 'RFEE'}
              onElegir={(federacionElegida) =>
                setFederacion(federacionElegida === 'FIE' ? 'FIE' : 'RFEE')
              }
            />
          ))}
        </div>
      ) : hayMundial ? (
        /* Sin ficha arriba, el conmutador va suelto. Ver la cabecera. */
        <ToggleGroup
          type="single"
          variant="outline"
          value={cual}
          onValueChange={(v) => v && setFederacion(v as 'RFEE' | 'FIE')}
          aria-label="Qué clasificación se enseña"
          spacing={1}
          className="mb-5 w-full sm:w-auto"
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
