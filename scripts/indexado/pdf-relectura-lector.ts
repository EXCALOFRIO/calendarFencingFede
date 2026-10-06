/**
 * Relectura de un PDF RFEE (Engarde) con el lector local y una segunda pasada
 * para los nombres que el lector no atribuye.
 *
 * Poules y cuadro truncan los nombres a su columna: «FERNÀNDEZ HERN» encaja con
 * «FERNÀNDEZ HERNÀNDEZ Erik» y con «FERNÀNDEZ HERNÀNDEZ Alan», y el lector descarta
 * esos asaltos (`identidadNoConfirmada`). Aquí, por cada grupo de nombres
 * confundibles de la clasificación, se vuelve a leer con el grupo como un solo
 * participante y se asigna cada aparición a un miembro con lo que el propio
 * documento obliga:
 *  - cuadro: quien pierde en la ronda de S tiene puesto final en (S/2, S]; quien
 *    gana, puesto ≤ S/2; nadie tira dos veces en la misma ronda ni después de perder;
 *    entre los que pierden en la misma ronda, el de mejor siembra tiene mejor puesto
 *    (la siembra es el número de la primera columna de la página del cuadro);
 *  - poules: cada tirador está en una sola poule por vuelta; la fila con el mismo
 *    número de siembra (clasificación tras poules) que una aparición del cuadro ya
 *    asignada es la de ese tirador.
 * Una aparición que no queda determinada se descarta: nunca se elige al azar.
 */
import { AcumuladorAsaltos, exclusionesVacias } from '../../src/lib/ingest/sources/rfee-pdf/asaltos';
import { dividirPaginaPorPruebas } from '../../src/lib/ingest/sources/rfee-pdf/bloques';
import { claveRonda, leerCuadro } from '../../src/lib/ingest/sources/rfee-pdf/cuadro';
import { compatibles, normalizar } from '../../src/lib/ingest/sources/rfee-pdf/geometria';
import type { Participante } from '../../src/lib/ingest/sources/rfee-pdf/identidad';
import { analizarPagina, esItemRonda, type PaginaAnalizada } from '../../src/lib/ingest/sources/rfee-pdf/paginas';
import { leerPoules } from '../../src/lib/ingest/sources/rfee-pdf/poules';
import { leerResultadosPdf } from '../../src/lib/ingest/sources/rfee-pdf/resultados';
import type { AsaltoPdf, LecturaPdf, PaginaTexto, PruebaPdf } from '../../src/lib/ingest/sources/rfee-pdf/tipos';
import { tiradoresDeclarados } from './pdf-relectura-comun';

const SIN_PRUEBA: PaginaAnalizada['tipo'][] = ['sin_texto', 'ilegible', 'desconocida'];
/** Prefijo común mínimo para que dos nombres de la clasificación puedan confundirse al truncarse. */
export const PREFIJO_CONFUNDIBLE = 10;

const prefijoComun = (a: string, b: string): number => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
};

/** Grupos de participantes cuyos nombres comparten al menos `minimo` caracteres iniciales. */
export function gruposConfundibles(registro: readonly Participante[], minimo = PREFIJO_CONFUNDIBLE): Participante[][] {
  const norm = registro.map((p) => normalizar(p.nombre));
  const padre = registro.map((_, i) => i);
  const raiz = (i: number): number => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
  for (let i = 0; i < registro.length; i += 1) {
    for (let j = i + 1; j < registro.length; j += 1) {
      const n = prefijoComun(norm[i], norm[j]);
      if (n >= minimo || (n === Math.min(norm[i].length, norm[j].length) && n >= 4)) padre[raiz(i)] = raiz(j);
    }
  }
  const grupos = new Map<number, Participante[]>();
  registro.forEach((p, i) => grupos.set(raiz(i), [...(grupos.get(raiz(i)) ?? []), p]));
  return [...grupos.values()].filter((g) => g.length > 1);
}

/** Participante único que representa al grupo: nombre = prefijo común, club sólo si todos lo comparten. */
export function representante(grupo: readonly Participante[], ref: string): Participante {
  const nombres = grupo.map((p) => normalizar(p.nombre));
  const n = nombres.reduce((m, x) => Math.min(m, prefijoComun(nombres[0], x)), nombres[0].length);
  const clubes = new Set(grupo.map((p) => p.club ?? ''));
  return { ref, nombre: nombres[0].slice(0, n).trim(), club: clubes.size === 1 ? grupo[0].club : null };
}

export type Aparicion = {
  asalto: AsaltoPdf;
  lado: 'A' | 'B';
  grupo: number;
  /** Ref del miembro asignado, o null mientras no se decide. */
  ref: string | null;
};

