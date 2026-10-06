import { z } from 'zod';
import { porcentaje } from './asaltos-orientados-sql';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { UUID_RE } from './cursor';
import { resolverPersona } from './personas';
import { categoriaVisible, nombrePrueba, ordenCategoriaVisible } from './presentacion';
import {
  LIMITE_CARA_A_CARA_RENDIMIENTO,
  LIMITE_PRUEBAS_RENDIMIENTO,
  sqlCaraACaraRendimiento,
  sqlPruebasRendimiento,
  type FilaCaraACaraRendimiento,
  type FilaPruebaRendimiento,
} from './rendimiento-sql';
import { clasificarCompeticion, plegarNombre } from './tipo-competicion';
import type { AmbitoCompeticion, TipoCompeticion, TonoTipo } from './tipos-social';

export type { FilaCaraACaraRendimiento, FilaPruebaRendimiento } from './rendimiento-sql';

/**
 * Series compactas para las gráficas de rendimiento del perfil y del cara a
 * cara. Todo se agrega aquí, en el Worker, a partir de una sola sentencia por
 * pantalla: la base devuelve una fila por prueba (o por asalto en el cara a
 * cara) y nada más.
 */

export type AmbitoRendimiento = 'todo' | AmbitoCompeticion;
export const AMBITOS_RENDIMIENTO: readonly AmbitoRendimiento[] = ['todo', 'internacional', 'nacional'];

/**
 * Tipos de las gráficas: los de `clasificarCompeticion` con dos cortes más
 * finos que allí no hacen falta (el Campeonato y los Juegos del Mediterráneo
 * salen de «continental» y «multideporte») y lo nacional menor agrupado.
 */
export type TipoRendimiento =
  | 'JUEGOS_OLIMPICOS'
  | 'CTO_MUNDO'
  | 'CTO_EUROPA'
  | 'JUEGOS_MEDITERRANEOS'
  | 'CTO_MEDITERRANEO'
  | 'CTO_CONTINENTAL'
  | 'JUEGOS_OTROS'
  | 'GRAN_PREMIO'
  | 'COPA_MUNDO'
  | 'CIRCUITO_EUROPEO'
  | 'SATELITE'
  | 'INTERNACIONAL_OTRO'
  | 'CTO_ESPANA'
  | 'TNR'
  | 'AUTONOMICO'
  | 'NACIONAL_OTRO';

type DefinicionTipo = { etiqueta: string; corta: string; tono: TonoTipo; ambito: AmbitoCompeticion };

/** El orden de las claves es el de pintar: de más a menos peso deportivo, internacional antes. */
export const TIPOS_RENDIMIENTO: Record<TipoRendimiento, DefinicionTipo> = {
  // Carmesí y no dorado: en las gráficas el dorado es el oro de las medallas.
  JUEGOS_OLIMPICOS: { etiqueta: 'Juegos Olímpicos', corta: 'JJOO', tono: 'primary', ambito: 'internacional' },
  CTO_MUNDO: { etiqueta: 'Campeonato del Mundo', corta: 'Mundial', tono: 'primary', ambito: 'internacional' },
  CTO_EUROPA: { etiqueta: 'Campeonato de Europa', corta: 'Europeo', tono: 'org-efc', ambito: 'internacional' },
  JUEGOS_MEDITERRANEOS: { etiqueta: 'Juegos Mediterráneos', corta: 'J. Mediterráneos', tono: 'org-fie', ambito: 'internacional' },
  CTO_MEDITERRANEO: { etiqueta: 'Campeonato del Mediterráneo', corta: 'Mediterráneo', tono: 'org-fie', ambito: 'internacional' },
  CTO_CONTINENTAL: { etiqueta: 'Otro continental', corta: 'Continental', tono: 'org-fie', ambito: 'internacional' },
  JUEGOS_OTROS: { etiqueta: 'Otros juegos', corta: 'Juegos', tono: 'org-fie', ambito: 'internacional' },
  GRAN_PREMIO: { etiqueta: 'Gran Premio', corta: 'Gran Premio', tono: 'org-fie', ambito: 'internacional' },
  COPA_MUNDO: { etiqueta: 'Copa del Mundo', corta: 'Copa del Mundo', tono: 'org-fie', ambito: 'internacional' },
  CIRCUITO_EUROPEO: { etiqueta: 'Circuito europeo', corta: 'Circ. europeo', tono: 'org-efc', ambito: 'internacional' },
  SATELITE: { etiqueta: 'Satélite', corta: 'Satélite', tono: 'org-fie', ambito: 'internacional' },
  INTERNACIONAL_OTRO: { etiqueta: 'Otro internacional', corta: 'Internacional', tono: 'off', ambito: 'internacional' },
  CTO_ESPANA: { etiqueta: 'Campeonato de España', corta: 'Cto. España', tono: 'org-rfee', ambito: 'nacional' },
  TNR: { etiqueta: 'TNR', corta: 'TNR', tono: 'org-rfee', ambito: 'nacional' },
  AUTONOMICO: { etiqueta: 'Autonómico', corta: 'Autonómico', tono: 'org-aut', ambito: 'nacional' },
  NACIONAL_OTRO: { etiqueta: 'Otro nacional', corta: 'Nacional', tono: 'off', ambito: 'nacional' },
};

