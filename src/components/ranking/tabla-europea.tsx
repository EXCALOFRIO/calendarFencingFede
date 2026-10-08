'use client';

import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { VerMas } from '@/components/sistema/cabecera-seccion';
import { ChipFiltro } from '@/components/sistema/chip-filtro';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import type { RankingGroupKey } from '@/lib/queries/ranking';
import { nombreCasa } from '@/lib/nombres';
import { temporadaCorta } from '@/lib/ranking/url-nacional';
import { cn, titular } from '@/lib/utils';
import { escribirUrl, urlDeGrupo, useRanking } from './estado-ranking';
import { FilaLinea } from './fila-linea';
import { clave, grupoMasParecido } from './formato';
import { Procedencia } from './piezas';
import { BarraFiltrosRanking } from './selectores-grupo';
import type { GrupoEuropeo, TablaEuropea } from './tipos-europeo';

const PASO = 50;

/**
 * El ranking europeo de la EFC: cadete, sub-23 y U14, que son las listas que
 * publica. Cada grupo enseña su última lista con puestos; la temporada va en
 * la línea de debajo de los filtros, porque la sub-23 de la temporada que
 * empieza puede no estar publicada todavía.
 *
 * Igual que la internacional: un grupo a la vez, «Solo España» apagado de
 * entrada (sin renumerar) y el buscador sin recorte. Cambiar de grupo deja la
 * tabla de antes a la vista hasta que llega la nueva.
 */
