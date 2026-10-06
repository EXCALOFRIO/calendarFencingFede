import {
  calcularDetalleOlimpico,
  type DetalleOlimpico,
  type EntradaPrueba,
  type EquipoRankeado,
  type PrimerFuera,
  type Referencia,
  type TiradorRankeado,
} from './calcular';
import { PENDIENTES_LA2028, REGLAS_LA2028, type MotivoPendiente } from './reglas';
import type { ZonaFie } from './zonas';

/**
 * La marca olímpica de CADA fila del ranking internacional (FIE sénior).
 *
 *   clasificado  entra hoy por algún camino.
 *   cerca        está entre los `cercanos` primeros que se quedan fuera de un
 *                camino; se da el más corto (menos puntos que le faltan).
 *   pendiente    RUS, BLR y neutrales: se enseñan pero no ocupan plaza.
 *   null         nada que enseñar (puede llevar `camino: 'TORNEO_ZONAL'`, que
 *                es la vía que le queda, sin diferencia que medir).
 *
 * Las diferencias de los caminos por equipos se miden en puntos del ranking
 * por equipos; las individuales, en puntos del ranking individual.
 */

export type EstadoOlimpico = 'clasificado' | 'cerca' | 'pendiente';

export type CaminoOlimpico =
  | 'EQUIPO_TOP'
  | 'EQUIPO_ZONA'
  | 'EQUIPO_SIGUIENTE'
  | 'POR_EQUIPO'
  | 'AOR'
  | 'AOR_ZONA'
  | 'ANFITRION'
  | 'TORNEO_ZONAL';

export type AnotacionOlimpica = {
  estado: EstadoOlimpico | null;
  camino: CaminoOlimpico | null;
  /** Zona de la plaza (caminos de zona y torneo zonal). */
  zona: ZonaFie | null;
  /** «cerca»: a quién tiene que pasar. */
  contra: Referencia | null;
  /** «cerca»: puntos que le faltan para igualar a `contra`. */
  faltan: number | null;
  /** Puntos de ventaja sobre `sobre` (el siguiente por detrás en ese camino). */
  margen: number | null;
  sobre: Referencia | null;
  /** «cerca»: 1 = primero que se queda fuera de ese camino. */
  puestoFuera: number | null;
  /** «pendiente»: por qué no cuenta. */
  motivo: MotivoPendiente | null;
  /** «pendiente»: lo que tendría si contara. */
  sinVeto: { estado: 'clasificado' | 'cerca'; camino: CaminoOlimpico; zona: ZonaFie | null } | null;
};

export type AnotacionesPrueba = {
  arma: EntradaPrueba['arma'];
  genero: EntradaPrueba['genero'];
  fechaRanking: string | null;
  /** Por código de país (filas de selecciones). */
  equipos: Record<string, AnotacionOlimpica>;
  /** Por `fieId` del tirador, como texto. */
  individual: Record<string, AnotacionOlimpica>;
};

export type OpcionesAnotacion = {
  /** Cuántos de los primeros fuera de cada camino cuentan como «cerca». */
  cercanos?: number;
  pendientes?: Readonly<Record<string, MotivoPendiente>>;
};

const redondear = (n: number) => Math.round(n * 1000) / 1000;

const VACIA: AnotacionOlimpica = {
  estado: null,
  camino: null,
  zona: null,
  contra: null,
  faltan: null,
  margen: null,
  sobre: null,
  puestoFuera: null,
  motivo: null,
  sinVeto: null,
};

function anotacion(parcial: Partial<AnotacionOlimpica>): AnotacionOlimpica {
  return { ...VACIA, ...parcial };
}

const refEquipo = (e: EquipoRankeado): Referencia => ({
  noc: e.noc,
  nombre: null,
  posicion: e.posicion,
  puntos: e.puntos,
});

const refTirador = (t: TiradorRankeado): Referencia => ({
  noc: t.noc,
  nombre: t.nombre,
  posicion: t.posicion,
  puntos: t.puntos,
});

function margenSobre(puntos: number, pf: PrimerFuera | null) {
  if (!pf) return { margen: null, sobre: null };
  const sobre: Referencia = { noc: pf.noc, nombre: pf.nombre, posicion: pf.posicion, puntos: pf.puntos };
  return { margen: redondear(Math.max(0, puntos - pf.puntos)), sobre };
}