const tamano = (ronda: string): number | null => {
  const m = /^A(\d+)$/.exec(ronda);
  return m ? Number(m[1]) : null;
};
const gano = (a: AsaltoPdf, lado: 'A' | 'B') => (lado === 'A' ? a.puntosA > a.puntosB : a.puntosB > a.puntosA);
const vueltaDe = (ronda: string) => (/^V(\d+)P/.exec(ronda)?.[1] ?? '1');

/** `ronda`: la de la primera columna de la página (`A128`), según su encabezado. */
export type Siembra = { pagina: number; y: number; siembra: number; texto: string; ronda: string | null };

/**
 * Siembra de cada participante de la primera columna de cada página del cuadro:
 * el número a la izquierda del nombre, en la misma fila.
 */
export function siembrasDelCuadro(paginas: readonly PaginaAnalizada[]): Siembra[] {
  const out: Siembra[] = [];
  for (const pg of paginas) {
    const encabezado = pg.filas[0]?.items.filter((i) => esItemRonda(i.s)).sort((a, b) => a.x - b.x)[0];
    const ronda = encabezado ? claveRonda(encabezado.s) : null;
    const cuerpo = pg.filas.slice(1).flatMap((f) => f.items);
    const semillas = cuerpo.filter((i) => /^\d{1,3}$/.test(i.s) && i.x < pg.ancho * 0.1);
    for (const s of semillas) {
      const nombre = cuerpo.filter((i) => Math.abs(i.y - s.y) <= 1.8 && i.x > s.x + s.w).sort((a, b) => a.x - b.x)[0];
      if (nombre) out.push({ pagina: pg.numero, y: nombre.y, siembra: Number(s.s), texto: nombre.s, ronda });
    }
  }
  return out;
}

/**
 * Siembra de la aparición del grupo si su asalto está en la primera columna de su página.
 * `regionPar` del lector deja yMax = y del de arriba + 8 e yMin = y del de abajo − 4; de los
 * dos, el del grupo es el único cuyo texto encaja con el nombre común del grupo.
 */
export function siembraDeAparicion(a: AsaltoPdf, nombreGrupo: string, siembras: readonly Siembra[]): number | null {
  const enFila = (y: number) => siembras.find((s) => s.pagina === a.region.pagina && Math.abs(s.y - y) <= 1.5);
  const arriba = enFila(a.region.yMax - 8);
  const abajo = enFila(a.region.yMin + 4);
  if (!arriba || !abajo) return null;
  const encaja = [arriba, abajo].filter((s) => compatibles(s.texto, nombreGrupo));
  return encaja.length === 1 ? encaja[0].siembra : null;
}

/**
 * Siembras que puede llevar el participante de la casilla `casilla` de la ronda de `ronda`
 * en un cuadro que empieza en la ronda de `primera`: el cuadro normal cruza k con 2S+1−k
 * y el ganador ocupa la casilla k, que es el número que Engarde imprime en las páginas
 * de rondas posteriores.
 */
export function siembrasDeCasilla(casilla: number, ronda: number, primera: number): number[] {
  if (ronda >= primera) return [casilla];
  return [...siembrasDeCasilla(casilla, ronda * 2, primera), ...siembrasDeCasilla(ronda * 2 + 1 - casilla, ronda * 2, primera)];
}

export type FilaIntermedia = { vuelta: number; rango: number; rangos: number[]; texto: string; vm: string; ind: number; td: number };

/**
 * Filas de las clasificaciones tras poules: puesto (= siembra del cuadro), nombre truncado,
 * V/M, índice y tocados dados. `vuelta` 0 = «clasificación después de poules» (la última).
 */
export function clasificacionIntermedia(paginas: readonly PaginaAnalizada[]): FilaIntermedia[] {
  const out: FilaIntermedia[] = [];
  for (const pg of paginas) {
    if (pg.tipo !== 'clasificacion_intermedia' || pg.filas.length === 0) continue;
    const titulo = normalizar(pg.filas[0].items.map((i) => i.s).join(' '));
    const v = /(?:VUELTA|VOLTA|ROUND)\D{0,6}(\d+)/.exec(titulo);
    const vuelta = v ? Number(v[1]) : 0;
    for (const f of pg.filas.slice(1)) {
      // PDF.js a veces une el puesto con el nombre («1 RAMIREZ LAREN») y los tocados con el estado («30 calificado»).
      const it = f.items.map((i) => i.s.trim()).flatMap((s, i) => {
        const m = i === 0 ? /^(\d{1,3}) (.+)$/.exec(s) : null;
        return m ? [m[1], m[2]] : [s];
      });
      if (!/^\d{1,3}$/.test(it[0] ?? '') || !it[1]) continue;
      // El club puede salir pegado al V/M («SAMA-1.000»).
      const m = /(\d[.,]\d{3})\s+(-?\d{1,3})\s+(\d{1,3})(?:\s|$)/.exec(it.slice(2).join(' '));
      if (!m) continue;
      out.push({ vuelta, rango: Number(it[0]), rangos: [], texto: it[1], vm: m[1].replace(',', '.'), ind: Number(m[2]), td: Number(m[3]) });
    }
  }
  // Un empate repite el puesto («20, 20, 22»): las siembras que cubre son las del hueco.
  const empates = new Map<string, number>();
  for (const f of out) empates.set(`${f.vuelta}|${f.rango}`, (empates.get(`${f.vuelta}|${f.rango}`) ?? 0) + 1);
  for (const f of out) f.rangos = Array.from({ length: empates.get(`${f.vuelta}|${f.rango}`)! }, (_, i) => f.rango + i);
  return out;
}