const ORDEN_TIPOS = Object.keys(TIPOS_RENDIMIENTO) as TipoRendimiento[];

const MEDITERRANEO = /\b(mediterrane[oa]s?|mediterranee|mediterranean|mediterraneens|mediterraneen)\b/;

export type DatosTipoRendimiento = {
  torneo: string;
  fuente: string;
  pais: string | null;
  ambitoEvento: string | null;
  circuitoEvento: string | null;
  fuenteEvento: string | null;
};

/** Tipo de gráfica de una prueba y su ámbito (el de `clasificarCompeticion`, que manda). */
export function tipoRendimiento(d: DatosTipoRendimiento): { tipo: TipoRendimiento; ambito: AmbitoCompeticion } {
  const c = clasificarCompeticion({
    nombre: d.torneo, fuente: d.fuente, pais: d.pais,
    ambitoEvento: d.ambitoEvento, circuitoEvento: d.circuitoEvento, fuenteEvento: d.fuenteEvento,
  });
  const mediterraneo = MEDITERRANEO.test(plegarNombre(d.torneo));
  const porBase: Partial<Record<TipoCompeticion, TipoRendimiento>> = {
    CTO_CONTINENTAL: mediterraneo ? 'CTO_MEDITERRANEO' : 'CTO_CONTINENTAL',
    JUEGOS_MULTIDEPORTE: mediterraneo ? 'JUEGOS_MEDITERRANEOS' : 'JUEGOS_OTROS',
    LIGA_CLUBES: 'NACIONAL_OTRO',
    LIGA_MASTER: 'NACIONAL_OTRO',
    CRITERIUM: 'NACIONAL_OTRO',
    OTRO: c.ambito === 'internacional' ? 'INTERNACIONAL_OTRO' : 'NACIONAL_OTRO',
  };
  const tipo = porBase[c.tipo] ?? (c.tipo in TIPOS_RENDIMIENTO ? (c.tipo as TipoRendimiento) : 'NACIONAL_OTRO');
  // Un tipo propio sólo vive en un ámbito; si la clasificación base dice otro (p. ej. un
  // «Otra prueba» celebrada fuera), manda el ámbito y se cae al «otro» de ese lado.
  if (TIPOS_RENDIMIENTO[tipo].ambito !== c.ambito) {
    return { tipo: c.ambito === 'internacional' ? 'INTERNACIONAL_OTRO' : 'NACIONAL_OTRO', ambito: c.ambito };
  }
  return { tipo, ambito: c.ambito };
}

/** `2025` (FIE, año final) y `2024-2025` (RFEE) son la misma temporada. */
export function temporadaDeportiva(season: string): string {
  const s = String(season).trim();
  if (/^\d{4}$/.test(s)) return `${Number(s) - 1}-${s}`;
  return s;
}

/** `2024-2025` → `24-25`; otra forma se deja igual. */
export function temporadaCorta(temporada: string): string {
  const m = /^(\d{4})-(\d{4})$/.exec(temporada);
  return m ? `${m[1].slice(2)}-${m[2].slice(2)}` : temporada;
}

