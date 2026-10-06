import { NOCS_NO_ELEGIBLES_POR_DEFECTO, REGLAS_LA2028 } from './reglas';
import { ZONAS_FIE, zonaDe, type ZonaFie } from './zonas';

/**
 * Quién iría a Los Ángeles 2028 si la clasificación se cerrara con el ranking
 * que se le pasa.
 *
 * Función pura: no lee la base ni la hora. Aplica las secciones D.1 (equipos)
 * y D.2 (AOR mundial y AOR por zona) del sistema oficial; los torneos zonales,
 * el anfitrión y la universalidad se informan pero no se pueden calcular
 * (ver `docs/clasificacion-olimpica-la2028.md`).
 *
 * Orden y empates: el documento no define desempates, así que manda el puesto
 * publicado por la FIE y, a igualdad de puesto, más puntos primero; si aún
 * empatan, el orden de entrada. Los tramos («5.º a 24.º») se cuentan sobre ese
 * orden, una vez quitados los CON no elegibles. Un empate en el límite de una
 * plaza se marca en el primero que se queda fuera (`empate: true`).
 */

export type ArmaOlimpica = 'FLORETE' | 'ESPADA' | 'SABLE';
export type GeneroOlimpico = 'M' | 'F';

export type FilaEquipoFie = {
  noc: string | null;
  posicion: number | null;
  puntos: number | null;
};

export type FilaIndividualFie = {
  fieId: number;
  nombre: string;
  noc: string | null;
  posicion: number | null;
  puntos: number | null;
};

export type EntradaPrueba = {
  arma: ArmaOlimpica;
  genero: GeneroOlimpico;
  /** ISO (fecha u hora) del ranking usado; se devuelve tal cual. */
  fechaRanking: string | null;
  equipos: readonly FilaEquipoFie[];
  individual: readonly FilaIndividualFie[];
};

export type OpcionesClasificacion = {
  /** CON que no pueden clasificar (suspendidos, neutrales…). */
  nocsNoElegibles?: readonly string[];
  /** CON cuyo estado se quiere con detalle (por defecto, España). */
  nocsSeguidos?: readonly string[];
};

export type EquipoRankeado = {
  noc: string;
  zona: ZonaFie | null;
  posicion: number;
  puntos: number;
  /** Puesto efectivo (1, 2, 3…) tras ordenar y quitar no elegibles. */
  orden: number;
};

/**
 * TOP: entre los 4 primeros. ZONA: mejor de su zona entre el 5.º y el 24.º.
 * SIGUIENTE: hereda la plaza de una zona sin equipo en ese tramo.
 */
export type ViaEquipo = 'TOP' | 'ZONA' | 'SIGUIENTE';

export type EquipoClasificado = EquipoRankeado & {
  via: ViaEquipo;
  /** La plaza de zona que ocupa (ZONA y SIGUIENTE); `null` en TOP. */
  plazaDeZona: ZonaFie | null;
};

export type TiradorRankeado = {
  fieId: number;
  nombre: string;
  noc: string;
  zona: ZonaFie | null;
  posicion: number;
  puntos: number;
};

export type ViaIndividual = 'AOR' | 'AOR_ZONA';

export type TiradorClasificado = TiradorRankeado & {
  via: ViaIndividual;
  zonaPlaza: ZonaFie | null;
};

export type Referencia = {
  noc: string;
  /** Nombre del tirador; `null` en equipos. */
  nombre: string | null;
  posicion: number;
  puntos: number;
};

export type PrimerFuera = Referencia & {
  zona: ZonaFie | null;
  /** Contra quién se mide: el último que entra por ese camino. */
  contra: Referencia;
  /** Puntos que le faltan para igualar a `contra` (0 = empatado). */
  diferencia: number;
  empate: boolean;
};

export type CaminoNoc = 'EQUIPO_TOP' | 'EQUIPO_ZONA' | 'EQUIPO_SIGUIENTE' | 'AOR' | 'AOR_ZONA';

export type Distancia = {
  camino: CaminoNoc;
  diferencia: number;
  contra: Referencia;
};

