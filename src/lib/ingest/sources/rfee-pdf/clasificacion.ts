import { agruparValores, normalizar, redondear, textoFila, type Fila } from './geometria';
import type { PaginaAnalizada } from './paginas';
import type { Formato, ItemTexto, PuestoPdf, Rechazo, Region } from './tipos';

/**
 * «Clasificación general final» de un PDF de Engarde: un puesto por fila.
 *
 * Los puestos son los publicados: los empates repiten número y el siguiente
 * conserva el suyo (3, 3, 5), y un literal que no es un número («Ganador»,
 * «Abandono») se guarda como texto sin inventar el puesto. La clasificación
 * es también el registro de participantes del documento: de ella salen las
 * referencias que usan poules y cuadro.
 *
 * La fila de cabecera de la tabla dice QUÉ columnas hay y en qué orden, pero
 * no dónde empiezan sus datos: Engarde desplaza a veces las etiquetas respecto
 * a los textos. Por eso las columnas se sitúan con los datos y se nombran con
 * la cabecera; si no cuadran, la fila no se atribuye.
 */

export type LecturaClasificacion = {
  puestos: PuestoPdf[];
  rechazos: Rechazo[];
  /** Total que declara el encabezado («- 28 tiradores»), si lo declara. */
  publicado: number | null;
  unidad: Formato | null;
  /** Encabezados con totales distintos entre páginas. */
  totalesContradictorios: boolean;
  paginas: number;
};

// Castellano, catalán («tiradors», «equips»), inglés («fencers», «teams») y francés («tireurs», «équipes»).
const RE_TOTAL = /-\s*(\d+)\s+(TIRADORES|TIRADORAS|TIRADORS|EQUIPOS|EQUIPS|FENCERS|TEAMS|TIREURS|TIREUSES|EQUIPES)\)/;
const UNIDAD_EQUIPOS = new Set(['EQUIPOS', 'EQUIPS', 'TEAMS', 'EQUIPES']);
export const RE_COLUMNA_PUESTO = /^(CL\.?|CLAS\.?|POS\.?|LUGAR|RANK|RAN|RG)$/;
const RE_CABECERA_UNIDA = /^(CL\.?|CLAS\.?|POS\.?|LUGAR) (APELLIDO[- ]NOM(?:BRE)?|APELLIDOS? NOMBRE|NOMBRE|EQUIPOS?)$/;
export const RE_PUESTO_TEXTO =
  /^(GANAN?DOR[A]?|FINALISTA|ABANDONO|ABANDONAMENT|ABAND\.?|RETIRAD[OA]|RET\.?|EXCLUID[OA]|EXCLOSA?|EXC\.?|DESCALIFICAD[OA]|DESC\.?|NO PRESENTAD[OA]|NP|DNS|DNF|DQ|FORFAIT|-+)$/;
/** Valores de la columna «Condición» («Estatus», «Status»): no son parte del club. */
const RE_CONDICION =
  /^(ABANDONO|ABANDONAMENT|ABAND\.?|RETIRAD[OA]|RET\.?|EXCLUID[OA]|EXCLOSA?|EXC\.?|DESCALIFICAD[OA]|DESC\.?|NO PRESENTAD[OA]|NP|DNS|DNF|DQ|FORFAIT)$/;
/** Código de país de tres letras; la columna «Nación» publica a veces códigos de club. */
const RE_PAIS = /^[A-Z]{3}$/;

type Columna = 'puesto' | 'nombre' | 'equipo' | 'bandera' | 'club' | 'pais' | 'condicion';