function siguienteTemporada(temporada: string): string | null {
  const m = /^(\d{4})-(\d{4})$/.exec(temporada);
  return m ? `${Number(m[1]) + 1}-${Number(m[2]) + 1}` : null;
}

export type RegistroRendimiento = {
  asaltos: number;
  victorias: number;
  derrotas: number;
  dados: number;
  recibidos: number;
  /** Victorias entre asaltos decididos (0–1); `null` sin asaltos decididos. */
  porcentaje: number | null;
};

export type ResumenRendimiento = {
  competiciones: number;
  /** Competiciones con puesto final publicado. */
  conPuesto: number;
  mejor: number | null;
  mediana: number | null;
  /** Mediana de puesto / cuadro (0–1, menor es mejor); `null` sin cuadros conocidos. */
  percentilMediano: number | null;
  oros: number;
  platas: number;
  bronces: number;
  medallas: number;
  /** Entre los 8 primeros. */
  finales: number;
  asaltos: RegistroRendimiento;
  poule: RegistroRendimiento;
  directa: RegistroRendimiento;
};

export type TemporadaRendimiento = ResumenRendimiento & {
  temporada: string;
  corta: string;
  /** Reparto de las competiciones de la temporada por ámbito. */
  internacionales: number;
  nacionales: number;
};

export type TipoResumen = ResumenRendimiento & {
  clave: TipoRendimiento;
  etiqueta: string;
  corta: string;
  tono: TonoTipo;
  ambito: AmbitoCompeticion;
};

export type CategoriaResumen = ResumenRendimiento & { clave: string; etiqueta: string };

export type PuntoEvolucion = {
  pruebaId: string;
  edicionId: string | null;
  fecha: string | null;
  fechaOrden: string;
  temporada: string;
  torneo: string;
  tipo: TipoRendimiento;
  tono: TonoTipo;
  ambito: AmbitoCompeticion;
  categoria: string;
  puesto: number;
  participantes: number | null;
  /** Puesto / cuadro (0–1, menor es mejor); `null` si no se conoce el cuadro. */
  percentil: number | null;
};

export type VistaRendimiento = {
  total: ResumenRendimiento;
  /** Cronológico, con las temporadas intermedias sin competir rellenas a cero. */
  porTemporada: TemporadaRendimiento[];
  porTipo: TipoResumen[];
  porCategoria: CategoriaResumen[];
  /** Sólo si hay más de un arma (casi nunca). */
  porArma: (ResumenRendimiento & { clave: string })[];
  /** Cronológico; sólo pruebas con puesto final. */
  evolucion: PuntoEvolucion[];
};

export type Rendimiento = {
  vistas: Record<AmbitoRendimiento, VistaRendimiento>;
  /** Hay más pruebas que el máximo leído: las cifras son parciales. */
  truncado: boolean;
};

const conPuesto = (f: FilaPruebaRendimiento) => f.puesto != null && Number(f.puesto) > 0;
const n = (v: unknown) => Number(v ?? 0);

/**
 * Funde la misma prueba publicada por dos fuentes sin enlace de calendario
 * común, con el mismo criterio que `fundirPruebasRepetidas` (mismo día, arma,
 * género, categoría y ámbito, fuentes distintas). Aquí además los asaltos por
 * fase y el cuadro viajan con la copia de la que se toman.
 */
