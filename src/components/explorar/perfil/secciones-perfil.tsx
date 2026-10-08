import type { ChipRanking } from '@/lib/sport/explorar/chips-ranking';
import type { HistorialVista } from '@/lib/sport/explorar/ficha-pantalla';
import type { CriteriosFicha } from '@/lib/sport/explorar/ficha-url';
import type { RivalesSeccion } from '@/lib/sport/explorar/perfil-diferido';
import type { DatosPersonales, ExtrasPerfil } from '@/lib/sport/explorar/perfil-extra';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { ANCLA_CURIOSIDADES, type SeccionPerfil } from '@/lib/sport/explorar/perfil-secciones';
import { cn } from '@/lib/utils';
import { bloquesRankingPerfil } from '@/lib/sport/explorar/ranking-ambitos';
import type { BloqueRankingInternacional } from '@/lib/sport/explorar/ranking-internacional';
import type { RelevosPerfil } from '@/lib/sport/explorar/relevos';
import type { Rendimiento } from '@/lib/sport/explorar/rendimiento';
import type { FichaConPerfil } from '@/lib/sport/explorar/tipos-perfil';
import type { EstadisticasRivales } from '@/lib/sport/explorar/tipos-social';
import { CabeceraFicha, CifrasCarrera, HistorialFicha, PanelRendimiento, PestanaRanking, RankingCompacto } from '../ficha-deportiva';
import { FUERA_DE_PANTALLA } from '../graficos/comun';
import { SeccionRendimiento } from '../graficos/seccion-rendimiento';
import { RelevosPerfilVista } from '../relevos';
import { BalanceFasesRivales, CuriosidadesPerfil } from './curiosidades-perfil';
import { PestanasPerfil, SoloEnSeccion } from './pestanas-perfil';
import { RankingAmbitoPerfil } from './ranking-ambito';
import { ResultadosPerfilVista } from './resultados-perfil';
import { RivalesPorAmbitoVista } from './rivales-ambito';
import { SugeridosPerfil } from './sugeridos-perfil';

/**
 * Perfil de Explorar por secciones: una cabecera compacta común (retrato,
 * nombre, bandera, la línea de ranking y las acciones) con sus pestañas, y
 * una sección cada vez debajo. Cada sección recibe sólo sus datos: la página
 * de esa sección los lee al abrirse.
 */

const NIVEL = 'pagina' as const;

/** Qué pestañas salen: Ranking sólo con algún puesto. Las curiosidades van al final de Estadísticas. */
export function seccionesDisponibles(_ficha: FichaConPerfil, extras: ExtrasPerfil): SeccionPerfil[] {
  return ['resultados', 'estadisticas', 'rivales', ...(bloquesRankingPerfil(extras).hay ? (['ranking'] as const) : [])];
}

export function CabeceraPerfil({
  ficha,
  datos,
  chips,
  extras,
  acciones,
  activa,
}: {
  ficha: FichaConPerfil;
  datos: DatosPersonales | null;
  chips: readonly ChipRanking[];
  extras: ExtrasPerfil;
  acciones?: React.ReactNode;
  /** Sólo para pintar sin router (arneses); en la app la da la URL. */
  activa?: SeccionPerfil;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <CabeceraFicha ficha={ficha} datos={datos} chips={chips} acciones={acciones} conCifras={false} />
      <PestanasPerfil personaId={ficha.id} secciones={seccionesDisponibles(ficha, extras)} activa={activa} />
      {/* Ya leído para la cabecera: Estadísticas no vuelve a pedir la ficha. */}
      <SoloEnSeccion seccion="estadisticas" activa={activa}>
        <div className="flex min-w-0 flex-col gap-8 pt-1">
          <CifrasCarrera ficha={ficha} />
          {/* Con pestaña de ranking, el resumen de la temporada ya no se repite aquí. */}
          {bloquesRankingPerfil(extras).hay ? null : <RankingCompacto ficha={ficha} nivel={NIVEL} />}
        </div>
      </SoloEnSeccion>
    </div>
  );
}


export function SeccionResultados({
  ficha,
  historial,
  base,
  criterios,
}: {
  ficha: FichaConPerfil;
  historial: HistorialVista;
  base: string;
  criterios: CriteriosFicha;
}) {
  const resultados = ficha.perfil?.resultados;
  // Sin pruebas individuales (sólo equipos, o la lectura falló) queda el historial paginado de siempre.
  return resultados && resultados.items.length > 0 ? (
    <ResultadosPerfilVista personaId={ficha.id} resultados={resultados} base={base} criterios={criterios} nivel={NIVEL} />
  ) : (
    <HistorialFicha historial={historial} base={base} criterios={criterios} nivel={NIVEL} enPestana personaId={ficha.id} />
  );
}