// Etiquetas de Engarde en castellano, catalán e inglés. PDF.js junta en un solo
// texto las de columnas contiguas («BAND CLUB», «CL. APELLIDO NOMBRE»): una
// etiqueta se lee como una secuencia de columnas, la más larga primero.
const ETIQUETAS: [string, Columna][] = ([
  ['NAME AND FIRST NAME', 'nombre'], ['APELLIDOS NOMBRE', 'nombre'], ['APELLIDO NOMBRE', 'nombre'],
  ['APELLIDO-NOMBRE', 'nombre'], ['APELLIDO-NOM', 'nombre'], ['COGNOMS NOM', 'nombre'], ['COGNOM NOM', 'nombre'],
  ['FIRST NAME', 'nombre'], ['APELLIDOS', 'nombre'], ['APELLIDO', 'nombre'], ['COGNOMS', 'nombre'], ['COGNOM', 'nombre'],
  ['SURNAME', 'nombre'], ['NOMBRE', 'nombre'], ['NAME', 'nombre'], ['NOM PRENOM', 'nombre'], ['NOM', 'nombre'],
  ['RG', 'puesto'], ['DRAP', 'bandera'], ['NAT.', 'pais'], ['NAT', 'pais'], ['STATUT', 'condicion'],
  ['EQUIPOS', 'equipo'], ['EQUIPO', 'equipo'], ['EQUIPS', 'equipo'], ['EQUIP', 'equipo'], ['TEAMS', 'equipo'], ['TEAM', 'equipo'],
  ['CLAS.', 'puesto'], ['CLAS', 'puesto'], ['CL.', 'puesto'], ['CL', 'puesto'], ['POS.', 'puesto'], ['POS', 'puesto'],
  ['LUGAR', 'puesto'], ['RANK', 'puesto'], ['RAN', 'puesto'],
  ['BANDERA', 'bandera'], ['BAND.', 'bandera'], ['BAND', 'bandera'], ['FLAG', 'bandera'],
  ['CLUBS', 'club'], ['CLUB', 'club'], ['CLU', 'club'],
  ['NACIONALIDAD', 'pais'], ['NACION', 'pais'], ['NACI?N', 'pais'], ['NACIO', 'pais'], ['NAC.', 'pais'], ['NAC', 'pais'],
  ['NATION', 'pais'], ['PAIS', 'pais'], ['COUNTRY', 'pais'],
  ['CONDICION', 'condicion'], ['CONDICI?N', 'condicion'], ['ESTATUS', 'condicion'], ['STATUS', 'condicion'], ['ESTADO', 'condicion'],
] as [string, Columna][]).sort((a, b) => b[0].length - a[0].length);

const DE_NOMBRE = new Set<Columna>(['nombre', 'equipo']);

function columnasDeEtiqueta(texto: string): Columna[] | null {
  let s = normalizar(texto);
  const columnas: Columna[] = [];
  while (s.length > 0) {
    const e = ETIQUETAS.find(([t]) => s === t || s.startsWith(`${t} `));
    if (!e) return null;
    columnas.push(e[1]);
    s = s.slice(e[0].length).trim();
  }
  return columnas;
}

type CabeceraTabla = {
  /**
   * Columnas con texto en el orden de la página (el nombre, en una o varias;
   * club y país), con el `x` de la etiqueta en la que aparecen.
   */
  texto: { tipo: Columna; x: number }[];
  /** El primer texto junta puesto y nombre («CL. APELLIDO NOMBRE»). */
  unida: boolean;
  condicion: boolean;
  personas: boolean;
  equipos: boolean;
};