export function fundirPruebasRendimiento<T extends Clasificada>(rows: readonly T[]): T[] {
  const salida: T[] = [];
  const grupos = new Map<string, { i: number; fuentes: Set<string> }[]>();
  for (const f of rows) {
    if (!f.fecha || !f.arma || !f.genero) {
      salida.push(f);
      continue;
    }
    const clave = [f.fecha, f.arma, f.genero, f.categoria, f._ambito].join('|');
    const fuente = f.fuenteResultado ?? f.fuente;
    const candidatos = grupos.get(clave) ?? [];
    const g = candidatos.find((c) => !c.fuentes.has(fuente));
    if (!g) {
      candidatos.push({ i: salida.length, fuentes: new Set([fuente]) });
      grupos.set(clave, candidatos);
      salida.push(f);
      continue;
    }
    g.fuentes.add(fuente);
    const previa = salida[g.i];
    const nuevaGana = (conPuesto(f) && !conPuesto(previa))
      || (conPuesto(f) === conPuesto(previa) && n(f.asaltos) > n(previa.asaltos));
    const base = nuevaGana ? f : previa;
    const otra = nuevaGana ? previa : f;
    const asaltos = n(otra.asaltos) > n(base.asaltos) ? otra : base;
    const contradicen = conPuesto(previa) && conPuesto(f) && n(previa.puesto) !== n(f.puesto);
    salida[g.i] = {
      ...base,
      puesto: contradicen ? null : conPuesto(base) ? base.puesto : conPuesto(otra) ? otra.puesto : null,
      // La copia con la clasificación más completa dice el tamaño del cuadro.
      participantes: base.participantes == null && otra.participantes == null
        ? null
        : Math.max(n(base.participantes), n(otra.participantes)),
      asaltos: asaltos.asaltos, victorias: asaltos.victorias, derrotas: asaltos.derrotas,
      dados: asaltos.dados, recibidos: asaltos.recibidos,
      pouleA: asaltos.pouleA, pouleV: asaltos.pouleV, pouleD: asaltos.pouleD,
      pouleDados: asaltos.pouleDados, pouleRecibidos: asaltos.pouleRecibidos,
      directaA: asaltos.directaA, directaV: asaltos.directaV, directaD: asaltos.directaD,
      directaDados: asaltos.directaDados, directaRecibidos: asaltos.directaRecibidos,
    };
  }
  return salida;
}

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function registroVacio(): RegistroRendimiento {
  return { asaltos: 0, victorias: 0, derrotas: 0, dados: 0, recibidos: 0, porcentaje: null };
}

/** Acumulador: los puestos se guardan para la mediana y se cierran al final. */
type Acumulado = ResumenRendimiento & { _puestos: number[]; _percentiles: number[] };

function acumuladoVacio(): Acumulado {
  return {
    competiciones: 0, conPuesto: 0, mejor: null, mediana: null, percentilMediano: null,
    oros: 0, platas: 0, bronces: 0, medallas: 0, finales: 0,
    asaltos: registroVacio(), poule: registroVacio(), directa: registroVacio(),
    _puestos: [], _percentiles: [],
  };
}

export function percentilDe(puesto: number | null, participantes: number | null): number | null {
  if (puesto === null || participantes === null) return null;
  const p = Number(puesto);
  const t = Number(participantes);
  return t >= 2 && p >= 1 && p <= t ? p / t : null;
}

function sumar(a: Acumulado, f: FilaPruebaRendimiento): void {
  a.competiciones += 1;
  const puesto = conPuesto(f) ? n(f.puesto) : null;
  if (puesto !== null) {
    a.conPuesto += 1;
    a._puestos.push(puesto);
    if (a.mejor === null || puesto < a.mejor) a.mejor = puesto;
    if (puesto === 1) a.oros += 1;
    if (puesto === 2) a.platas += 1;
    if (puesto === 3) a.bronces += 1;
    if (puesto <= 3) a.medallas += 1;
    if (puesto <= 8) a.finales += 1;
    const pc = percentilDe(puesto, f.participantes);
    if (pc !== null) a._percentiles.push(pc);
  }
  const anadir = (r: RegistroRendimiento, asaltos: unknown, v: unknown, d: unknown, dados: unknown, recibidos: unknown) => {
    r.asaltos += n(asaltos);
    r.victorias += n(v);
    r.derrotas += n(d);
    r.dados += n(dados);
    r.recibidos += n(recibidos);
  };
  anadir(a.asaltos, f.asaltos, f.victorias, f.derrotas, f.dados, f.recibidos);
  anadir(a.poule, f.pouleA, f.pouleV, f.pouleD, f.pouleDados, f.pouleRecibidos);
  anadir(a.directa, f.directaA, f.directaV, f.directaD, f.directaDados, f.directaRecibidos);
}

function cerrarRegistro(r: RegistroRendimiento): RegistroRendimiento {
  r.porcentaje = porcentaje(r.victorias, r.derrotas);
  return r;
}