/** V/M, índice y tocados dados de una fila de poule a partir de sus asaltos. */
export function estadisticaFila(asaltos: readonly { a: AsaltoPdf; lado: 'A' | 'B' }[]): { vm: string; ind: number; td: number } {
  let v = 0;
  let td = 0;
  let tr = 0;
  for (const { a, lado } of asaltos) {
    const [propios, ajenos] = lado === 'A' ? [a.puntosA, a.puntosB] : [a.puntosB, a.puntosA];
    td += propios;
    tr += ajenos;
    if (propios > ajenos) v += 1;
  }
  return { vm: (v / asaltos.length).toFixed(3), ind: td - tr, td };
}

/**
 * Asigna cada aparición de un grupo a un miembro. `previos`: asaltos ya atribuidos por el
 * lector (restringen quién puede estar en cada ronda o poule). `puesto`: ref → puesto final.
 */
export function resolverApariciones(
  apariciones: Aparicion[],
  miembros: ReadonlyMap<number, readonly string[]>,
  previos: readonly AsaltoPdf[],
  puesto: ReadonlyMap<string, number | null>,
): void {
  const { posibles, anotar } = restricciones(apariciones, miembros, previos, puesto);
  // Las apariciones de una misma fila de poule son el mismo tirador: se deciden juntas.
  const clave = (x: Aparicion) => (x.asalto.fase === 'POULE' ? `P|${x.grupo}|${x.asalto.ronda}` : `T|${apariciones.indexOf(x)}`);
  for (let cambio = true; cambio; ) {
    cambio = false;
    const bloques = new Map<string, Aparicion[]>();
    for (const x of apariciones) if (x.ref === null) bloques.set(clave(x), [...(bloques.get(clave(x)) ?? []), x]);
    for (const xs of bloques.values()) {
      const comunes = xs.map(posibles).reduce((acc, l) => acc.filter((m) => l.includes(m)));
      if (comunes.length !== 1) continue;
      for (const x of xs) {
        x.ref = comunes[0];
        anotar(comunes[0], x.asalto, x.lado);
      }
      cambio = true;
    }
  }
}

/**
 * ¿Los puestos de la clasificación caen en el tramo de la ronda en que cada uno cae (quien
 * pierde en la de S, entre S/2+1 y S)? No en una primera fase de TNR, que numera a
 * continuación de los exentos: allí sólo vale el orden (`ordenarPorEliminacion`).
 */
export function puestosCuadranConRondas(previos: readonly AsaltoPdf[], puesto: ReadonlyMap<string, number | null>): boolean {
  let vistos = 0;
  let bien = 0;
  for (const a of previos) {
    const s = tamano(a.ronda);
    if (a.fase !== 'TABLEAU' || s === null) continue;
    for (const [ref, lado] of [[a.refA, 'A'], [a.refB, 'B']] as const) {
      const p = puesto.get(ref);
      if (p === null || p === undefined) continue;
      vistos += 1;
      if (gano(a, lado) ? p <= s / 2 : p > s / 2 && p <= s) bien += 1;
    }
  }
  return vistos > 0 && bien / vistos >= 0.95;
}

/**
 * Quién puede ser cada aparición dados los asaltos ya atribuidos (`previos`) y las
 * apariciones ya asignadas: el puesto final cuadra con la ronda, no repite ronda,
 * no sigue después de perder y no está en otra poule de la misma vuelta.
 */