/** La cabecera de la tabla sólo cuenta si se reconocen TODAS sus etiquetas. */
function leerCabeceraTabla(f: Fila): CabeceraTabla | null {
  const grupos = f.items.map((i) => ({ x: i.x, columnas: columnasDeEtiqueta(i.s) }));
  if (grupos.length === 0 || grupos.some((g) => g.columnas === null || g.columnas.length === 0)) return null;
  const todas = grupos.flatMap((g) => (g.columnas as Columna[]).map((tipo) => ({ tipo, x: g.x })));
  const cuantas = (c: Columna) => todas.filter((t) => t.tipo === c).length;
  if (todas[0].tipo !== 'puesto' || cuantas('puesto') !== 1) return null;
  if ((['bandera', 'club', 'pais', 'condicion'] as const).some((c) => cuantas(c) > 1)) return null;
  const texto = todas.filter((t) => DE_NOMBRE.has(t.tipo) || t.tipo === 'club' || t.tipo === 'pais');
  const otros = texto.findIndex((t) => !DE_NOMBRE.has(t.tipo));
  // El nombre va primero; un nombre detrás del club es una tabla que no conocemos.
  if (texto.length === 0 || !DE_NOMBRE.has(texto[0].tipo) || (otros >= 0 && texto.slice(otros).some((t) => DE_NOMBRE.has(t.tipo)))) {
    return null;
  }
  const primera = grupos[0].columnas as Columna[];
  return {
    texto,
    unida: primera.length > 1 && DE_NOMBRE.has(primera[1]),
    condicion: cuantas('condicion') > 0,
    personas: cuantas('nombre') > 0,
    equipos: cuantas('equipo') > 0,
  };
}

type Leida =
  | { tipo: 'puesto'; fila: Fila; puesto: string; nombre: string; club: string | null; pais: string | null }
  | { tipo: 'integrante'; fila: Fila }
  | { tipo: 'rechazo'; fila: Fila; motivo: string };

const SIN_PUESTO = 'Fila de clasificación sin puesto publicado';
const NO_ATRIBUIBLE = 'Fila de clasificación no atribuible a nombre y club';
const maquetacion = (n: number) => `Maquetación de columnas no reconocida (${n})`;

const esTextoDePuesto = (s: string): boolean => /^\d{1,4}$/.test(s.trim()) || RE_PUESTO_TEXTO.test(normalizar(s));

const sinPuesto = (f: Fila, unidad: Formato | null): Leida =>
  // Integrantes de un equipo: líneas con un solo texto bajo su equipo.
  f.items.length === 1 && unidad === 'EQUIPOS' ? { tipo: 'integrante', fila: f } : { tipo: 'rechazo', fila: f, motivo: SIN_PUESTO };

/**
 * PDF.js publica a veces «3 APELLIDO NOMBRE» como un solo texto. Se parte sólo
 * bajo una cabecera que une puesto y nombre; ambos conservan la geometría del
 * original: ni ancho inferido ni puestos renumerados.
 */
function partirPuestoUnido(f: Fila): Fila {
  const primero = f.items[0];
  const unido = primero?.s.trim().match(/^(\d{1,4})\s+(\p{L}.*)$/u);
  return unido ? { ...f, items: [{ ...primero, s: unido[1] }, { ...primero, s: unido[2] }, ...f.items.slice(1)] } : f;
}

/**
 * Las columnas se deducen de dónde empieza el texto de las filas con puesto
 * (al menos una de cada cinco), no de su orden: una fila sin club no desplaza
 * el resto.
 */
function columnasDeDatos(xs: readonly number[], filas: number): number[] {
  const apoyo = Math.max(1, Math.floor(filas * 0.2));
  return agruparValores(xs, 4).filter((c) => c.n >= apoyo).map((c) => c.centro);
}

/**
 * Un texto pertenece a la última columna que empieza a su izquierda: los
 * apellidos compuestos parten el texto en varios ítems de la misma columna.
 */
function repartir(columnas: readonly number[], items: readonly ItemTexto[]): string[] | null {
  const celdas = columnas.map(() => '');
  for (const it of items) {
    let k = -1;
    for (let c = 0; c < columnas.length; c += 1) if (columnas[c] <= it.x + 4) k = c;
    if (k < 0) return null;
    celdas[k] = `${celdas[k]} ${it.s}`.trim();
  }
  return celdas;
}