export type EstadoNoc = {
  noc: string;
  zona: ZonaFie | null;
  equipo: EquipoClasificado | null;
  individual: TiradorClasificado | null;
  /** Tiradores que tendría en el individual (3 con equipo, 1 sin él, o 0). */
  tiradores: number;
  /** Su equipo en el ranking, aunque no entre. */
  equipoRanking: EquipoRankeado | null;
  /** Su mejor tirador en el AOR (si no tiene equipo dentro). */
  mejorAor: TiradorRankeado | null;
  /** Lo que le falta al equipo por su camino más corto. */
  distanciaEquipo: Distancia | null;
  /** Lo que le falta a su mejor tirador por su camino más corto. */
  distanciaIndividual: Distancia | null;
};

export type ResultadoPrueba = {
  arma: ArmaOlimpica;
  genero: GeneroOlimpico;
  fechaRanking: string | null;
  equipos: EquipoClasificado[];
  /** Los tres mejor clasificados de cada CON con equipo (los elige el CON). */
  porEquipo: { noc: string; tiradores: TiradorRankeado[] }[];
  aorMundial: TiradorClasificado[];
  aorZona: Record<ZonaFie, TiradorClasificado | null>;
  primerFuera: {
    /** El 5.º, que se queda a las puertas de los cuatro primeros. */
    equiposTop: PrimerFuera | null;
    equiposZona: Record<ZonaFie, PrimerFuera | null>;
    /** El mejor equipo que se queda sin plaza por ningún camino. */
    equipos: PrimerFuera | null;
    aorMundial: PrimerFuera | null;
    aorZona: Record<ZonaFie, PrimerFuera | null>;
  };
  /** Zonas sin equipo entre el 5.º y el 24.º (su plaza pasa al siguiente). */
  zonasSinEquipo: ZonaFie[];
  anfitrion: { noc: string; conEquipo: boolean; individuales: number };
  /** Tiradores por CON en el individual de esta prueba. */
  plazasPorNoc: Record<string, number>;
  plazasTorneoZonal: number;
  seguidos: Record<string, EstadoNoc>;
};

const redondear = (n: number) => Math.round(n * 1000) / 1000;

function normalizarNoc(noc: string | null | undefined): string | null {
  const v = noc?.trim().toUpperCase();
  return v ? v : null;
}

function porZona<T>(valor: () => T): Record<ZonaFie, T> {
  return {
    EUROPA: valor(),
    ASIA_OCEANIA: valor(),
    AMERICA: valor(),
    AFRICA: valor(),
  };
}

function ordenarRanking<T extends { posicion: number; puntos: number }>(filas: T[]): T[] {
  return filas
    .map((f, i) => ({ f, i }))
    .sort((a, b) => a.f.posicion - b.f.posicion || b.f.puntos - a.f.puntos || a.i - b.i)
    .map(({ f }) => f);
}

function referenciaEquipo(e: EquipoRankeado): Referencia {
  return { noc: e.noc, nombre: null, posicion: e.posicion, puntos: e.puntos };
}

function referenciaTirador(t: TiradorRankeado): Referencia {
  return { noc: t.noc, nombre: t.nombre, posicion: t.posicion, puntos: t.puntos };
}

function primerFuera(
  candidato: Referencia & { zona: ZonaFie | null },
  contra: Referencia,
): PrimerFuera {
  const diferencia = redondear(Math.max(0, contra.puntos - candidato.puntos));
  return {
    noc: candidato.noc,
    nombre: candidato.nombre,
    posicion: candidato.posicion,
    puntos: candidato.puntos,
    zona: candidato.zona,
    contra,
    diferencia,
    empate: diferencia === 0,
  };
}

function masCorta(opciones: (Distancia | null)[]): Distancia | null {
  let mejor: Distancia | null = null;
  for (const o of opciones) {
    if (o && (!mejor || o.diferencia < mejor.diferencia)) mejor = o;
  }
  return mejor;
}

export function calcularClasificacionOlimpica(
  entrada: EntradaPrueba,
  opciones: OpcionesClasificacion = {},
): ResultadoPrueba {
  return calcularDetalleOlimpico(entrada, opciones).resultado;
}