function cerrar(a: Acumulado): ResumenRendimiento {
  const { _puestos, _percentiles, ...resto } = a;
  return {
    ...resto,
    mediana: mediana(_puestos),
    percentilMediano: mediana(_percentiles),
    asaltos: cerrarRegistro(resto.asaltos),
    poule: cerrarRegistro(resto.poule),
    directa: cerrarRegistro(resto.directa),
  };
}

/** Fila con su tipo, ámbito, temporada y nombre ya calculados: las expresiones regulares se pasan una vez. */
export type Clasificada = FilaPruebaRendimiento & {
  _tipo: TipoRendimiento;
  _ambito: AmbitoCompeticion;
  _temporada: string;
  _torneo: string;
};

export function clasificarFila(f: FilaPruebaRendimiento): Clasificada {
  const { tipo, ambito } = tipoRendimiento(f);
  return {
    ...f,
    _tipo: tipo,
    _ambito: ambito,
    _temporada: temporadaDeportiva(f.temporada ?? ''),
    _torneo: nombrePrueba({ nombre: f.torneo, formato: 'INDIVIDUAL', fuente: f.fuente }),
  };
}

function vista(rows: readonly Clasificada[]): VistaRendimiento {
  const total = acumuladoVacio();
  const temporadas = new Map<string, Acumulado & { internacionales: number; nacionales: number }>();
  const tipos = new Map<TipoRendimiento, Acumulado>();
  const categorias = new Map<string, Acumulado>();
  const armas = new Map<string, Acumulado>();
  const en = <K, V>(m: Map<K, V>, k: K, crear: () => V) => {
    let v = m.get(k);
    if (!v) m.set(k, (v = crear()));
    return v;
  };
  const evolucion: PuntoEvolucion[] = [];
  for (const f of rows) {
    const t = en(temporadas, f._temporada, () => ({ ...acumuladoVacio(), internacionales: 0, nacionales: 0 }));
    if (f._ambito === 'internacional') t.internacionales += 1;
    else t.nacionales += 1;
    for (const a of [total, t, en(tipos, f._tipo, acumuladoVacio), en(categorias, f.categoria, acumuladoVacio), en(armas, f.arma ?? '', acumuladoVacio)]) {
      sumar(a, f);
    }
    if (conPuesto(f)) {
      const puesto = n(f.puesto);
      const participantes = f.participantes == null ? null : Math.max(n(f.participantes), puesto);
      evolucion.push({
        pruebaId: f.pruebaId,
        edicionId: f.edicionId ?? null,
        fecha: f.fecha ?? null,
        fechaOrden: f.fechaOrden ?? '0001-01-01',
        temporada: f._temporada,
        torneo: f._torneo,
        tipo: f._tipo,
        tono: TIPOS_RENDIMIENTO[f._tipo].tono,
        ambito: f._ambito,
        categoria: f.categoria,
        puesto,
        participantes,
        percentil: percentilDe(puesto, participantes),
      });
    }
  }
  evolucion.sort((a, b) => a.fechaOrden.localeCompare(b.fechaOrden) || a.pruebaId.localeCompare(b.pruebaId));

  const porTemporada: TemporadaRendimiento[] = [];
  const claves = [...temporadas.keys()].sort();
  for (let i = 0; i < claves.length; i++) {
    const t = temporadas.get(claves[i])!;
    const { internacionales, nacionales, ...acumulado } = t;
    porTemporada.push({ ...cerrar(acumulado), temporada: claves[i], corta: temporadaCorta(claves[i]), internacionales, nacionales });
    // Un hueco entre dos temporadas con competiciones se pinta como hueco, no se salta.
    let siguiente = siguienteTemporada(claves[i]);
    while (siguiente && i + 1 < claves.length && siguiente < claves[i + 1]) {
      porTemporada.push({ ...cerrar(acumuladoVacio()), temporada: siguiente, corta: temporadaCorta(siguiente), internacionales: 0, nacionales: 0 });
      siguiente = siguienteTemporada(siguiente);
    }
  }

  const porTipo: TipoResumen[] = [...tipos.entries()]
    .sort(([a], [b]) => ORDEN_TIPOS.indexOf(a) - ORDEN_TIPOS.indexOf(b))
    .map(([clave, a]) => ({ ...cerrar(a), clave, ...TIPOS_RENDIMIENTO[clave] }));
  const porCategoria: CategoriaResumen[] = [...categorias.entries()]
    .sort(([a], [b]) => ordenCategoriaVisible(a) - ordenCategoriaVisible(b) || a.localeCompare(b))
    .map(([clave, a]) => ({ ...cerrar(a), clave, etiqueta: categoriaVisible(clave) }));
  const porArma = armas.size > 1
    ? [...armas.entries()].sort(([, a], [, b]) => b.competiciones - a.competiciones).map(([clave, a]) => ({ ...cerrar(a), clave }))
    : [];
  return { total: cerrar(total), porTemporada, porTipo, porCategoria, porArma, evolucion };
}