export function restricciones(
  apariciones: readonly Aparicion[],
  miembros: ReadonlyMap<number, readonly string[]>,
  previos: readonly AsaltoPdf[],
  puesto: ReadonlyMap<string, number | null>,
): { posibles: (x: Aparicion) => string[]; anotar: (ref: string, a: AsaltoPdf, lado: 'A' | 'B') => void } {
  const enRonda = new Map<string, Set<string>>();
  const perdioEn = new Map<string, number>();
  const pouleDe = new Map<string, Map<string, string>>();
  const anotar = (ref: string, a: AsaltoPdf, lado: 'A' | 'B') => {
    if (a.fase === 'TABLEAU') {
      enRonda.set(a.ronda, (enRonda.get(a.ronda) ?? new Set()).add(ref));
      const s = tamano(a.ronda);
      if (s !== null && !gano(a, lado)) perdioEn.set(ref, Math.max(perdioEn.get(ref) ?? 0, s));
    } else {
      const v = vueltaDe(a.ronda);
      const m = pouleDe.get(v) ?? new Map<string, string>();
      m.set(ref, a.ronda);
      pouleDe.set(v, m);
    }
  };
  for (const a of previos) {
    anotar(a.refA, a, 'A');
    anotar(a.refB, a, 'B');
  }
  const posibles = (x: Aparicion): string[] => {
    const a = x.asalto;
    return (miembros.get(x.grupo) ?? []).filter((m) => {
      const p = puesto.get(m) ?? null;
      if (a.fase === 'TABLEAU') {
        const s = tamano(a.ronda);
        if (enRonda.get(a.ronda)?.has(m)) return false;
        if (s === null) return true;
        const perdio = perdioEn.get(m);
        if (perdio !== undefined && perdio > s) return false;
        if (p === null) return true;
        return gano(a, x.lado) ? p <= s / 2 : p > s / 2 && p <= s;
      }
      const otra = pouleDe.get(vueltaDe(a.ronda))?.get(m);
      return otra === undefined || otra === a.ronda;
    });
  };
  for (const x of apariciones) if (x.ref !== null) anotar(x.ref, x.asalto, x.lado);
  return { posibles, anotar };
}

/** Desempate por siembra: en la misma ronda, de dos que pierden, el de mejor siembra tiene mejor puesto. */
export function desempatarPorSiembra(
  apariciones: Aparicion[],
  miembros: ReadonlyMap<number, readonly string[]>,
  puesto: ReadonlyMap<string, number | null>,
  siembra: (x: Aparicion) => number | null,
): void {
  const porRonda = new Map<string, Aparicion[]>();
  for (const x of apariciones) {
    if (x.ref !== null || x.asalto.fase !== 'TABLEAU' || gano(x.asalto, x.lado)) continue;
    const k = `${x.grupo}|${x.asalto.ronda}`;
    porRonda.set(k, [...(porRonda.get(k) ?? []), x]);
  }
  for (const xs of porRonda.values()) {
    const s = tamano(xs[0].asalto.ronda);
    if (s === null || xs.length < 2) continue;
    const libres = (miembros.get(xs[0].grupo) ?? []).filter((m) => {
      const p = puesto.get(m);
      return p !== null && p !== undefined && p > s / 2 && p <= s && !apariciones.some((y) => y.ref === m && y.asalto.ronda === xs[0].asalto.ronda);
    });
    const sembradas = xs.map((x) => ({ x, s: siembra(x) }));
    if (libres.length !== xs.length || sembradas.some((y) => y.s === null)) continue;
    if (new Set(sembradas.map((y) => y.s)).size !== sembradas.length) continue;
    const porPuesto = [...libres].sort((a, b) => (puesto.get(a) ?? 0) - (puesto.get(b) ?? 0));
    if (new Set(porPuesto.map((m) => puesto.get(m))).size !== porPuesto.length) continue;
    sembradas.sort((a, b) => a.s! - b.s!).forEach((y, i) => (y.x.ref = porPuesto[i]));
  }
}

/**
 * Orden de eliminación: en la clasificación de un cuadro, quien cae en una ronda posterior
 * queda por delante de quien cae antes, y quien supera la última ronda leída (el campeón o,
 * en una primera fase, los clasificados) por delante de todos; en la misma ronda, por
 * siembra. No depende de que los puestos empiecen en 1 (una primera fase de TNR numera a
 * continuación de los exentos). Sólo se aplica si cada miembro libre del grupo tiene
 * exactamente un desenlace por asignar.
 */
export function ordenarPorEliminacion(
  apariciones: Aparicion[],
  miembros: ReadonlyMap<number, readonly string[]>,
  previos: readonly AsaltoPdf[],
  puesto: ReadonlyMap<string, number | null>,
  rango: (x: Aparicion) => number | null,
  cerrados: ReadonlySet<string> = new Set(),
): void {
  const tamanos = [...previos.map((a) => a.ronda), ...apariciones.map((x) => x.asalto.ronda)].map(tamano).filter((n): n is number => n !== null);
  if (tamanos.length === 0) return;
  const ultima = Math.min(...tamanos);
  const desenlace = (a: AsaltoPdf, lado: 'A' | 'B'): number | null => {
    const s = tamano(a.ronda);
    if (s === null) return null;
    if (!gano(a, lado)) return s;
    return s === ultima ? s / 2 : null;
  };
  const conDesenlace = new Set<string>(cerrados);
  for (const a of previos) {
    for (const [ref, lado] of [[a.refA, 'A'], [a.refB, 'B']] as const) if (desenlace(a, lado) !== null) conDesenlace.add(ref);
  }
  for (const x of apariciones) if (x.ref !== null && desenlace(x.asalto, x.lado) !== null) conDesenlace.add(x.ref);
  for (const [g, ms] of miembros) {
    const eventos = apariciones
      .filter((x) => x.grupo === g && x.ref === null && x.asalto.fase === 'TABLEAU')
      .map((x) => ({ x, k: desenlace(x.asalto, x.lado), r: rango(x) }))
      .filter((e): e is { x: Aparicion; k: number; r: number | null } => e.k !== null);
    const libres = ms.filter((m) => !conDesenlace.has(m));
    if (eventos.length === 0 || eventos.length !== libres.length) continue;
    eventos.sort((a, b) => a.k - b.k || (a.r ?? 0) - (b.r ?? 0));
    const empate = eventos.some((e, i) => i > 0 && e.k === eventos[i - 1].k && (e.r === null || eventos[i - 1].r === null || e.r === eventos[i - 1].r));
    const lugares = libres.map((m) => puesto.get(m) ?? null);
    if (empate || lugares.some((p) => p === null) || new Set(lugares).size !== lugares.length) continue;
    const orden = [...libres].sort((a, b) => puesto.get(a)! - puesto.get(b)!);
    eventos.forEach((e, i) => (e.x.ref = orden[i]));
  }
}