type Candidato = {
  camino: CaminoOlimpico;
  zona: ZonaFie | null;
  contra: Referencia;
  faltan: number;
  puestoFuera: number;
  siguiente: Referencia | null;
  puntos: number;
};

/** De una lista de los que están fuera, el candidato si está entre los N primeros. */
function enLista<T extends { puntos: number }>(
  lista: T[],
  indice: number,
  cercanos: number,
  ref: (x: T) => Referencia,
  base: Omit<Candidato, 'faltan' | 'puestoFuera' | 'siguiente' | 'puntos'>,
): Candidato | null {
  if (indice < 0 || indice >= cercanos) return null;
  const yo = lista[indice];
  const siguiente = lista[indice + 1];
  return {
    ...base,
    faltan: redondear(Math.max(0, base.contra.puntos - yo.puntos)),
    puestoFuera: indice + 1,
    siguiente: siguiente ? ref(siguiente) : null,
    puntos: yo.puntos,
  };
}

function mejor(candidatos: (Candidato | null)[]): Candidato | null {
  let m: Candidato | null = null;
  for (const c of candidatos) if (c && (!m || c.faltan < m.faltan)) m = c;
  return m;
}

function deCandidato(c: Candidato): AnotacionOlimpica {
  return anotacion({
    estado: 'cerca',
    camino: c.camino,
    zona: c.zona,
    contra: c.contra,
    faltan: c.faltan,
    puestoFuera: c.puestoFuera,
    margen: c.siguiente ? redondear(Math.max(0, c.puntos - c.siguiente.puntos)) : null,
    sobre: c.siguiente,
  });
}