export function aRendimiento(rows: readonly FilaPruebaRendimiento[]): Rendimiento {
  const truncado = rows.length > LIMITE_PRUEBAS_RENDIMIENTO;
  const clasificadas = fundirPruebasRendimiento(rows.slice(0, LIMITE_PRUEBAS_RENDIMIENTO).map(clasificarFila));
  return {
    vistas: {
      todo: vista(clasificadas),
      internacional: vista(clasificadas.filter((f) => f._ambito === 'internacional')),
      nacional: vista(clasificadas.filter((f) => f._ambito === 'nacional')),
    },
    truncado,
  };
}

/** Para quien ya resolvió la persona (la ficha tiene `ids`); un fallo devuelve `null`. */
export async function leerRendimientoDe(
  db: ContextoExplorador['db'],
  ids: readonly string[],
): Promise<Rendimiento | null> {
  try {
    return aRendimiento(filas<FilaPruebaRendimiento>(await db.execute(sqlPruebasRendimiento(ids))));
  } catch (error) {
    console.error('[explorar] el rendimiento no se pudo leer:', error instanceof Error ? error.name : 'desconocido');
    return null;
  }
}

export type ResultadoRendimiento =
  | { estado: 'ok'; personaId: string; datos: Rendimiento }
  | { estado: 'entrada_invalida' | 'no_disponible' | 'no_encontrada' | 'error' };

const esquemaPersona = z.object({ personaId: z.string().regex(UUID_RE) }).strict();

/** Entrada completa: exige sesión, valida el ID y resuelve las fusiones. */
export async function leerRendimiento(ctx: ContextoExplorador, entrada: unknown): Promise<ResultadoRendimiento> {
  await exigirPerfil(ctx);
  const analizada = esquemaPersona.safeParse(entrada);
  if (!analizada.success) return { estado: 'entrada_invalida' };
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };
  const persona = await resolverPersona(ctx.db, analizada.data.personaId);
  if (!persona) return { estado: 'no_encontrada' };
  const datos = await leerRendimientoDe(ctx.db, persona.ids);
  return datos ? { estado: 'ok', personaId: persona.canonicaId, datos } : { estado: 'error' };
}

// ---------------------------------------------------------------------------
// Cara a cara
// ---------------------------------------------------------------------------

export type AsaltoCaraACaraRendimiento = {
  pruebaId: string;
  edicionId: string;
  fecha: string | null;
  temporada: string;
  torneo: string;
  tipo: TipoRendimiento;
  ambito: AmbitoCompeticion;
  fase: 'POULE' | 'TABLEAU';
  mios: number;
  suyos: number;
  /** Victorias menos derrotas de `yo` tras este asalto. */
  balance: number;
};

export type Delante = 'yo' | 'rival' | 'empate';

export type PruebaCompartida = {
  pruebaId: string;
  edicionId: string;
  fecha: string | null;
  temporada: string;
  torneo: string;
  tipo: TipoRendimiento;
  tono: TonoTipo;
  ambito: AmbitoCompeticion;
  categoria: string;
  puestoYo: number;
  puestoRival: number;
  participantes: number | null;
  delante: Delante;
};

export type TemporadaCaraACara = {
  temporada: string;
  corta: string;
  asaltos: RegistroRendimiento;
  /** Pruebas comunes de la temporada en las que cada una acabó delante. */
  delanteYo: number;
  delanteRival: number;
};

