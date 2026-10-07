'use client';

import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { OpcionesFiltro } from '@/components/filtros/chips';
import { BurbujaOlimpica } from '@/components/olimpica/burbuja-olimpica';
import { FiltroOlimpico } from '@/components/olimpica/filtro-olimpico';
import { ChipFiltro, clasesChip } from '@/components/sistema/chip-filtro';
import type {
  FilaFie,
  FormatoClasificacion,
  GrupoClasificacion,
  RankingGroupKey,
} from '@/lib/queries/ranking';
import { nombreCasa } from '@/lib/nombres';
import { ordenarSoloJjoo } from '@/lib/ranking/olimpica';
import type { TablaFieCompleta } from '@/lib/ranking/tabla-fie-completa';
import { cn, formatDateEs } from '@/lib/utils';
import { claveTablaFie, escribirUrl, urlDeGrupo, useRanking } from './estado-ranking';
import { FilaLinea } from './fila-linea';
import { clave } from './formato';
import { Procedencia, VerMas } from './piezas';
import { BarraFiltrosRanking, type Quitable } from './selectores-grupo';

/** Filas por tanda. Igual que en la tabla oficial. */
const PASO = 50;

/**
 * ===========================================================================
 * EL RANKING INTERNACIONAL DE LA FIE
 * ===========================================================================
 *
 * «Internacional» y nunca «Mundial»: «Mundial» es el Campeonato del Mundo.
 *
 * Dos clasificaciones y dos filtros:
 *
 *  - **Individual / Selecciones**, que son `type=I` y `type=E` de la FIE.
 *  - **«Solo España», APAGADO de entrada**: lo primero que se ve es el mundo.
 *    Encendido, la misma tabla con sus puestos intactos: el 13 sigue siendo
 *    el 13, no pasa a ser el 1.
 *  - **«Solo JJOO»**, sólo en las seis pruebas olímpicas (absoluto, masculino
 *    o femenino): quien entra hoy en Los Ángeles 2028 o está cerca, en el
 *    orden de `ordenarSoloJjoo`. La marca va en cada fila, detrás del nombre
 *    (`BurbujaOlimpica`), con el filtro encendido o no. Se recuerda en la URL
 *    (`?jjoo=1`) para poder compartir el enlace.
 *
 * Se pide un grupo a la vez (el más grande son ~1.250 filas): el de arranque
 * viene pintado del servidor y cambiar de arma pide sólo ese grupo, con sus
 * marcas olímpicas y la persona de cada fila (`completarTablaFie`).
 */