function anotarNucleo(d: DetalleOlimpico, cercanos: number) {
  const R = REGLAS_LA2028;
  const r = d.resultado;
  const equipos: Record<string, AnotacionOlimpica> = {};
  const individual: Record<string, AnotacionOlimpica> = {};

  // ------------------------------------------------------------ Equipos ---
  const dentro = new Map(r.equipos.map((e) => [e.noc, e]));
  const fuera = d.equipos.filter((e) => !dentro.has(e.noc));
  const ultimoTop = d.equipos[R.equiposTop - 1] ?? null;
  const ultimoTramo = d.equipos[R.tramoZonaEquipos.hasta - 1] ?? null;
  const herederos = r.equipos.filter((e) => e.via === 'SIGUIENTE');
  const ganadorZona = (z: ZonaFie) =>
    r.equipos.find((e) => e.via === 'ZONA' && e.plazaDeZona === z) ?? null;

  for (const e of r.equipos) {
    const pf =
      e.via === 'TOP'
        ? r.primerFuera.equiposTop
        : e.via === 'ZONA' && e.plazaDeZona
          ? r.primerFuera.equiposZona[e.plazaDeZona]
          : r.primerFuera.equipos;
    equipos[e.noc] = anotacion({
      estado: 'clasificado',
      camino: e.via === 'TOP' ? 'EQUIPO_TOP' : e.via === 'ZONA' ? 'EQUIPO_ZONA' : 'EQUIPO_SIGUIENTE',
      zona: e.plazaDeZona,
      ...margenSobre(e.puntos, pf),
    });
  }

  fuera.forEach((e, i) => {
    const deSuZona = e.zona ? fuera.filter((x) => x.zona === e.zona) : [];
    const contraZona = e.zona ? (ganadorZona(e.zona) ?? ultimoTramo) : null;
    const c = mejor([
      ultimoTop
        ? enLista(fuera, i, cercanos, refEquipo, { camino: 'EQUIPO_TOP', zona: null, contra: refEquipo(ultimoTop) })
        : null,
      e.zona && contraZona
        ? enLista(deSuZona, deSuZona.indexOf(e), cercanos, refEquipo, {
            camino: 'EQUIPO_ZONA',
            zona: e.zona,
            contra: refEquipo(contraZona),
          })
        : null,
      herederos.length > 0
        ? enLista(fuera, i, cercanos, refEquipo, {
            camino: 'EQUIPO_SIGUIENTE',
            zona: herederos.at(-1)?.plazaDeZona ?? null,
            contra: refEquipo(herederos.at(-1) as EquipoRankeado),
          })
        : null,
    ]);
    if (c) equipos[e.noc] = deCandidato(c);
    else if (e.noc === R.anfitrion) equipos[e.noc] = anotacion({ estado: 'cerca', camino: 'ANFITRION' });
  });

  // --------------------------------------------------------- Individual ---
  const tresPorNoc = new Map(r.porEquipo.map((p) => [p.noc, new Set(p.tiradores.map((t) => t.fieId))]));
  const clasificadosInd = new Map<number, { camino: CaminoOlimpico; zona: ZonaFie | null; pf: PrimerFuera | null }>();
  for (const t of r.aorMundial) {
    clasificadosInd.set(t.fieId, { camino: 'AOR', zona: null, pf: r.primerFuera.aorMundial });
  }
  for (const [z, t] of Object.entries(r.aorZona) as [ZonaFie, typeof r.aorMundial[number] | null][]) {
    if (t) clasificadosInd.set(t.fieId, { camino: 'AOR_ZONA', zona: z, pf: r.primerFuera.aorZona[z] });
  }
  const fueraAor = d.aor.filter((t) => !clasificadosInd.has(t.fieId));
  const representante = new Set(d.aor.map((t) => t.fieId));
  const ultimoAor = r.aorMundial.at(-1) ?? null;
  const mejoresDeSuNoc = new Map<string, Set<number>>();
  for (const t of d.individual) {
    const s = mejoresDeSuNoc.get(t.noc) ?? new Set<number>();
    if (s.size < R.tiradoresPorEquipo) s.add(t.fieId);
    mejoresDeSuNoc.set(t.noc, s);
  }

  for (const t of d.individual) {
    const clave = String(t.fieId);
    const delEquipo = tresPorNoc.get(t.noc);
    if (delEquipo) {
      if (delEquipo.has(t.fieId)) {
        const eq = equipos[t.noc];
        individual[clave] = anotacion({
          estado: 'clasificado',
          camino: 'POR_EQUIPO',
          margen: eq?.margen ?? null,
          sobre: eq?.sobre ?? null,
        });
      }
      continue;
    }
    const q = clasificadosInd.get(t.fieId);
    if (q) {
      individual[clave] = anotacion({
        estado: 'clasificado',
        camino: q.camino,
        zona: q.zona,
        ...margenSobre(t.puntos, q.pf),
      });
      continue;
    }
    // Su CON ya tiene plaza en esta arma con otro tirador: no hay camino.
    if ((r.plazasPorNoc[t.noc] ?? 0) > 0) continue;

    const candidatos: (Candidato | null)[] = [];
    if (representante.has(t.fieId)) {
      if (ultimoAor) {
        candidatos.push(
          enLista(fueraAor, fueraAor.indexOf(t), cercanos, refTirador, {
            camino: 'AOR',
            zona: null,
            contra: refTirador(ultimoAor),
          }),
        );
      }
      const qz = t.zona ? r.aorZona[t.zona] : null;
      if (t.zona && qz) {
        const deSuZona = fueraAor.filter((x) => x.zona === t.zona);
        candidatos.push(
          enLista(deSuZona, deSuZona.indexOf(t), cercanos, refTirador, {
            camino: 'AOR_ZONA',
            zona: t.zona,
            contra: refTirador(qz),
          }),
        );
      }
    }
    const c = mejor(candidatos);
    const eq = equipos[t.noc];
    const porEquipoCerca =
      eq?.estado === 'cerca' &&
      eq.camino !== 'ANFITRION' &&
      (mejoresDeSuNoc.get(t.noc)?.has(t.fieId) ?? false);

    if (c && (!porEquipoCerca || (eq.faltan ?? Infinity) >= c.faltan)) {
      individual[clave] = deCandidato(c);
    } else if (porEquipoCerca) {
      individual[clave] = anotacion({
        estado: 'cerca',
        camino: 'POR_EQUIPO',
        zona: eq.zona,
        contra: eq.contra,
        faltan: eq.faltan,
        margen: eq.margen,
        sobre: eq.sobre,
        puestoFuera: eq.puestoFuera,
      });
    } else if (t.noc === R.anfitrion) {
      individual[clave] = anotacion({ estado: 'cerca', camino: 'ANFITRION' });
    } else if (t.zona) {
      individual[clave] = anotacion({ camino: 'TORNEO_ZONAL', zona: t.zona });
    }
  }

  return { equipos, individual };
}