export type RendimientoCaraACara = {
  total: RegistroRendimiento;
  poule: RegistroRendimiento;
  directa: RegistroRendimiento;
  /** Media de tocados por asalto de cada lado; `null` sin asaltos. */
  tocadosPorAsalto: { yo: number | null; rival: number | null };
  /** Cronológico (poule antes que directa el mismo día). */
  asaltos: AsaltoCaraACaraRendimiento[];
  /** Cronológico; sólo pruebas con puesto de las dos. */
  pruebas: PruebaCompartida[];
  delante: Record<Delante, number>;
  /** Cronológico, sin rellenar huecos. */
  porTemporada: TemporadaCaraACara[];
  truncado: boolean;
};

const fechaReal = (f: string | null | undefined) => (f && f !== '0001-01-01' ? f : null);

/**
 * La misma prueba publicada por dos fuentes sin equivalencia de calendario
 * (mismo día, arma, género y categoría): se queda la copia con más asaltos
 * entre las dos, o la primera, y la otra no cuenta.
 */
function pruebasDescartadas(rows: readonly FilaCaraACaraRendimiento[]): Set<string> {
  const porPrueba = new Map<string, { clave: string | null; fuente: string; asaltos: number }>();
  for (const r of rows) {
    const p = porPrueba.get(r.pruebaId) ?? {
      clave: r.fechaPrueba ? [r.fechaPrueba, r.arma, r.genero, r.categoria].join('|') : null,
      fuente: r.fuente,
      asaltos: 0,
    };
    if (r.clase === 'asalto') p.asaltos += 1;
    porPrueba.set(r.pruebaId, p);
  }
  const ganadora = new Map<string, { id: string; fuente: string; asaltos: number }>();
  const descartadas = new Set<string>();
  for (const [id, p] of porPrueba) {
    if (!p.clave) continue;
    const g = ganadora.get(p.clave);
    if (!g) {
      ganadora.set(p.clave, { id, fuente: p.fuente, asaltos: p.asaltos });
    } else if (g.fuente !== p.fuente) {
      if (p.asaltos > g.asaltos) {
        descartadas.add(g.id);
        ganadora.set(p.clave, { id, fuente: p.fuente, asaltos: p.asaltos });
      } else {
        descartadas.add(id);
      }
    }
  }
  return descartadas;
}