/** Sin cabecera reconocida: una columna es el nombre; dos, nombre y club; tres, apellidos, nombre y club. */
function leerSinCabecera(cuerpo: readonly Fila[], unidad: Formato | null): Leida[] {
  const conPuesto = (f: Fila) => f.items.length >= 2 && esTextoDePuesto(f.items[0].s);
  const filasPuesto = cuerpo.filter(conPuesto);
  const columnas = columnasDeDatos(filasPuesto.flatMap((f) => f.items.slice(1).map((i) => i.x)), filasPuesto.length);
  return cuerpo.map((f): Leida => {
    if (!conPuesto(f)) return sinPuesto(f, unidad);
    if (columnas.length < 1 || columnas.length > 3) return { tipo: 'rechazo', fila: f, motivo: maquetacion(columnas.length) };
    const c = repartir(columnas, f.items.slice(1));
    const nombre = c === null ? '' : columnas.length === 3 ? `${c[0]} ${c[1]}`.trim() : c[0];
    if (c === null || nombre.length < 2) return { tipo: 'rechazo', fila: f, motivo: NO_ATRIBUIBLE };
    const club = columnas.length === 1 ? null : c[columnas.length - 1] || null;
    return { tipo: 'puesto', fila: f, puesto: f.items[0].s.trim(), nombre, club, pais: null };
  });
}

function leerConCabecera(cuerpo: readonly Fila[], cab: CabeceraTabla, unidad: Formato | null): Leida[] {
  const filas = cuerpo.map((original) => {
    const f = cab.unida ? partirPuestoUnido(original) : original;
    const numerada = f.items.length >= 2 && esTextoDePuesto(f.items[0].s);
    let datos = numerada ? f.items.slice(1) : f.items;
    let condicion: string | null = null;
    const ultimo = datos[datos.length - 1];
    if (cab.condicion && datos.length >= 2 && RE_CONDICION.test(normalizar(ultimo.s))) {
      condicion = ultimo.s.trim();
      datos = datos.slice(0, -1);
    }
    // Sin puesto, la condición publicada («DNS», «EXC») es el literal del puesto.
    return { fila: original, numerada, puesto: numerada ? f.items[0].s.trim() : condicion, datos };
  });

  // La primera columna es siempre el nombre, que abre cada fila. Con el puesto
  // unido, ese texto empieza donde el número (y «1» no empieza donde «10»), así
  // que sólo se sitúan con los datos las columnas que le siguen.
  const numeradas = filas.filter((r) => r.numerada);
  const columnas = [
    Number.NEGATIVE_INFINITY,
    ...columnasDeDatos(numeradas.flatMap((r) => r.datos.slice(1).map((i) => i.x)), numeradas.length),
  ];
  // A qué columna declarada va cada columna de datos. Si hay tantas como
  // declaradas, por orden: las etiquetas pueden estar desplazadas. Si hay menos
  // (alguna casi vacía), bajo la última etiqueta que empieza a su izquierda. Si
  // hay más, no se sabe qué es cada una.
  const declaradas = cab.texto.length;
  const destino = ((): number[] | null => {
    if (columnas.length === declaradas) return columnas.map((_, k) => k);
    if (columnas.length > declaradas) return null;
    const d = [0];
    for (const x of columnas.slice(1)) {
      let j = -1;
      for (let t = 1; t < declaradas; t += 1) if (cab.texto[t].x <= x + 8) j = t;
      if (j <= d[d.length - 1]) return null;
      d.push(j);
    }
    return d;
  })();

  return filas.map((r): Leida => {
    if (r.puesto === null) return sinPuesto(r.fila, unidad);
    const c = repartir(columnas, r.datos) ?? [];
    // Sin correspondencia sólo vale la fila que no publica más que el nombre.
    if (destino === null && c.slice(1).some((t) => t !== '')) {
      return { tipo: 'rechazo', fila: r.fila, motivo: maquetacion(columnas.length) };
    }
    const celdas = cab.texto.map((_, j) => (destino ? c[destino.indexOf(j)] ?? '' : j === 0 ? c[0] ?? '' : ''));
    const celda = (tipo: Columna): string | null => {
      const j = cab.texto.findIndex((t) => t.tipo === tipo);
      return j >= 0 ? celdas[j] || null : null;
    };
    const nombre = cab.texto.flatMap((t, j) => (DE_NOMBRE.has(t.tipo) && celdas[j] ? [celdas[j]] : [])).join(' ');
    if (nombre.length < 2 || RE_CONDICION.test(normalizar(nombre))) return { tipo: 'rechazo', fila: r.fila, motivo: NO_ATRIBUIBLE };
    const nacion = celda('pais');
    const pais = nacion !== null && RE_PAIS.test(normalizar(nacion)) ? normalizar(nacion) : null;
    // Lo que «Nación» publica sin ser un país es un código de club: vale como club si no hay otro.
    const club = celda('club') ?? (pais === null ? nacion : null);
    return { tipo: 'puesto', fila: r.fila, puesto: r.puesto, nombre, club, pais };
  });
}

