'use client';

import * as React from 'react';
import type { FormatoClasificacion, RankingGroupKey } from '@/lib/queries/ranking';
import type { TablaEuropea } from './tipos-europeo';
import type { TablaFieCompleta } from '@/lib/ranking/tabla-fie-completa';
import { clave } from './formato';

/**
 * El estado de /ranking que comparten las tablas y la URL.
 *
 * Nacional, Internacional y Europeo son tres tablas, pero para quien mira es
 * UNA pantalla con unos filtros: si estás en florete masculino y cambias de
 * ranking, sigues en florete masculino, y lo que habías escrito en el buscador
 * sigue escrito. Cada tabla se monta al elegirla, así que lo que se recuerda
 * vive aquí, por encima de las tres.
 *
 * Cambiar a una tabla que todavía no ha llegado NO pinta un hueco: el chip
 * queda marcado y la tabla de antes sigue a la vista hasta que la nueva está
 * (`preparar`), igual que una navegación de Next sin `loading.tsx`.
 *
 * La URL se actualiza con `history.replaceState`, que Next integra con su
 * enrutador sin pedir la página otra vez al servidor. El enlace que se
 * comparte abre en la misma vista.
 */
export type Ambito = 'RFEE' | 'FIE' | 'EFC';

export const AMBITO_EN_URL: Record<Ambito, string> = { RFEE: 'nacional', FIE: 'internacional', EFC: 'europeo' };

export type Memoria = {
  grupo?: RankingGroupKey;
  formato?: FormatoClasificacion;
  q?: string;
};

type Contexto = {
  ambito: Ambito;
  /** El ámbito pedido cuya tabla todavía no ha llegado. */
  pendiente: Ambito | null;
  ambitos: readonly Ambito[];
  cambiarAmbito: (a: Ambito) => void;
  /** Quien mira va a tocar ese ranking (dedo encima, foco): se puede adelantar su tabla. */
  intencion: (a: Ambito) => void;
  hayInternacional: boolean;
  memoria: React.RefObject<Memoria>;
  /** Tablas FIE ya pedidas en esta visita, por formato y grupo. */
  tablasFie: React.RefObject<Map<string, TablaFieCompleta | null>>;
  /** Tablas europeas ya pedidas en esta visita, por grupo. */
  tablasEfc: React.RefObject<Map<string, TablaEuropea | null>>;
};

/** Lo que necesita quien adelanta una tabla: dónde se guardan y qué grupo se recuerda. */
export type EstadoCompartido = {
  memoria: Memoria;
  tablasFie: Map<string, TablaFieCompleta | null>;
  tablasEfc: Map<string, TablaEuropea | null>;
};

const ContextoRanking = React.createContext<Contexto | null>(null);

export function ProveedorRanking({
  ambitoInicial,
  hayInternacional,
  hayEuropeo = false,
  onIntencion,
  preparar,
  children,
}: {
  ambitoInicial: Ambito;
  hayInternacional: boolean;
  hayEuropeo?: boolean;
  onIntencion?: (a: Ambito, estado: EstadoCompartido) => void;
  /** Lo que falta para enseñar ese ámbito; `null` si ya se puede. */
  preparar?: (a: Ambito, estado: EstadoCompartido) => Promise<unknown> | null;
  children: (ambito: Ambito) => React.ReactNode;
}) {
  const ambitos = React.useMemo<Ambito[]>(
    () => ['RFEE', ...(hayInternacional ? (['FIE'] as const) : []), ...(hayEuropeo ? (['EFC'] as const) : [])],
    [hayInternacional, hayEuropeo],
  );
  const [ambito, setAmbito] = React.useState<Ambito>(ambitoInicial);
  const [pendiente, setPendiente] = React.useState<Ambito | null>(null);
  const ultimo = React.useRef<Ambito | null>(null);
  const memoria = React.useRef<Memoria>({});
  const tablasFie = React.useRef(new Map<string, TablaFieCompleta | null>());
  const tablasEfc = React.useRef(new Map<string, TablaEuropea | null>());
  const cual = ambitos.includes(ambito) ? ambito : 'RFEE';

  const valor = React.useMemo<Contexto>(() => {
    const estado = (): EstadoCompartido => ({ memoria: memoria.current, tablasFie: tablasFie.current, tablasEfc: tablasEfc.current });
    const mostrar = (a: Ambito) => {
      setAmbito(a);
      setPendiente(null);
      escribirUrl({ ambito: AMBITO_EN_URL[a] });
    };
    return {
      ambito: cual,
      pendiente,
      ambitos,
      cambiarAmbito: (a) => {
        ultimo.current = a;
        if (a === cual) {
          setPendiente(null);
          return;
        }
        const espera = preparar?.(a, estado()) ?? null;
        if (!espera) {
          mostrar(a);
          return;
        }
        setPendiente(a);
        // Si falla, se cambia igual: la tabla dirá que no ha podido cargar.
        void espera.catch(() => {}).then(() => {
          if (ultimo.current === a) mostrar(a);
        });
      },
      intencion: (a) => {
        if (a !== cual) onIntencion?.(a, estado());
      },
      hayInternacional,
      memoria,
      tablasFie,
      tablasEfc,
    };
  }, [cual, pendiente, ambitos, hayInternacional, onIntencion, preparar]);
  return <ContextoRanking.Provider value={valor}>{children(cual)}</ContextoRanking.Provider>;
}

export function useRanking(): Contexto | null {
  return React.useContext(ContextoRanking);
}

export const claveTablaFie = (f: FormatoClasificacion, g: RankingGroupKey) => `${f}|${clave(g)}`;

/**
 * Cambia parámetros de la URL sin navegar. `null` o '' borra el parámetro.
 * En el servidor (o en un arnés sin `window`) no hace nada.
 */
export function escribirUrl(cambios: Record<string, string | null | undefined>): void {
  if (typeof window === 'undefined') return;
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(cambios)) {
    if (v === null || v === undefined || v === '') p.delete(k);
    else p.set(k, v);
  }
  const q = p.toString();
  const destino = `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`;
  if (destino !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(null, '', destino);
  }
}

/** Los parámetros de un grupo, tal cual los lee `leerFiltroRankingNacional`. */
export function urlDeGrupo(g: RankingGroupKey): Record<string, string> {
  return { arma: g.weapon, genero: g.gender, categoria: g.category };
}