export function aRendimientoCaraACara(rows: readonly FilaCaraACaraRendimiento[]): RendimientoCaraACara {
  const descartadas = pruebasDescartadas(rows);
  const total = registroVacio();
  const poule = registroVacio();
  const directa = registroVacio();
  const asaltos: AsaltoCaraACaraRendimiento[] = [];
  const pruebas: PruebaCompartida[] = [];
  const delante: Record<Delante, number> = { yo: 0, rival: 0, empate: 0 };
  const temporadas = new Map<string, TemporadaCaraACara>();
  const temporada = (t: string) => {
    let v = temporadas.get(t);
    if (!v) temporadas.set(t, (v = { temporada: t, corta: temporadaCorta(t), asaltos: registroVacio(), delanteYo: 0, delanteRival: 0 }));
    return v;
  };
  const porPrueba = new Map<string, { tipo: TipoRendimiento; ambito: AmbitoCompeticion; torneo: string }>();
  const prueba = (r: FilaCaraACaraRendimiento) => {
    let p = porPrueba.get(r.pruebaId);
    if (!p) {
      const torneo = nombrePrueba({ nombre: r.torneo, formato: 'INDIVIDUAL', fuente: r.fuente });
      porPrueba.set(r.pruebaId, (p = { ...tipoRendimiento(r), torneo }));
    }
    return p;
  };
  let balance = 0;
  let nAsaltos = 0;
  let nPruebas = 0;
  for (const r of rows) {
    if (descartadas.has(r.pruebaId)) continue;
    const t = temporadaDeportiva(r.temporada);
    const { tipo, ambito, torneo } = prueba(r);
    if (r.clase === 'asalto') {
      nAsaltos += 1;
      const mios = n(r.mios);
      const suyos = n(r.suyos);
      const fase = r.fase === 'TABLEAU' ? 'TABLEAU' : 'POULE';
      if (mios > suyos) balance += 1;
      if (mios < suyos) balance -= 1;
      for (const reg of [total, fase === 'POULE' ? poule : directa, temporada(t).asaltos]) {
        reg.asaltos += 1;
        reg.dados += mios;
        reg.recibidos += suyos;
        if (mios > suyos) reg.victorias += 1;
        if (mios < suyos) reg.derrotas += 1;
      }
      asaltos.push({
        pruebaId: r.pruebaId, edicionId: r.edicionId, fecha: fechaReal(r.fechaOrden), temporada: t,
        torneo, tipo, ambito, fase, mios, suyos, balance,
      });
    } else {
      nPruebas += 1;
      const puestoYo = n(r.puestoYo);
      const puestoRival = n(r.puestoRival);
      const lado: Delante = puestoYo < puestoRival ? 'yo' : puestoYo > puestoRival ? 'rival' : 'empate';
      delante[lado] += 1;
      if (lado === 'yo') temporada(t).delanteYo += 1;
      if (lado === 'rival') temporada(t).delanteRival += 1;
      pruebas.push({
        pruebaId: r.pruebaId, edicionId: r.edicionId, fecha: fechaReal(r.fechaPrueba ?? r.fechaOrden), temporada: t,
        torneo, tipo, tono: TIPOS_RENDIMIENTO[tipo].tono, ambito, categoria: r.categoria,
        puestoYo, puestoRival,
        participantes: r.participantes == null ? null : Math.max(n(r.participantes), puestoYo, puestoRival),
        delante: lado,
      });
    }
  }
  for (const r of [total, poule, directa]) r.porcentaje = porcentaje(r.victorias, r.derrotas);
  for (const t of temporadas.values()) t.asaltos.porcentaje = porcentaje(t.asaltos.victorias, t.asaltos.derrotas);
  const media = (v: number) => (total.asaltos > 0 ? v / total.asaltos : null);
  return {
    total, poule, directa,
    tocadosPorAsalto: { yo: media(total.dados), rival: media(total.recibidos) },
    asaltos,
    pruebas,
    delante,
    porTemporada: [...temporadas.values()].sort((a, b) => a.temporada.localeCompare(b.temporada)),
    truncado: nAsaltos >= LIMITE_CARA_A_CARA_RENDIMIENTO || nPruebas >= LIMITE_CARA_A_CARA_RENDIMIENTO,
  };
}

/** Para quien ya resolvió las dos personas; un fallo devuelve `null`. */
export async function leerRendimientoCaraACaraDe(
  db: ContextoExplorador['db'],
  yo: readonly string[],
  rival: readonly string[],
): Promise<RendimientoCaraACara | null> {
  try {
    return aRendimientoCaraACara(filas<FilaCaraACaraRendimiento>(await db.execute(sqlCaraACaraRendimiento(yo, rival))));
  } catch (error) {
    console.error('[explorar] el rendimiento del cara a cara no se pudo leer:',
      error instanceof Error ? error.name : 'desconocido');
    return null;
  }
}

export type ResultadoRendimientoCaraACara =
  | { estado: 'ok'; personaId: string; rivalId: string; datos: RendimientoCaraACara }
  | { estado: 'entrada_invalida' | 'no_disponible' | 'no_encontrada' | 'misma_persona' | 'error' };

const esquemaPareja = z.object({ personaId: z.string().regex(UUID_RE), rivalId: z.string().regex(UUID_RE) }).strict();

export async function leerRendimientoCaraACara(
  ctx: ContextoExplorador,
  entrada: unknown,
): Promise<ResultadoRendimientoCaraACara> {
  await exigirPerfil(ctx);
  const analizada = esquemaPareja.safeParse(entrada);
  if (!analizada.success) return { estado: 'entrada_invalida' };
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };
  const [yo, rival] = await Promise.all([
    resolverPersona(ctx.db, analizada.data.personaId),
    resolverPersona(ctx.db, analizada.data.rivalId),
  ]);
  if (!yo || !rival) return { estado: 'no_encontrada' };
  if (yo.canonicaId === rival.canonicaId) return { estado: 'misma_persona' };
  const datos = await leerRendimientoCaraACaraDe(ctx.db, yo.ids, rival.ids);
  return datos ? { estado: 'ok', personaId: yo.canonicaId, rivalId: rival.canonicaId, datos } : { estado: 'error' };
}