/** El resultado y las listas ordenadas de las que sale (para anotar filas). */
export type DetalleOlimpico = {
  resultado: ResultadoPrueba;
  /** Ranking por equipos tras quitar no elegibles, con su puesto efectivo. */
  equipos: EquipoRankeado[];
  /** Ranking individual elegible, ordenado. */
  individual: TiradorRankeado[];
  /** AOR: sin CON con equipo y un solo tirador por CON. */
  aor: TiradorRankeado[];
};

export function calcularDetalleOlimpico(
  entrada: EntradaPrueba,
  opciones: OpcionesClasificacion = {},
): DetalleOlimpico {
  const R = REGLAS_LA2028;
  const noElegibles = new Set(
    (opciones.nocsNoElegibles ?? NOCS_NO_ELEGIBLES_POR_DEFECTO).map((n) => n.toUpperCase()),
  );
  const seguidos = (opciones.nocsSeguidos ?? ['ESP']).map((n) => n.toUpperCase());

  // ------------------------------------------------------------ Equipos ---
  const vistosEquipo = new Set<string>();
  const equiposValidos: Omit<EquipoRankeado, 'orden'>[] = [];
  for (const f of entrada.equipos) {
    const noc = normalizarNoc(f.noc);
    if (!noc || f.posicion === null || noElegibles.has(noc)) continue;
    equiposValidos.push({ noc, zona: zonaDe(noc), posicion: f.posicion, puntos: f.puntos ?? 0 });
  }
  const equipos: EquipoRankeado[] = [];
  for (const e of ordenarRanking(equiposValidos)) {
    // Un CON solo tiene un equipo: si la fuente lo repitiera, vale el mejor.
    if (vistosEquipo.has(e.noc)) continue;
    vistosEquipo.add(e.noc);
    equipos.push({ ...e, orden: equipos.length + 1 });
  }

  const clasificados = new Map<string, EquipoClasificado>();
  for (const e of equipos.slice(0, R.equiposTop)) {
    clasificados.set(e.noc, { ...e, via: 'TOP', plazaDeZona: null });
  }

  const enTramo = (e: EquipoRankeado) =>
    e.orden >= R.tramoZonaEquipos.desde && e.orden <= R.tramoZonaEquipos.hasta;

  const zonasSinEquipo: ZonaFie[] = [];
  const ganadorZona = porZona<EquipoClasificado | null>(() => null);
  for (const zona of ZONAS_FIE) {
    const e = equipos.find((x) => x.zona === zona && enTramo(x) && !clasificados.has(x.noc));
    if (e) {
      const c: EquipoClasificado = { ...e, via: 'ZONA', plazaDeZona: zona };
      clasificados.set(e.noc, c);
      ganadorZona[zona] = c;
    } else {
      zonasSinEquipo.push(zona);
    }
  }

  const herederos: EquipoClasificado[] = [];
  for (const zona of zonasSinEquipo) {
    const e = equipos.find((x) => !clasificados.has(x.noc));
    if (!e) break;
    const c: EquipoClasificado = { ...e, via: 'SIGUIENTE', plazaDeZona: zona };
    clasificados.set(e.noc, c);
    herederos.push(c);
  }

  const equiposDentro = [...clasificados.values()].sort((a, b) => a.orden - b.orden);
  const fuera = equipos.filter((e) => !clasificados.has(e.noc));
  const ultimoTop = equipos[R.equiposTop - 1] ?? null;
  const ultimoTramo = equipos[R.tramoZonaEquipos.hasta - 1] ?? null;

  /** Lo que le falta a un equipo de fuera por cada camino, y el más corto. */
  const distanciaDeEquipo = (e: EquipoRankeado): Distancia | null => {
    const caminos: (Distancia | null)[] = [];
    if (ultimoTop) {
      caminos.push({
        camino: 'EQUIPO_TOP',
        diferencia: redondear(Math.max(0, ultimoTop.puntos - e.puntos)),
        contra: referenciaEquipo(ultimoTop),
      });
    }
    const zonaGanador = e.zona ? ganadorZona[e.zona] : null;
    if (zonaGanador) {
      caminos.push({
        camino: 'EQUIPO_ZONA',
        diferencia: redondear(Math.max(0, zonaGanador.puntos - e.puntos)),
        contra: referenciaEquipo(zonaGanador),
      });
    } else if (e.zona && ultimoTramo) {
      // Su zona no tiene a nadie en el tramo: le basta con entrar en él.
      caminos.push({
        camino: 'EQUIPO_ZONA',
        diferencia: redondear(Math.max(0, ultimoTramo.puntos - e.puntos)),
        contra: referenciaEquipo(ultimoTramo),
      });
    }
    const ultimoHeredero = herederos.at(-1);
    if (ultimoHeredero) {
      caminos.push({
        camino: 'EQUIPO_SIGUIENTE',
        diferencia: redondear(Math.max(0, ultimoHeredero.puntos - e.puntos)),
        contra: referenciaEquipo(ultimoHeredero),
      });
    }
    return masCorta(caminos);
  };

  const quintoEquipo = equipos[R.equiposTop] ?? null;
  const fueraTop =
    quintoEquipo && ultimoTop
      ? primerFuera({ ...referenciaEquipo(quintoEquipo), zona: quintoEquipo.zona }, referenciaEquipo(ultimoTop))
      : null;

  const fueraZona = porZona<PrimerFuera | null>(() => null);
  for (const zona of ZONAS_FIE) {
    const cand = fuera.find((e) => e.zona === zona);
    if (!cand) continue;
    const contra = ganadorZona[zona] ?? ultimoTramo;
    if (!contra) continue;
    fueraZona[zona] = primerFuera({ ...referenciaEquipo(cand), zona }, referenciaEquipo(contra));
  }

  const primerEquipoFuera = fuera[0] ?? null;
  const distanciaPrimero = primerEquipoFuera ? distanciaDeEquipo(primerEquipoFuera) : null;
  const fueraEquipos =
    primerEquipoFuera && distanciaPrimero
      ? primerFuera(
          { ...referenciaEquipo(primerEquipoFuera), zona: primerEquipoFuera.zona },
          distanciaPrimero.contra,
        )
      : null;

  // --------------------------------------------------------- Individual ---
  const nocsConEquipo = new Set(clasificados.keys());
  const individualesValidos: TiradorRankeado[] = [];
  for (const f of entrada.individual) {
    const noc = normalizarNoc(f.noc);
    if (!noc || f.posicion === null || noElegibles.has(noc)) continue;
    individualesValidos.push({
      fieId: f.fieId,
      nombre: f.nombre,
      noc,
      zona: zonaDe(noc),
      posicion: f.posicion,
      puntos: f.puntos ?? 0,
    });
  }
  const individualOrdenado = ordenarRanking(individualesValidos);

  const porEquipo = equiposDentro.map((e) => ({
    noc: e.noc,
    tiradores: individualOrdenado.filter((t) => t.noc === e.noc).slice(0, R.tiradoresPorEquipo),
  }));

  // AOR: fuera los CON con equipo; de los demás, solo el mejor de cada uno.
  const aor: TiradorRankeado[] = [];
  const nocsEnAor = new Set<string>();
  for (const t of individualOrdenado) {
    if (nocsConEquipo.has(t.noc) || nocsEnAor.has(t.noc)) continue;
    nocsEnAor.add(t.noc);
    aor.push(t);
  }

  const aorMundial: TiradorClasificado[] = aor
    .slice(0, R.plazasAorMundial)
    .map((t) => ({ ...t, via: 'AOR', zonaPlaza: null }));
  const nocsAorMundial = new Set(aorMundial.map((t) => t.noc));

  const aorZona = porZona<TiradorClasificado | null>(() => null);
  const fueraAorZona = porZona<PrimerFuera | null>(() => null);
  for (const zona of ZONAS_FIE) {
    const deLaZona = aor.filter((t) => t.zona === zona && !nocsAorMundial.has(t.noc));
    const q = deLaZona[0];
    if (!q) continue;
    aorZona[zona] = { ...q, via: 'AOR_ZONA', zonaPlaza: zona };
    const siguiente = deLaZona[1];
    if (siguiente) {
      fueraAorZona[zona] = primerFuera({ ...referenciaTirador(siguiente), zona }, referenciaTirador(q));
    }
  }

  const terceroAor = aor[R.plazasAorMundial] ?? null;
  const ultimoAorMundial = aorMundial.at(-1) ?? null;
  const fueraAorMundial =
    terceroAor && ultimoAorMundial
      ? primerFuera({ ...referenciaTirador(terceroAor), zona: terceroAor.zona }, referenciaTirador(ultimoAorMundial))
      : null;

  // ------------------------------------------------------------ Totales ---
  const plazasPorNoc: Record<string, number> = {};
  for (const e of equiposDentro) plazasPorNoc[e.noc] = R.tiradoresPorEquipo;
  const individualesDentro = [
    ...aorMundial,
    ...ZONAS_FIE.map((z) => aorZona[z]).filter((t): t is TiradorClasificado => t !== null),
  ];
  for (const t of individualesDentro) plazasPorNoc[t.noc] = (plazasPorNoc[t.noc] ?? 0) + 1;

  const anfitrion = {
    noc: R.anfitrion,
    conEquipo: clasificados.has(R.anfitrion),
    individuales: plazasPorNoc[R.anfitrion] ?? 0,
  };

  const estados: Record<string, EstadoNoc> = {};
  for (const noc of seguidos) {
    const equipo = clasificados.get(noc) ?? null;
    const individual = individualesDentro.find((t) => t.noc === noc) ?? null;
    const equipoRanking = equipos.find((e) => e.noc === noc) ?? null;
    const mejorAor = equipo ? null : (aor.find((t) => t.noc === noc) ?? null);

    let distanciaIndividual: Distancia | null = null;
    if (!equipo && !individual && mejorAor) {
      const zonaQ = mejorAor.zona ? aorZona[mejorAor.zona] : null;
      distanciaIndividual = masCorta([
        ultimoAorMundial
          ? {
              camino: 'AOR',
              diferencia: redondear(Math.max(0, ultimoAorMundial.puntos - mejorAor.puntos)),
              contra: referenciaTirador(ultimoAorMundial),
            }
          : null,
        zonaQ
          ? {
              camino: 'AOR_ZONA',
              diferencia: redondear(Math.max(0, zonaQ.puntos - mejorAor.puntos)),
              contra: referenciaTirador(zonaQ),
            }
          : null,
      ]);
    }

    estados[noc] = {
      noc,
      zona: zonaDe(noc),
      equipo,
      individual,
      tiradores: plazasPorNoc[noc] ?? 0,
      equipoRanking,
      mejorAor,
      distanciaEquipo: !equipo && equipoRanking ? distanciaDeEquipo(equipoRanking) : null,
      distanciaIndividual,
    };
  }

  const resultado: ResultadoPrueba = {
    arma: entrada.arma,
    genero: entrada.genero,
    fechaRanking: entrada.fechaRanking,
    equipos: equiposDentro,
    porEquipo,
    aorMundial,
    aorZona,
    primerFuera: {
      equiposTop: fueraTop,
      equiposZona: fueraZona,
      equipos: fueraEquipos,
      aorMundial: fueraAorMundial,
      aorZona: fueraAorZona,
    },
    zonasSinEquipo,
    anfitrion,
    plazasPorNoc,
    plazasTorneoZonal: ZONAS_FIE.length * R.plazasTorneoZonalPorZona,
    seguidos: estados,
  };
  return { resultado, equipos, individual: individualOrdenado, aor };
}

const ORDEN_ARMAS: readonly ArmaOlimpica[] = ['FLORETE', 'ESPADA', 'SABLE'];
const ORDEN_GENEROS: readonly GeneroOlimpico[] = ['F', 'M'];

/** Las pruebas en orden fijo (florete, espada, sable; femenino primero). */
export function calcularClasificacionesOlimpicas(
  entradas: readonly EntradaPrueba[],
  opciones: OpcionesClasificacion = {},
): ResultadoPrueba[] {
  return [...entradas]
    .sort(
      (a, b) =>
        ORDEN_ARMAS.indexOf(a.arma) - ORDEN_ARMAS.indexOf(b.arma) ||
        ORDEN_GENEROS.indexOf(a.genero) - ORDEN_GENEROS.indexOf(b.genero),
    )
    .map((e) => calcularClasificacionOlimpica(e, opciones));
}