const region = (pagina: number, y: number): Region => ({ pagina, yMax: redondear(y + 7), yMin: redondear(y - 3) });

export function leerClasificacion(paginas: readonly PaginaAnalizada[]): LecturaClasificacion {
  const puestos: PuestoPdf[] = [];
  const rechazos: Rechazo[] = [];
  const totales = new Set<number>();
  let unidad: Formato | null = null;
  let n = 0;

  for (const pg of paginas) {
    const encabezado = normalizar(textoFila(pg.filas[0]));
    const total = encabezado.match(RE_TOTAL);
    if (total) {
      totales.add(Number(total[1]));
      unidad = UNIDAD_EQUIPOS.has(total[2]) ? 'EQUIPOS' : 'INDIVIDUAL';
    }

    let cuerpo: Fila[] = pg.filas.slice(1);
    const cabecera = cuerpo.length > 0 ? leerCabeceraTabla(cuerpo[0]) : null;
    let leidas: Leida[];
    if (cabecera) {
      // Sin total declarado, una columna de nombre sin columna de equipo es la tabla de personas.
      if (unidad === null && cabecera.personas && !cabecera.equipos) unidad = 'INDIVIDUAL';
      leidas = leerConCabecera(cuerpo.slice(1), cabecera, unidad);
    } else {
      const unida = cuerpo.length > 0 && RE_CABECERA_UNIDA.test(normalizar(cuerpo[0].items[0].s));
      if (cuerpo.length > 0 && (RE_COLUMNA_PUESTO.test(normalizar(cuerpo[0].items[0].s)) || unida)) {
        const columnasTabla = cuerpo[0].items.map((i) => normalizar(i.s));
        if (unidad === null && columnasTabla.some((c) => /(^| )(NOMBRE|APELLIDO-NOM)$/.test(c)) &&
          !columnasTabla.some((c) => /(^| )EQUIPOS?$/.test(c))) {
          unidad = 'INDIVIDUAL';
        }
        cuerpo.shift();
      }
      if (unida) cuerpo = cuerpo.map(partirPuestoUnido);
      leidas = leerSinCabecera(cuerpo, unidad);
    }

    for (const l of leidas) {
      if (l.tipo === 'integrante') continue;
      if (l.tipo === 'rechazo') {
        rechazos.push({ seccion: 'puestos', region: region(pg.numero, l.fila.y), motivo: l.motivo });
        continue;
      }
      const numerico = /^\d{1,4}$/.test(l.puesto);
      n += 1;
      puestos.push({
        sourceFactKey: `pdf:p${pg.numero}:y${Math.round(l.fila.y)}`,
        ref: `${unidad === 'EQUIPOS' ? 't' : 'p'}${String(n).padStart(4, '0')}`,
        posicion: numerico ? Number(l.puesto) : null,
        posicionRaw: numerico ? null : l.puesto,
        nombre: l.nombre,
        club: l.club,
        ...(l.pais ? { pais: l.pais } : {}),
        region: region(pg.numero, l.fila.y),
      });
    }
  }

  return {
    puestos,
    rechazos,
    publicado: totales.size === 1 ? [...totales][0] : null,
    unidad,
    totalesContradictorios: totales.size > 1,
    paginas: paginas.length,
  };
}
