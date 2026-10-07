'use client';

import * as React from 'react';
import type {
  FormatoClasificacion,
  GrupoClasificacion,
  RankingGroupKey,
} from '@/lib/queries/ranking';
import type { TablaFieCompleta } from '@/lib/ranking/tabla-fie-completa';
import type { FiltroRankingNacional } from '@/lib/ranking/url-nacional';
import { type Ambito, type EstadoCompartido, ProveedorRanking, claveTablaFie, useRanking } from './estado-ranking';
import { clave, grupoMasParecido } from './formato';
import { MisTiradores, type TiradorPropio } from './mis-tiradores';
import { SelectorTemporada } from './selector-temporada';
import { TablaRankingEuropeo } from './tabla-europea';
import { TablaRankingFie } from './tabla-fie';
import { type DatosTablaOficial, TablaRankingOficial } from './tabla-oficial';
import type { GrupoEuropeo, TablaEuropea } from './tipos-europeo';

/**
 * ===========================================================================
 * LA PANTALLA DE RANKING: UN SOLO CONMUTADOR
 * ===========================================================================
 *
 * Nacional / Internacional / Europeo («Mundial» es sólo el Campeonato del
 * Mundo) mandan sobre la tabla; van en chips en la barra de filtros de cada
 * tabla. Encima, tus tiradores en una tarjeta compacta con su puesto nacional
 * e internacional; tocar uno de los dos puestos cambia también de ranking. El
 * estado compartido vive en `ProveedorRanking`.
 *
 * Sólo llega pintada la tabla que se ve, y de ella sólo el grupo con el que
 * abre. Lo demás se pide al cambiar y, para que el cambio parezca inmediato,
 * se adelanta en cuanto el dedo o el foco llegan a su chip. Mientras llega,
 * se sigue viendo la tabla de antes: no hay esqueletos.
 */
export type FichaPanel = TiradorPropio;

type CargarFie = (p: {
  format: FormatoClasificacion;
  weapon: RankingGroupKey['weapon'];
  gender: RankingGroupKey['gender'];
  category: RankingGroupKey['category'];
}) => Promise<TablaFieCompleta | null>;

export type NacionalDiferido = {
  /** Los datos ya leídos (se abre en Nacional) o `null` (se piden con `cargar`). */
  datos: DatosTablaOficial | null;
  /** Trae la lista de grupos y la tabla de UN grupo (el pedido o el más parecido). */
  cargar: (grupo?: RankingGroupKey | null) => Promise<DatosTablaOficial>;
  grupoInicial: string;
  conMiFicha: boolean;
  temporadas: string[];
  vigente: string | null;
  filtro: FiltroRankingNacional;
};

export type EuropeoDiferido = {
  grupos: GrupoEuropeo[];
  inicial: RankingGroupKey;
  primeraTabla: TablaEuropea | null;
  /** Personas de Explorar de los tiradores de la cuenta. */
  mios: string[];
  cargar: (g: RankingGroupKey) => Promise<TablaEuropea | null>;
};