/** `y` de los dos participantes y del ganador de un cruce del cuadro, según `regionPar` del lector. */
const ysCruce = (a: AsaltoPdf) => ({ arriba: a.region.yMax - 8, abajo: a.region.yMin + 4, ganador: (a.region.yMax + a.region.yMin - 4) / 2 });

/**
 * El que gana un cruce aparece en la columna siguiente a la altura media del cruce: en la
 * misma página, el asalto de la ronda siguiente con un participante a esa altura es suyo.
 * Propaga en los dos sentidos desde los asaltos con tirador conocido. Devuelve si asignó alguno.
 */
export function propagarPorCuadro(
  apariciones: Aparicion[],
  conocidos: readonly { a: AsaltoPdf; ref: string }[],
  admite: (x: Aparicion, ref: string) => boolean,
): boolean {
  let cambio = false;
  const cerca = (y1: number, y2: number) => Math.abs(y1 - y2) <= 2;
  for (const x of apariciones) {
    if (x.ref !== null || x.asalto.fase !== 'TABLEAU') continue;
    const s = tamano(x.asalto.ronda);
    if (s === null) continue;
    const yx = ysCruce(x.asalto);
    const candidatos = new Set<string>();
    for (const c of conocidos) {
      if (c.a.fase !== 'TABLEAU' || c.a.region.pagina !== x.asalto.region.pagina) continue;
      const sc = tamano(c.a.ronda);
      const ladoC = c.a.refA === c.ref ? 'A' : 'B';
      const yc = ysCruce(c.a);
      // Hacia delante: el conocido ganó en la ronda anterior y entra en este cruce.
      if (sc === s * 2 && gano(c.a, ladoC) && (cerca(yc.ganador, yx.arriba) || cerca(yc.ganador, yx.abajo))) candidatos.add(c.ref);
      // Hacia atrás: el del grupo ganó este cruce y el conocido está en el siguiente a esa altura.
      if (sc === s / 2 && gano(x.asalto, x.lado) && (cerca(yx.ganador, yc.arriba) || cerca(yx.ganador, yc.abajo))) candidatos.add(c.ref);
    }
    const lista = [...candidatos].filter((r) => admite(x, r));
    if (lista.length === 1) {
      x.ref = lista[0];
      cambio = true;
    }
  }
  return cambio;
}

export type PruebaReleida = {
  prueba: PruebaPdf;
  /** Asaltos recuperados en la segunda pasada, ya con refs del registro. */
  recuperados: AsaltoPdf[];
  apariciones: number;
  asignadas: number;
  descartados: number;
  /** Apariciones que el documento no determina (nombre común del grupo, ronda...). */
  sinResolver?: { grupo: string; miembros: number; fase: string; ronda: string; gana: boolean; rango: number | null }[];
};

/** Grupos de páginas analizadas en el mismo orden en que `leerResultadosPdf` construye sus pruebas. */
export function gruposDePaginas(paginas: readonly PaginaTexto[]): PaginaAnalizada[][] {
  const grupos = new Map<string, PaginaAnalizada[]>();
  for (const p of paginas.flatMap(dividirPaginaPorPruebas).map(analizarPagina)) {
    if (SIN_PRUEBA.includes(p.tipo) || p.firma === '') continue;
    grupos.set(p.firma, [...(grupos.get(p.firma) ?? []), p]);
  }
  return [...grupos.values()];
}

const firmaAsalto = (a: AsaltoPdf) => `${a.fase}|${a.ronda}|${[`${a.refA}:${a.puntosA}`, `${a.refB}:${a.puntosB}`].sort().join('|')}`;