export function TablaRankingEuropeo({
  grupos,
  inicial,
  primeraTabla,
  mios,
  cargar,
}: {
  grupos: GrupoEuropeo[];
  inicial: RankingGroupKey;
  primeraTabla: TablaEuropea | null;
  /** Personas de Explorar de los tiradores de la cuenta. */
  mios: readonly string[];
  cargar: (g: RankingGroupKey) => Promise<TablaEuropea | null>;
}) {
  const ranking = useRanking();
  const parametros = useSearchParams() as URLSearchParams | null;
  const cache = ranking?.tablasEfc;

  const [arranque] = React.useState(() => {
    const deseado = ranking?.memoria.current.grupo;
    const encontrado = deseado ? grupoMasParecido(grupos, deseado) : null;
    const grupo: RankingGroupKey = encontrado
      ? { weapon: encontrado.weapon, gender: encontrado.gender, category: encontrado.category }
      : { weapon: inicial.weapon, gender: inicial.gender, category: inicial.category };
    const esLaPintada = primeraTabla !== null && clave(primeraTabla.grupo) === clave(grupo);
    const enCache = cache?.current.get(clave(grupo));
    return { grupo, tabla: esLaPintada ? primeraTabla : (enCache ?? null), pedir: !esLaPintada && enCache === undefined };
  });
  const [grupo, setGrupo] = React.useState<RankingGroupKey>(arranque.grupo);
  const [tabla, setTabla] = React.useState<TablaEuropea | null>(arranque.tabla);
  const [cargando, setCargando] = React.useState(arranque.pedir);
  const [soloEspana, setSoloEspana] = React.useState(() => parametros?.get('espana') === '1');
  const [busqueda, setBusqueda] = React.useState(() => ranking?.memoria.current.q ?? parametros?.get('q') ?? '');
  const [tope, setTope] = React.useState(PASO);

  const peticion = React.useRef(0);
  const pedir = React.useCallback(async (g: RankingGroupKey) => {
    const mia = ++peticion.current;
    const k = clave(g);
    const guardada = cache?.current.get(k);
    if (guardada !== undefined) {
      setTabla(guardada);
      setTope(PASO);
      setCargando(false);
      return;
    }
    setCargando(true);
    try {
      const r = await cargar(g);
      cache?.current.set(k, r);
      if (peticion.current === mia) {
        setTabla(r);
        setTope(PASO);
      }
    } catch {
      // La tabla de antes se queda; el siguiente toque lo vuelve a intentar.
    } finally {
      if (peticion.current === mia) setCargando(false);
    }
  }, [cargar, cache]);

  React.useEffect(() => {
    if (primeraTabla) cache?.current.set(clave(primeraTabla.grupo), primeraTabla);
    if (arranque.pedir) void pedir(arranque.grupo);
    // Sólo al montar: lo demás lo pide `elegir`.
  }, []);

  const elegir = (parcial: Partial<RankingGroupKey>) => {
    const destino = grupoMasParecido(grupos, { ...grupo, ...parcial }) ?? grupos[0];
    if (!destino) return;
    const siguiente = { weapon: destino.weapon, gender: destino.gender, category: destino.category };
    setGrupo(siguiente);
    setBusqueda('');
    if (ranking) ranking.memoria.current = { ...ranking.memoria.current, grupo: siguiente, q: '' };
    escribirUrl({ ...urlDeGrupo(siguiente), q: null });
    void pedir(siguiente);
  };

  const buscar = (q: string) => {
    setBusqueda(q);
    if (ranking) ranking.memoria.current = { ...ranking.memoria.current, q };
    escribirUrl({ q });
  };

  const cambiarEspana = (activo: boolean) => {
    setSoloEspana(activo);
    escribirUrl({ espana: activo ? '1' : null });
  };

  const propios = React.useMemo(() => new Set(mios), [mios]);
  const filtradas = React.useMemo(() => {
    let f = (tabla?.filas ?? []).filter((r) => !soloEspana || r.pais === 'ESP');
    if (busqueda) f = f.filter((r) => nombreCasa(r.nombre, busqueda) || nombreCasa(r.pais ?? '', busqueda));
    return f;
  }, [tabla, soloEspana, busqueda]);
  const recorta = !busqueda && !soloEspana;
  const visibles = recorta ? filtradas.slice(0, tope) : filtradas;
  const quedan = filtradas.length - visibles.length;

  return (
    <div className="ranking flex min-w-0 flex-col gap-3">
      <BarraFiltrosRanking
        grupos={grupos}
        grupo={grupo}
        onElegir={elegir}
        busqueda={busqueda}
        onBuscar={buscar}
        chips={
          <ChipFiltro
            marcado={soloEspana}
            onClick={() => cambiarEspana(!soloEspana)}
            contador={tabla ? tabla.espanoles : undefined}
            detalle={tabla ? `de ${tabla.filas.length}` : undefined}
          >
            Solo España
          </ChipFiltro>
        }
        activos={soloEspana ? 1 : 0}
        onRestablecer={soloEspana ? () => cambiarEspana(false) : null}
        resultados={`Ver ${filtradas.length} ${filtradas.length === 1 ? 'tirador' : 'tiradores'}`}
      />

      {tabla ? (
        <Procedencia
          temporada={`Temporada ${temporadaCorta(tabla.temporada)}`}
          leida={tabla.publicadaEl}
          url={tabla.sourceUrl}
        />
      ) : null}

      {tabla ? (
        <p role="status" className="sr-only">
          {filtradas.length} {filtradas.length === 1 ? 'tirador' : 'tiradores'}
        </p>
      ) : null}

      {visibles.length > 0 ? (
        <ol
          aria-label="Ranking europeo"
          aria-busy={cargando || undefined}
          className={cn('grid w-full min-w-0 max-w-3xl gap-px overflow-hidden rounded-xl border bg-border transition-opacity duration-150', cargando && 'opacity-60')}
        >
          {visibles.map((fila, i) => (
            <FilaLinea
              key={`${fila.puesto ?? 'sc'}-${i}`}
              puesto={fila.puesto}
              nombre={titular(fila.nombre)}
              personaId={fila.personaId}
              pais={soloEspana ? null : fila.pais}
              puntos={fila.puntos}
              mio={fila.personaId !== null && propios.has(fila.personaId)}
              resaltada={fila.pais === 'ESP'}
            />
          ))}
        </ol>
      ) : null}

      {filtradas.length === 0 && !cargando ? (
        <EstadoVacio
          titulo={busqueda ? 'Ningún nombre coincide' : soloEspana ? 'Nadie de España en esta prueba' : 'Sin clasificación europea en esta prueba'}
          descripcion={busqueda ? 'Prueba otro nombre o país.' : undefined}
        />
      ) : null}

      {quedan > 0 ? (
        <VerMas onClick={() => setTope(tope + PASO)} cuenta={quedan} detalle="tiradores de la clasificación" className="self-center" />
      ) : null}
    </div>
  );
}