/**
 * Sección Estadísticas: el rendimiento (la tarjeta de cifras la pone la
 * cabecera) y, al final, las curiosidades de sus asaltos (`#curiosidades`).
 * Sólo si el rendimiento no se pudo leer hace falta la ficha, para el
 * desglose de siempre.
 */
export function SeccionEstadisticas({
  rendimiento,
  ficha = null,
  personaId,
  curiosidades,
}: {
  rendimiento: Rendimiento | null;
  ficha?: FichaConPerfil | null;
  personaId?: string;
  /** `undefined`: no se leyeron; `null`: la lectura falló. */
  curiosidades?: EstadisticasRivales | null;
}) {
  const principal =
    rendimiento && rendimiento.vistas.todo.total.competiciones > 0 ? (
      <SeccionRendimiento datos={rendimiento} nivel={NIVEL} tituloOculto />
    ) : ficha ? (
      <PanelRendimiento ficha={ficha} rendimiento={null} rankingEnRendimiento={null} nivel={NIVEL} />
    ) : (
      <EstadoVacio titulo="Sin competiciones individuales" />
    );
  // Sin asaltos importados no hay curiosidades: el bloque no sale, sin estado vacío.
  const bloque =
    personaId && curiosidades !== undefined && (curiosidades === null || curiosidades.total.asaltos > 0) ? (
      <section id={ANCLA_CURIOSIDADES} aria-label="Curiosidades" className={cn('flex min-w-0 scroll-mt-16 flex-col gap-8', FUERA_DE_PANTALLA)}>
        <SeccionCuriosidades personaId={personaId} stats={curiosidades} />
      </section>
    ) : null;
  return (
    <>
      {principal}
      {bloque}
    </>
  );
}

/** Hay rendimiento que pintar; si no, la sección necesita la ficha. */
export function rendimientoUtil(r: Rendimiento | null): boolean {
  return Boolean(r && r.vistas.todo.total.competiciones > 0);
}

export function SeccionRivales({
  personaId,
  datos,
  relevos,
}: {
  personaId: string;
  datos: RivalesSeccion;
  relevos: RelevosPerfil | null;
}) {
  // Buscar a cualquier rival ya está en «Cara a cara» de la cabecera: aquí sólo las listas, que van directas al duelo.
  return (
    <>
      <RivalesPorAmbitoVista personaId={personaId} datos={datos.enfrentados} nivel={NIVEL} />
      <SugeridosPerfil personaId={personaId} sugeridos={datos.sugeridos} nivel={NIVEL} />
      <div className={cn('min-w-0', FUERA_DE_PANTALLA)}>
        <RelevosPerfilVista datos={relevos} personaId={personaId} nivel={NIVEL} />
      </div>
    </>
  );
}

export function SeccionCuriosidades({ personaId, stats }: { personaId: string; stats: EstadisticasRivales | null }) {
  if (!stats) return <EstadoVacio tipo="error" titulo="No se han podido cargar" descripcion="Inténtalo de nuevo en un momento." />;
  if (stats.total.asaltos === 0) return <EstadoVacio titulo="Sin asaltos importados" />;
  return (
    <>
      <BalanceFasesRivales stats={stats} nivel={NIVEL} />
      <CuriosidadesPerfil personaId={personaId} stats={stats} nivel={NIVEL} />
    </>
  );
}

export function SeccionRanking({ extras, europeo }: { extras: ExtrasPerfil; europeo: BloqueRankingInternacional | null }) {
  return (
    <>
      {/* Entre el h1 (el nombre) y los h3 de cada ámbito: la pestaña ya lo dice a la vista. */}
      <h2 className="sr-only">Ranking</h2>
      <PestanaRanking
        bloques={bloquesRankingPerfil(extras)}
        nivel={NIVEL}
        europeo={europeo ? <RankingAmbitoPerfil titulo="Europeo" bloque={europeo} nivel={NIVEL} /> : null}
      />
    </>
  );
}

/** Contenedor de una sección: mismo ritmo vertical en todas. */
export function CuerpoSeccion({ children }: { children: React.ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-8 pt-1">{children}</div>;
}