export function PanelRanking({
  fichas,
  rfee = null,
  nacional = null,
  fie,
  europeo = null,
  federacionInicial = 'FIE',
}: {
  /** Un enlace a una lista nacional concreta abre en Nacional. */
  federacionInicial?: Ambito;
  fichas: FichaPanel[];
  /** La tabla oficial ya montada. Si no se pasa, se monta con `nacional`. */
  rfee?: React.ReactNode;
  /** Los datos de la tabla oficial, pintados o por pedir. */
  nacional?: NacionalDiferido | null;
  /** Los datos del ranking internacional, o `null` si no hay ninguno. */
  fie: {
    grupos: GrupoClasificacion[];
    /** El grupo con el que abre, resuelto en el servidor. */
    inicial: { format: FormatoClasificacion } & RankingGroupKey;
    /** `null` si se abre en otro ámbito: se pide al cambiar. */
    primeraTabla: TablaFieCompleta | null;
    mios: string[];
    cargar: CargarFie;
  } | null;
  /** El ranking europeo, o `null` si no hay listas. */
  europeo?: EuropeoDiferido | null;
}) {
  /**
   * ARRANCA EN LA FIE, por petición expresa: *«al entrar en ranking por
   * defecto se pone en nacional y quiero que sea por defecto en la
   * internacional, en la FIE»*. Si no hay ranking internacional cargado, se
   * queda en nacional sola: lo resuelve `ProveedorRanking`.
   */
  const hayInternacional = fie !== null && fie.grupos.length > 0;
  const hayEuropeo = europeo !== null && europeo.grupos.length > 0;

  const [datosNacional, setDatosNacional] = React.useState<DatosTablaOficial | null>(nacional?.datos ?? null);
  const [fallo, setFallo] = React.useState(false);
  const enCurso = React.useRef<Promise<void> | null>(null);
  const cargarNacional = nacional?.cargar;
  const pedirNacional = React.useCallback((grupo?: RankingGroupKey | null): Promise<void> | null => {
    if (!cargarNacional) return null;
    if (enCurso.current) return enCurso.current;
    setFallo(false);
    const p = cargarNacional(grupo ?? null)
      .then((d) => setDatosNacional(d))
      .catch((e: unknown) => {
        enCurso.current = null;
        setFallo(true);
        throw e;
      });
    enCurso.current = p;
    return p;
  }, [cargarNacional]);

  const adelantadas = React.useRef(new Map<string, Promise<unknown>>());
  const cargarFie = fie?.cargar;
  const inicialFie = fie?.inicial;
  const gruposFie = fie?.grupos;
  const primeraFie = fie?.primeraTabla ?? null;
  const cargarEfc = europeo?.cargar;
  const gruposEfc = europeo?.grupos;
  const inicialEfc = europeo?.inicial;
  const primeraEfc = europeo?.primeraTabla ?? null;

  /**
   * Lo que falta para enseñar ese ámbito, en el mismo grupo que se está
   * mirando: la tabla nacional, o la internacional o europea del grupo que
   * abrirá. `null` si ya está.
   */
  const preparar = React.useCallback((a: Ambito, estado: EstadoCompartido): Promise<unknown> | null => {
    const recordado = estado.memoria.grupo;
    if (a === 'RFEE') {
      if (rfee !== null || datosNacional !== null) return null;
      return pedirNacional(recordado);
    }
    if (a === 'FIE') {
      if (!cargarFie || !inicialFie || !gruposFie) return null;
      const format = estado.memoria.formato ?? inicialFie.format;
      const delFormato = gruposFie.filter((g) => g.format === format);
      const elegido = (recordado ? grupoMasParecido(delFormato, recordado) : null) ?? (format === inicialFie.format ? inicialFie : null);
      if (!elegido) return null;
      const grupo = { weapon: elegido.weapon, gender: elegido.gender, category: elegido.category };
      const k = claveTablaFie(format, grupo);
      if (estado.tablasFie.has(k)) return null;
      if (primeraFie && format === inicialFie.format && clave(grupo) === clave(inicialFie)) return null;
      const ya = adelantadas.current.get(`FIE|${k}`);
      if (ya) return ya;
      const p = cargarFie({ format, ...grupo })
        .then((t) => { estado.tablasFie.set(k, t); })
        .finally(() => adelantadas.current.delete(`FIE|${k}`));
      adelantadas.current.set(`FIE|${k}`, p);
      return p;
    }
    if (!cargarEfc || !gruposEfc || !inicialEfc) return null;
    const elegido = (recordado ? grupoMasParecido(gruposEfc, recordado) : null) ?? inicialEfc;
    const grupo = { weapon: elegido.weapon, gender: elegido.gender, category: elegido.category };
    const k = clave(grupo);
    if (estado.tablasEfc.has(k)) return null;
    if (primeraEfc && clave(primeraEfc.grupo) === k) return null;
    const ya = adelantadas.current.get(`EFC|${k}`);
    if (ya) return ya;
    const p = cargarEfc(grupo)
      .then((t) => { estado.tablasEfc.set(k, t); })
      .finally(() => adelantadas.current.delete(`EFC|${k}`));
    adelantadas.current.set(`EFC|${k}`, p);
    return p;
  }, [rfee, datosNacional, pedirNacional, cargarFie, inicialFie, gruposFie, primeraFie, cargarEfc, gruposEfc, inicialEfc, primeraEfc]);

  /**
   * Se adelanta la tabla que no se ve cuando el dedo o el foco llegan a su
   * chip, no al cargar: adelantarla siempre duplicaría las lecturas de cada
   * visita, y la mayoría no cambia de ranking.
   */
  const intencion = React.useCallback((a: Ambito, estado: EstadoCompartido) => {
    void preparar(a, estado)?.catch(() => {});
  }, [preparar]);

  return (
    <ProveedorRanking
      ambitoInicial={federacionInicial}
      hayInternacional={hayInternacional}
      hayEuropeo={hayEuropeo}
      onIntencion={intencion}
      preparar={preparar}
    >
      {(cual) => (
        <div className="ranking flex min-w-0 flex-col gap-4">
          {/* Tus tiradores arriba, con su puesto nacional e internacional; tocar uno cambia la tabla. */}
          <MisTiradoresConAmbito tiradores={fichas} />
          {cual === 'EFC' && europeo ? (
            <TablaRankingEuropeo
              grupos={europeo.grupos}
              inicial={europeo.inicial}
              primeraTabla={europeo.primeraTabla}
              mios={europeo.mios}
              cargar={europeo.cargar}
            />
          ) : cual === 'FIE' && fie ? (
            <TablaRankingFie
              grupos={fie.grupos}
              inicial={fie.inicial}
              primeraTabla={fie.primeraTabla}
              mios={fie.mios}
              cargar={fie.cargar}
            />
          ) : (
            rfee ?? (nacional ? (
              <TablaNacional nacional={nacional} datos={datosNacional} fallo={fallo} pedir={pedirNacional} />
            ) : null)
          )}
        </div>
      )}
    </ProveedorRanking>
  );
}