export function TablaRankingFie({
  grupos,
  inicial,
  primeraTabla,
  mios,
  cargar,
}: {
  grupos: GrupoClasificacion[];
  inicial: { format: FormatoClasificacion } & RankingGroupKey;
  /** El grupo de arranque, ya resuelto en el servidor. */
  primeraTabla: TablaFieCompleta | null;
  mios: string[];
  /** Acción de servidor que trae un grupo. */
  cargar: (p: {
    format: FormatoClasificacion;
    weapon: RankingGroupKey['weapon'];
    gender: RankingGroupKey['gender'];
    category: RankingGroupKey['category'];
  }) => Promise<TablaFieCompleta | null>;
}) {
  const ranking = useRanking();
  // Fuera del enrutador (pruebas, capturas sin servidor) no hay parámetros.
  const parametros = useSearchParams() as URLSearchParams | null;

  /**
   * Con qué abre: lo que se recuerda de la otra tabla (mismo grupo, mismo
   * texto en el buscador) o, si no, lo que trae el servidor. Si lo recordado
   * no es la tabla que vino pintada, se pide al montar.
   */
  const [arranque] = React.useState(() => {
    const memoria = ranking?.memoria.current;
    const format = memoria?.formato ?? inicial.format;
    const disponibles = grupos.filter((g) => g.format === format);
    const deseado = memoria?.grupo;
    const encontrado = deseado
      ? (disponibles.find((g) => clave(g) === clave(deseado)) ??
        disponibles.find((g) => g.weapon === deseado.weapon && g.gender === deseado.gender) ??
        disponibles.find((g) => g.weapon === deseado.weapon))
      : undefined;
    const grupo: RankingGroupKey = encontrado
      ? { weapon: encontrado.weapon, gender: encontrado.gender, category: encontrado.category }
      : { weapon: inicial.weapon, gender: inicial.gender, category: inicial.category };
    const formato = encontrado ? format : inicial.format;
    const esLaPintada = primeraTabla !== null && formato === inicial.format && clave(grupo) === clave(inicial);
    const enCache = ranking?.tablasFie.current.get(claveTablaFie(formato, grupo));
    return {
      formato,
      grupo,
      tabla: esLaPintada ? primeraTabla : (enCache ?? null),
      pedir: !esLaPintada && enCache === undefined,
    };
  });
  const [format, setFormat] = React.useState<FormatoClasificacion>(arranque.formato);
  const [grupo, setGrupo] = React.useState<RankingGroupKey>(arranque.grupo);
  const [tabla, setTabla] = React.useState<TablaFieCompleta | null>(arranque.tabla);
  const [cargando, setCargando] = React.useState(arranque.pedir);
  const [soloEspana, setSoloEspana] = React.useState(() => parametros?.get('espana') === '1');
  const [jjooPedido, setJjooPedido] = React.useState(() => parametros?.get('jjoo') === '1');
  const [busqueda, setBusqueda] = React.useState(() => ranking?.memoria.current.q ?? parametros?.get('q') ?? '');
  const [tope, setTope] = React.useState(PASO);

  const gruposDelFormato = React.useMemo(
    () => grupos.filter((g) => g.format === format),
    [grupos, format],
  );

  const recordar = (cambios: { grupo?: RankingGroupKey; formato?: FormatoClasificacion; q?: string }) => {
    if (ranking) ranking.memoria.current = { ...ranking.memoria.current, ...cambios };
  };

  /**
   * Pide un grupo y lo pinta. Si llegan dos respuestas cruzadas —se toca arma
   * dos veces seguidas— gana la última que se pidió, no la última que llega.
   * Lo ya pedido en esta visita no se vuelve a pedir.
   */
  const peticion = React.useRef(0);
  const cache = ranking?.tablasFie;
  const pedir = React.useCallback(
    async (f: FormatoClasificacion, g: RankingGroupKey) => {
      const mia = ++peticion.current;
      const k = claveTablaFie(f, g);
      const guardada = cache?.current.get(k);
      if (guardada !== undefined) {
        setTabla(guardada);
        setTope(PASO);
        setCargando(false);
        return;
      }
      setCargando(true);
      try {
        const r = await cargar({ format: f, ...g });
        cache?.current.set(k, r);
        if (peticion.current === mia) {
          setTabla(r);
          setTope(PASO);
        }
      } finally {
        if (peticion.current === mia) setCargando(false);
      }
    },
    [cargar, cache],
  );

  React.useEffect(() => {
    if (primeraTabla) cache?.current.set(claveTablaFie(inicial.format, inicial), primeraTabla);
    if (arranque.pedir) void pedir(arranque.formato, arranque.grupo);
    // Sólo al montar: lo que se pide después lo piden `elegir` y `cambiarFormato`.
  }, []);

  const irA = (f: FormatoClasificacion, destino: RankingGroupKey) => {
    const siguiente = { weapon: destino.weapon, gender: destino.gender, category: destino.category };
    setFormat(f);
    setGrupo(siguiente);
    setBusqueda('');
    recordar({ grupo: siguiente, formato: f, q: '' });
    escribirUrl({ ...urlDeGrupo(siguiente), formato: f === 'EQUIPOS' ? 'equipos' : null, q: null });
    void pedir(f, siguiente);
  };

  /** Al cambiar de formato se conserva el grupo si existe allí. */
  const cambiarFormato = (f: FormatoClasificacion) => {
    if (f === format) return;
    const disponibles = grupos.filter((g) => g.format === f);
    const destino =
      disponibles.find((g) => clave(g) === clave(grupo)) ??
      disponibles.find((g) => g.weapon === grupo.weapon && g.gender === grupo.gender) ??
      disponibles.find((g) => g.weapon === grupo.weapon) ??
      disponibles[0];
    if (destino) irA(f, destino);
  };

  const elegir = (parcial: Partial<RankingGroupKey>) => {
    const pedido = { ...grupo, ...parcial };
    const existe = gruposDelFormato.some((g) => clave(g) === clave(pedido));
    const destino = existe
      ? pedido
      : (gruposDelFormato.find(
          (g) =>
            (parcial.weapon ? g.weapon === parcial.weapon : true) &&
            (parcial.gender ? g.gender === parcial.gender : true) &&
            (parcial.category ? g.category === parcial.category : true),
        ) ?? gruposDelFormato[0]);
    if (destino) irA(format, destino);
  };

  const buscar = (q: string) => {
    setBusqueda(q);
    recordar({ q });
    escribirUrl({ q });
  };

  const porEquipos = format === 'EQUIPOS';
  const olimpica = tabla?.olimpica ?? null;
  // Fuera de las pruebas olímpicas el `?jjoo=1` se ignora y el conmutador no se pinta.
  const soloJjoo = jjooPedido && olimpica !== null;

  const cambiarJjoo = (activo: boolean) => {
    setJjooPedido(activo);
    escribirUrl({ jjoo: activo ? '1' : null });
  };
  const cambiarEspana = (activo: boolean) => {
    setSoloEspana(activo);
    escribirUrl({ espana: activo ? '1' : null });
  };

  const anotacionDe = React.useCallback(
    (r: FilaFie) => (porEquipos ? olimpica?.equipos[r.pais ?? ''] : olimpica?.individual[String(r.fieId)]),
    [olimpica, porEquipos],
  );

  const conJjoo = React.useMemo(() => {
    if (!olimpica) return [];
    const base = (tabla?.rows ?? []).filter((r) => !soloEspana || r.pais === 'ESP');
    return ordenarSoloJjoo(base, (r) => ({ anotacion: anotacionDe(r), posicion: r.position }));
  }, [tabla, olimpica, soloEspana, anotacionDe]);

  const filtradas = React.useMemo(() => {
    let f = soloJjoo ? conJjoo : (tabla?.rows ?? []).filter((r) => !soloEspana || r.pais === 'ESP');
    if (busqueda) {
      f = f.filter(
        (r) =>
          nombreCasa(r.nombre ?? '', busqueda) ||
          nombreCasa(r.paisNombre ?? '', busqueda) ||
          nombreCasa(r.pais ?? '', busqueda),
      );
    }
    return f;
  }, [tabla, soloEspana, soloJjoo, conJjoo, busqueda]);

  /**
   * Buscando o filtrando se enseña TODO lo que casa, sin «ver más»: quien
   * escribe un nombre quiere ese nombre.
   */
  const recorta = !busqueda && !soloEspana && !soloJjoo;
  const visibles = recorta ? filtradas.slice(0, tope) : filtradas;
  const quedan = filtradas.length - visibles.length;
  const conBandera = !soloEspana;

  /*
    «Solo España» y «Solo JJOO» como chips que se encienden y se apagan, igual
    que «Solo España» en Buscar. Con la cifra de lo que queda al lado: «45»
    españoles de 907 dice si merece la pena tocarlo.
  */
  const interruptores = (
    <>
      <ChipFiltro
        marcado={soloEspana}
        onClick={() => cambiarEspana(!soloEspana)}
        contador={tabla ? tabla.espanoles : undefined}
        detalle={tabla ? `de ${tabla.rows.length}` : undefined}
      >
        Solo España
      </ChipFiltro>
      {olimpica ? (
        <FiltroOlimpico
          activo={soloJjoo}
          onCambio={cambiarJjoo}
          cuantos={conJjoo.length}
          className={cn(clasesChip(soloJjoo), 'border-0 shadow-none')}
        />
      ) : null}
    </>
  );

  const quitables: Quitable[] = porEquipos
    ? [{ clave: 'formato', texto: 'Selecciones', etiqueta: 'Selecciones', onQuitar: () => cambiarFormato('INDIVIDUAL') }]
    : [];
  const activos = (porEquipos ? 1 : 0) + (soloEspana ? 1 : 0) + (soloJjoo ? 1 : 0);
  const restablecer = activos > 0 ? () => {
    if (soloEspana) cambiarEspana(false);
    if (jjooPedido) cambiarJjoo(false);
    if (porEquipos) cambiarFormato('INDIVIDUAL');
  } : null;

  return (
    <div className="ranking flex min-w-0 flex-col gap-3">
      <BarraFiltrosRanking
        grupos={gruposDelFormato}
        grupo={grupo}
        onElegir={elegir}
        busqueda={busqueda}
        onBuscar={buscar}
        etiquetaBusqueda={porEquipos ? 'Buscar un país' : 'Buscar un tirador'}
        chips={interruptores}
        quitables={quitables}
        activos={activos}
        onRestablecer={restablecer}
        resultados={`Ver ${filtradas.length} ${porEquipos ? (filtradas.length === 1 ? 'selección' : 'selecciones') : filtradas.length === 1 ? 'tirador' : 'tiradores'}`}
        antesEnHoja={
          <OpcionesFiltro
            titulo="Clasificación"
            valor={format}
            opciones={[
              { valor: 'INDIVIDUAL', etiqueta: 'Individual' },
              { valor: 'EQUIPOS', etiqueta: 'Selecciones' },
            ]}
            onCambio={(v) => cambiarFormato(v as FormatoClasificacion)}
          />
        }
      />

      {tabla ? (
        <Procedencia
          temporada={`Temporada ${tabla.season}`}
          leida={tabla.actualizadoEl ? formatDateEs(tabla.actualizadoEl) : null}
          url={tabla.sourceUrl}
        />
      ) : null}

      {tabla ? (
        <p role="status" className="sr-only">
          {filtradas.length}{' '}
          {porEquipos
            ? filtradas.length === 1 ? 'selección' : 'selecciones'
            : filtradas.length === 1 ? 'tirador' : 'tiradores'}
        </p>
      ) : null}

      {visibles.length > 0 ? (
        <ol
          aria-label={porEquipos ? 'Ranking internacional de selecciones' : 'Ranking internacional individual'}
          aria-busy={cargando || undefined}
          className={cn('grid w-full min-w-0 max-w-3xl gap-px overflow-hidden rounded-xl border bg-border transition-opacity duration-150', cargando && 'opacity-60')}
        >
          {visibles.map((fila) => {
            const mio = fila.athleteId !== null && mios.includes(fila.athleteId);
            return (
              <FilaLinea
                key={`${fila.fieId}-${fila.position ?? 'sc'}`}
                puesto={fila.position}
                nombre={porEquipos ? (fila.paisNombre ?? fila.pais ?? '—') : (fila.nombre ?? `FIE ${fila.fieId}`)}
                personaId={porEquipos ? null : (tabla?.personas[String(fila.fieId)] ?? null)}
                enlaceExterno={porEquipos ? null : fila.fichaUrl}
                pais={conBandera || porEquipos ? fila.pais : null}
                puntos={fila.points}
                mio={mio}
                resaltada={fila.pais === 'ESP'}
                sinRetrato={porEquipos}
                enlacePais={porEquipos}
                tras={anotacionDe(fila)?.estado ? (
                  <BurbujaOlimpica anotacion={anotacionDe(fila)} fechaRanking={olimpica?.fechaRanking ?? null} compacta className="shrink-0" />
                ) : undefined}
              />
            );
          })}
        </ol>
      ) : null}

      {filtradas.length === 0 && !cargando ? (
        <p className="medida text-sm text-muted-foreground">
          {busqueda
            ? 'Ningún nombre coincide. Prueba otro nombre o país.'
            : soloJjoo
              ? 'Nadie entra hoy ni está cerca de entrar en los Juegos.'
              : soloEspana
                ? 'Nadie de España en esta prueba.'
                : 'Sin clasificación internacional en esta prueba.'}
        </p>
      ) : null}

      {quedan > 0 ? (
        <VerMas onClick={() => setTope(tope + PASO)}>
          Ver {Math.min(quedan, PASO)} más
          <span className="cifra text-[12px] text-muted-foreground">de {filtradas.length}</span>
        </VerMas>
      ) : null}
    </div>
  );
}