export function releerPrueba(prueba: PruebaPdf, grupo: readonly PaginaAnalizada[]): PruebaReleida {
  const vacio = { prueba, recuperados: [], apariciones: 0, asignadas: 0, descartados: 0 };
  if (prueba.formato !== 'INDIVIDUAL' || prueba.puestos.length === 0) return vacio;
  const registro: Participante[] = prueba.puestos.map((p) => ({ ref: p.ref, nombre: p.nombre, club: p.club, pais: p.pais ?? null }));
  const grupos = gruposConfundibles(registro);
  if (grupos.length === 0) return vacio;
  const paginasCuadro = grupo.filter((p) => p.tipo === 'cuadro');
  const paginasPoules = grupo.filter((p) => p.tipo === 'poules');
  const previos = prueba.asaltos;
  const firmasPrevias = new Set(previos.map(firmaAsalto));
  const miembros = new Map<number, string[]>();
  const apariciones: Aparicion[] = [];
  grupos.forEach((g, i) => {
    const ref = `grupo:${i}`;
    miembros.set(i, g.map((p) => p.ref));
    const fuera = new Set(g.map((p) => p.ref));
    const reg = [...registro.filter((p) => !fuera.has(p.ref)), representante(g, ref)];
    const nuevos = [...leerPoules(paginasPoules, reg).asaltos, ...leerCuadro(paginasCuadro, reg).asaltos];
    const propias: Aparicion[] = [];
    for (const a of nuevos) {
      const lados = (['A', 'B'] as const).filter((l) => (l === 'A' ? a.refA : a.refB) === ref);
      if (lados.length !== 1) continue;
      // El mismo asalto que el lector ya atribuyó (el texto era lo bastante largo): no es nuevo.
      const yaEsta = g.some((p) => firmasPrevias.has(firmaAsalto(lados[0] === 'A' ? { ...a, refA: p.ref } : { ...a, refB: p.ref })));
      if (yaEsta) continue;
      propias.push({ asalto: a, lado: lados[0], grupo: i, ref: null });
    }
    // Dos miembros en la misma poule se leen como una sola fila con rivales repetidos: esa poule no se usa.
    const porPoule = new Map<string, Aparicion[]>();
    for (const x of propias) if (x.asalto.fase === 'POULE') porPoule.set(x.asalto.ronda, [...(porPoule.get(x.asalto.ronda) ?? []), x]);
    const malas = new Set<string>();
    for (const [ronda, xs] of porPoule) {
      const rivales = xs.map((x) => (x.lado === 'A' ? x.asalto.refB : x.asalto.refA));
      if (new Set(rivales).size !== rivales.length) malas.add(ronda);
    }
    apariciones.push(...propias.filter((x) => x.asalto.fase !== 'POULE' || !malas.has(x.asalto.ronda)));
  });
  const puesto = new Map(prueba.puestos.map((p) => [p.ref, p.posicion]));
  const siembras = siembrasDelCuadro(paginasCuadro);
  const nombresGrupo = grupos.map((g, i) => representante(g, `grupo:${i}`).nombre);
  const intermedia = clasificacionIntermedia(grupo);
  const vueltas = [...previos, ...apariciones.map((x) => x.asalto)].filter((a) => a.fase === 'POULE').map((a) => Number(vueltaDe(a.ronda)));
  const ultimaVuelta = vueltas.length > 0 ? Math.max(...vueltas) : 1;
  const filasCuadro = intermedia.filter((f) => f.vuelta === 0 || f.vuelta === ultimaVuelta);
  const declarados = tiradoresDeclarados(grupo.map((p) => p.items.map((i) => i.s).join(' ')).join(' '));
  const impresos = [...previos, ...apariciones.map((x) => x.asalto)].map((a) => tamano(a.ronda) ?? 0);
  const primera = Math.max(...impresos, declarados ? 2 ** Math.ceil(Math.log2(declarados)) : 0);
  const rangosGrupo = nombresGrupo.map((n) => new Set(filasCuadro.filter((f) => compatibles(f.texto, n)).flatMap((f) => f.rangos)));

  // La siembra del cuadro es el puesto tras poules salvo en las primeras fases de TNR, que
  // siembran aparte: se comprueba con la primera ronda, casilla a casilla.
  const conRonda = siembras.filter((s) => s.ronda !== null && tamano(s.ronda) !== null);
  const casan = conRonda.filter((s) => {
    const posibles = siembrasDeCasilla(s.siembra, tamano(s.ronda!)!, primera);
    return filasCuadro.some((f) => f.rangos.some((r) => posibles.includes(r)) && compatibles(f.texto, s.texto));
  }).length;
  const siembraEsRango = conRonda.length >= 8 && casan / conRonda.length >= 0.9;
  const absolutos = puestosCuadranConRondas(previos, puesto);
  // Sin puestos por tramo de ronda, la restricción por puesto no se aplica: sólo el orden.
  const puestoRonda: ReadonlyMap<string, number | null> = absolutos ? puesto : new Map();

  /** Siembra del cuadro de una aparición (casilla de la primera ronda), si el documento la fija. */
  const siembraCuadro = (x: Aparicion): number | null => {
    const casilla = siembraDeAparicion(x.asalto, nombresGrupo[x.grupo], siembras);
    const s = tamano(x.asalto.ronda);
    if (casilla === null || s === null) return null;
    if (s >= primera) return casilla;
    if (!siembraEsRango) return null;
    const c = siembrasDeCasilla(casilla, s, primera).filter((r) => rangosGrupo[x.grupo].has(r));
    return c.length === 1 ? c[0] : null;
  };
  const rangoCuadro = (x: Aparicion): number | null => (siembraEsRango ? siembraCuadro(x) : null);
  /** Puesto tras poules de una fila de poule de la última vuelta, por su V/M, índice y tocados. */
  const rangoPoule = (xs: Aparicion[]): number | null => {
    const v = Number(vueltaDe(xs[0].asalto.ronda));
    const e = estadisticaFila(xs.map((x) => ({ a: x.asalto, lado: x.lado })));
    const filas = intermedia.filter((f) => (f.vuelta === v || (f.vuelta === 0 && v === ultimaVuelta)) &&
      compatibles(f.texto, nombresGrupo[xs[0].grupo]) && f.vm === e.vm && f.ind === e.ind && f.td === e.td);
    const r = new Set(filas.map((f) => f.rango));
    // Empatada con otra fila, la siembra no se sabe.
    return r.size === 1 && filas[0].rangos.length === 1 ? [...r][0] : null;
  };
  const enCuadro = (ref: string) =>
    previos.some((a) => a.fase === 'TABLEAU' && (a.refA === ref || a.refB === ref)) ||
    apariciones.some((x) => x.asalto.fase === 'TABLEAU' && x.ref === ref);

  const eliminados = new Set<string>();
  for (let vuelta = 0; vuelta < 12; vuelta += 1) {
    const antes = apariciones.filter((x) => x.ref).length;
    resolverApariciones(apariciones, miembros, previos, puestoRonda);
    const { posibles } = restricciones(apariciones, miembros, previos, puestoRonda);
    const admite = (x: Aparicion, r: string) => posibles(x).includes(r);

    const bloques = new Map<string, Aparicion[]>();
    for (const x of apariciones) {
      if (x.asalto.fase !== 'POULE' || Number(vueltaDe(x.asalto.ronda)) !== ultimaVuelta) continue;
      const k = `${x.grupo}|${x.asalto.ronda}`;
      bloques.set(k, [...(bloques.get(k) ?? []), x]);
    }
    const rangoMiembro = new Map<string, string>();
    for (const x of apariciones) {
      if (x.ref === null || x.asalto.fase !== 'TABLEAU') continue;
      const r = rangoCuadro(x);
      if (r !== null) rangoMiembro.set(`${x.grupo}|${r}`, x.ref);
    }
    for (const xs of bloques.values()) {
      const r = rangoPoule(xs);
      if (r !== null && xs[0].ref !== null) rangoMiembro.set(`${xs[0].grupo}|${r}`, xs[0].ref);
    }
    for (const x of apariciones) {
      if (x.ref !== null || x.asalto.fase !== 'TABLEAU') continue;
      const r = rangoCuadro(x);
      const m = r === null ? undefined : rangoMiembro.get(`${x.grupo}|${r}`);
      if (m && admite(x, m)) x.ref = m;
    }
    for (const xs of bloques.values()) {
      if (xs[0].ref !== null) continue;
      const r = rangoPoule(xs);
      if (r === null) continue;
      let m = rangoMiembro.get(`${xs[0].grupo}|${r}`);
      if (!m) {
        // Eliminado en poules: su puesto final es su puesto tras poules.
        const quedan = apariciones.some((x) => x.grupo === xs[0].grupo && x.asalto.fase === 'TABLEAU' && x.ref === null);
        const fuera = absolutos && (declarados !== null ? r > declarados : !quedan);
        const cand = (miembros.get(xs[0].grupo) ?? []).filter((ref) => puesto.get(ref) === r && !enCuadro(ref));
        if (fuera && cand.length === 1) {
          m = cand[0];
          eliminados.add(m);
        }
      }
      if (m && xs.every((x) => admite(x, m!))) for (const x of xs) x.ref = m;
    }
    if (absolutos) desempatarPorSiembra(apariciones, miembros, puesto, siembraCuadro);
    ordenarPorEliminacion(apariciones, miembros, previos, puesto, siembraCuadro, eliminados);
    const conocidos = [
      ...previos.flatMap((a) => [a.refA, a.refB].filter((r) => [...miembros.values()].some((g) => g.includes(r))).map((r) => ({ a, ref: r }))),
      ...apariciones.filter((x) => x.ref !== null && x.asalto.fase === 'TABLEAU').map((x) => ({ a: conRef(x), ref: x.ref! })),
    ];
    propagarPorCuadro(apariciones, conocidos, (x, r) => (miembros.get(x.grupo) ?? []).includes(r) && admite(x, r));
    sanear(apariciones, previos);
    if (apariciones.filter((x) => x.ref).length === antes) break;
  }

  const nombre = new Map(prueba.puestos.map((p) => [p.ref, p.nombre]));
  const acumulador = new AcumuladorAsaltos(exclusionesVacias());
  let descartados = 0;
  for (const x of apariciones) {
    if (x.ref === null) {
      descartados += 1;
      continue;
    }
    const a = conRef(x);
    if (firmasPrevias.has(firmaAsalto(a)) || a.refA === a.refB) continue;
    const ganaA = a.puntosA > a.puntosB;
    acumulador.agregar({
      fase: a.fase, ronda: a.ronda, rondaOriginal: a.rondaOriginal, marcador: a.marcador, region: a.region,
      ganador: { ref: ganaA ? a.refA : a.refB, nombre: nombre.get(ganaA ? a.refA : a.refB) ?? '', puntos: Math.max(a.puntosA, a.puntosB) },
      perdedor: { ref: ganaA ? a.refB : a.refA, nombre: nombre.get(ganaA ? a.refB : a.refA) ?? '', puntos: Math.min(a.puntosA, a.puntosB) },
    });
  }
  // Un asalto entre dos apariciones de grupos distintos sale dos veces (una por pasada): una sola copia.
  const vistos = new Set<string>();
  const recuperados = acumulador.asaltos.filter((a) => {
    const k = firmaAsalto(a);
    if (vistos.has(k) || firmasPrevias.has(k)) return false;
    vistos.add(k);
    return true;
  });
  const sinResolver = apariciones.filter((x) => x.ref === null).map((x) => ({
    grupo: nombresGrupo[x.grupo], miembros: (miembros.get(x.grupo) ?? []).length, fase: x.asalto.fase, ronda: x.asalto.ronda,
    gana: gano(x.asalto, x.lado), rango: x.asalto.fase === 'TABLEAU' ? rangoCuadro(x) : null,
  }));
  return { prueba, recuperados, apariciones: apariciones.length, asignadas: apariciones.filter((x) => x.ref).length, descartados, sinResolver };
}