export function anotarRankingOlimpico(
  entrada: EntradaPrueba,
  opciones: OpcionesAnotacion = {},
): AnotacionesPrueba {
  const cercanos = Math.max(0, opciones.cercanos ?? 3);
  const pendientes = opciones.pendientes ?? PENDIENTES_LA2028;
  const nocsPendientes = Object.keys(pendientes);

  const nucleo = anotarNucleo(
    calcularDetalleOlimpico(entrada, { nocsNoElegibles: nocsPendientes, nocsSeguidos: [] }),
    cercanos,
  );

  const vetados = (noc: string | null) => {
    const n = noc?.trim().toUpperCase();
    return n && pendientes[n] ? { noc: n, motivo: pendientes[n] } : null;
  };
  const hayVetados =
    entrada.equipos.some((f) => vetados(f.noc)?.motivo === 'PARTICIPACION_SIN_DECIDIR') ||
    entrada.individual.some((f) => vetados(f.noc)?.motivo === 'PARTICIPACION_SIN_DECIDIR');

  // Lo que tendrían RUS/BLR si contaran: mismo cálculo sin vetarlos.
  const sinVeto = hayVetados
    ? anotarNucleo(
        calcularDetalleOlimpico(entrada, {
          nocsNoElegibles: nocsPendientes.filter((n) => pendientes[n] === 'NEUTRAL'),
          nocsSeguidos: [],
        }),
        cercanos,
      )
    : null;

  const deSinVeto = (a: AnotacionOlimpica | undefined): AnotacionOlimpica['sinVeto'] =>
    a && a.camino && (a.estado === 'clasificado' || a.estado === 'cerca')
      ? { estado: a.estado, camino: a.camino, zona: a.zona }
      : null;

  for (const f of entrada.equipos) {
    const v = f.posicion === null ? null : vetados(f.noc);
    if (!v) continue;
    nucleo.equipos[v.noc] = anotacion({
      estado: 'pendiente',
      motivo: v.motivo,
      sinVeto: deSinVeto(sinVeto?.equipos[v.noc]),
    });
  }
  for (const f of entrada.individual) {
    const v = f.posicion === null ? null : vetados(f.noc);
    if (!v) continue;
    const clave = String(f.fieId);
    nucleo.individual[clave] = anotacion({
      estado: 'pendiente',
      motivo: v.motivo,
      sinVeto: deSinVeto(sinVeto?.individual[clave]),
    });
  }

  return {
    arma: entrada.arma,
    genero: entrada.genero,
    fechaRanking: entrada.fechaRanking,
    equipos: nucleo.equipos,
    individual: nucleo.individual,
  };
}

/**
 * Orden con «Solo JJOO» encendido: primero los clasificados por puesto; luego
 * los «cerca», de más a menos probable (menos puntos que faltan; a igualdad,
 * mejor puesto; sin diferencia medible, al final de ellos); y al final los
 * «pendiente» que entrarían o estarían cerca si contaran. El resto no sale.
 */
export function ordenarSoloJjoo<T>(
  filas: readonly T[],
  datos: (fila: T) => { anotacion: AnotacionOlimpica | null | undefined; posicion: number | null },
): T[] {
  const grupo = (a: AnotacionOlimpica | null | undefined): number | null => {
    if (!a) return null;
    if (a.estado === 'clasificado') return 0;
    if (a.estado === 'cerca') return 1;
    if (a.estado === 'pendiente' && a.sinVeto) return 2;
    return null;
  };
  const pos = (p: number | null) => p ?? Number.MAX_SAFE_INTEGER;
  return filas
    .map((f, i) => ({ f, i, d: datos(f) }))
    .map((x) => ({ ...x, g: grupo(x.d.anotacion) }))
    .filter((x): x is typeof x & { g: number } => x.g !== null)
    .sort((a, b) => {
      if (a.g !== b.g) return a.g - b.g;
      if (a.g === 1) {
        const fa = a.d.anotacion?.faltan ?? Number.POSITIVE_INFINITY;
        const fb = b.d.anotacion?.faltan ?? Number.POSITIVE_INFINITY;
        if (fa !== fb) return fa - fb;
      }
      return pos(a.d.posicion) - pos(b.d.posicion) || a.i - b.i;
    })
    .map((x) => x.f);
}