/** La tabla nacional con sus datos. Sin ellos no pinta nada: el cambio espera a que lleguen. */
function TablaNacional({
  nacional,
  datos,
  fallo,
  pedir,
}: {
  nacional: NacionalDiferido;
  datos: DatosTablaOficial | null;
  fallo: boolean;
  pedir: (grupo?: RankingGroupKey | null) => Promise<void> | null;
}) {
  const ranking = useRanking();
  React.useEffect(() => {
    if (!datos && !fallo) void pedir(ranking?.memoria.current.grupo)?.catch(() => {});
  }, [datos, fallo, pedir, ranking]);

  if (!datos) {
    return fallo ? (
      <p role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        No se ha podido cargar la clasificación nacional.
        <button
          type="button"
          onClick={() => void pedir(ranking?.memoria.current.grupo)?.catch(() => {})}
          className="relative min-h-0! min-w-0! text-primary-text underline underline-offset-4 after:absolute after:-inset-3 after:content-['']"
        >
          Reintentar
        </button>
      </p>
    ) : null;
  }

  const cargarGrupo = (g: RankingGroupKey) => nacional.cargar(g);
  return (
    <TablaRankingOficial
      grupos={datos.grupos}
      tablas={datos.tablas}
      cortes={datos.cortes}
      desgloses={datos.desgloses}
      internos={datos.internos}
      mios={datos.mios}
      grupoInicial={datos.grupoCargado ?? nacional.grupoInicial}
      conMiFicha={nacional.conMiFicha}
      armasAutorizadas={datos.armasAutorizadas}
      personas={datos.personas}
      cargarGrupo={cargarGrupo}
      selectorTemporada={nacional.temporadas.length > 1 ? (
        <SelectorTemporada temporadas={nacional.temporadas} vigente={nacional.vigente} actual={nacional.filtro} />
      ) : null}
    />
  );
}

function MisTiradoresConAmbito({ tiradores }: { tiradores: FichaPanel[] }) {
  const ranking = useRanking();
  return (
    <MisTiradores
      tiradores={tiradores}
      elegida={ranking?.pendiente ?? ranking?.ambito ?? 'RFEE'}
      onElegir={(f) => ranking?.cambiarAmbito(f)}
      onIntencion={(f) => ranking?.intencion(f)}
    />
  );
}