/**
 * Deshace asignaciones imposibles: un tirador dos veces en la misma ronda del cuadro o en dos
 * poules de la misma vuelta. Ninguna de las asignaciones en choque se conserva.
 */
export function sanear(apariciones: Aparicion[], previos: readonly AsaltoPdf[]): void {
  const clave = (ref: string, a: AsaltoPdf) => (a.fase === 'TABLEAU' ? `T|${a.ronda}|${ref}` : `P|${vueltaDe(a.ronda)}|${ref}`);
  const cuadroPrevio = new Set<string>();
  // En poules el tirador aparece en varios asaltos de su poule: lo que cuenta es la poule.
  const poulePrevia = new Map<string, Set<string>>();
  for (const a of previos) {
    for (const r of [a.refA, a.refB]) {
      const k = clave(r, a);
      if (a.fase === 'TABLEAU') cuadroPrevio.add(k);
      else poulePrevia.set(k, (poulePrevia.get(k) ?? new Set()).add(a.ronda));
    }
  }
  const asignadas = new Map<string, Aparicion[]>();
  for (const x of apariciones) {
    if (x.ref === null) continue;
    const k = clave(x.ref, x.asalto);
    asignadas.set(k, [...(asignadas.get(k) ?? []), x]);
  }
  for (const [k, xs] of asignadas) {
    if (k.startsWith('T|')) {
      if (cuadroPrevio.has(k) || xs.length > 1) for (const x of xs) x.ref = null;
      continue;
    }
    const poules = new Set([...(poulePrevia.get(k) ?? []), ...xs.map((x) => x.asalto.ronda)]);
    if (poules.size > 1) for (const x of xs) x.ref = null;
  }
}

function conRef(x: Aparicion): AsaltoPdf {
  return x.lado === 'A' ? { ...x.asalto, refA: x.ref! } : { ...x.asalto, refB: x.ref! };
}

export function releerPdf(paginas: readonly PaginaTexto[], contexto: { url: string; docId: string }): { lectura: LecturaPdf; releidas: PruebaReleida[] } {
  const lectura = leerResultadosPdf(paginas, contexto);
  const grupos = gruposDePaginas(paginas);
  const releidas = lectura.pruebas.map((p, i) => (grupos[i] ? releerPrueba(p, grupos[i]) : { prueba: p, recuperados: [], apariciones: 0, asignadas: 0, descartados: 0 }));
  return { lectura, releidas };
}
