/**
 * Qué lectura de una fase (poule o cuadro) se queda cuando dos fuentes publican la misma:
 * la del PDF de la RFEE, la de Engarde (también la que se saca de Skermo) o la ya guardada.
 * Lo usan `dedupe-pruebas.ts#fundirDuplicados` y `medir-solapes.ts#depurarSolapesEngarde`.
 *
 * Un marcador imposible delata una lectura mala (columna desplazada, ganador y perdedor
 * cambiados al leer el PDF):
 *  - `ambos_cinco`: en una poule a 5 (ningún asalto de la poule llega a 10; las de equipos van
 *    a 45) los dos llegan a 5 (5-5, 6-5);
 *  - `empate`: mismos tocados; sport_bout no guarda la prioridad, así que no hay ganador;
 *  - `ganador_incoherente`: en directa, el perdedor de una ronda tira la siguiente, o el
 *    ganador no sale en la siguiente ronda cuando ésta está completa;
 *  - `perdedor_por_delante`: en directa, el perdedor tiene mejor puesto final que el ganador.
 *
 * Orden: más asaltos válidos (sin anomalía), menos anomalías, Engarde antes que el PDF y,
 * a igualdad de todo, la que ya está en la prueba destino (así una recarga no cambia nada).
 */

export const TIPOS_ANOMALIA = ['ambos_cinco', 'empate', 'ganador_incoherente', 'perdedor_por_delante'] as const;
export type TipoAnomalia = (typeof TIPOS_ANOMALIA)[number];

export type AsaltoLectura = {
  fase: 'POULE' | 'TABLEAU';
  ronda: string;
  a: string;
  b: string;
  nombreA: string;
  nombreB: string;
  tocadosA: number | null;
  tocadosB: number | null;
};

/** Puesto final de un nombre y el grupo (prueba) donde se publicó: sólo se comparan puestos del mismo grupo. */
export type PuestoDe = (nombre: string) => { grupo: string; puesto: number } | null;

export type Anomalias = {
  /** Asaltos con al menos una anomalía (cada asalto cuenta una vez, con su primer tipo). */
  asaltos: number;
  tipos: Partial<Record<TipoAnomalia, number>>;
};

function rondaDe(clave: string): { familia: string; tam: number } | null {
  const m = /^(.*?)(\d+)$/.exec(clave);
  if (!m) return null;
  const tam = Number(m[2]);
  return tam >= 2 && (tam & (tam - 1)) === 0 ? { familia: m[1], tam } : null;
}

export function anomaliasLectura(asaltos: readonly AsaltoLectura[], puestoDe?: PuestoDe): Anomalias {
  const out: Anomalias = { asaltos: 0, tipos: {} };
  // Participantes de cada ronda de directa, para seguir a ganadores y perdedores.
  const enRonda = new Map<string, Set<string>>();
  const asaltosRonda = new Map<string, number>();
  for (const x of asaltos) {
    if (x.fase !== 'TABLEAU') continue;
    const s = enRonda.get(x.ronda) ?? enRonda.set(x.ronda, new Set()).get(x.ronda)!;
    s.add(x.a);
    s.add(x.b);
    asaltosRonda.set(x.ronda, (asaltosRonda.get(x.ronda) ?? 0) + 1);
  }
  // Las poules de equipos (relevos a 45) también son POULE: sólo una poule a 5 tiene el tope en 5.
  const maximoPoule = new Map<string, number>();
  for (const x of asaltos) {
    if (x.fase !== 'POULE') continue;
    maximoPoule.set(x.ronda, Math.max(maximoPoule.get(x.ronda) ?? 0, x.tocadosA ?? 0, x.tocadosB ?? 0));
  }
  for (const x of asaltos) {
    if (x.tocadosA === null || x.tocadosB === null) continue;
    let tipo: TipoAnomalia | null = null;
    if (x.fase === 'POULE' && x.tocadosA >= 5 && x.tocadosB >= 5 && maximoPoule.get(x.ronda)! < 10) tipo = 'ambos_cinco';
    else if (x.tocadosA === x.tocadosB) tipo = 'empate';
    else if (x.fase === 'TABLEAU') {
      const [ganador, perdedor, nGanador, nPerdedor] = x.tocadosA > x.tocadosB
        ? [x.a, x.b, x.nombreA, x.nombreB] : [x.b, x.a, x.nombreB, x.nombreA];
      const r = rondaDe(x.ronda);
      const siguiente = r && r.tam > 2 ? `${r.familia}${r.tam / 2}` : null;
      const s = siguiente ? enRonda.get(siguiente) : undefined;
      if (s && r) {
        const completa = (asaltosRonda.get(siguiente!) ?? 0) === r.tam / 4;
        if (s.has(perdedor) || (completa && !s.has(ganador))) tipo = 'ganador_incoherente';
      }
      if (!tipo && puestoDe) {
        const pg = puestoDe(nGanador);
        const pp = puestoDe(nPerdedor);
        if (pg && pp && pg.grupo === pp.grupo && pp.puesto < pg.puesto) tipo = 'perdedor_por_delante';
      }
    }
    if (!tipo) continue;
    out.asaltos += 1;
    out.tipos[tipo] = (out.tipos[tipo] ?? 0) + 1;
  }
  return out;
}

export type Lectura<T = unknown> = {
  ref: T;
  asaltos: number;
  anomalias: number;
  /** La fase la publicó Engarde (o se sacó de Skermo en formato Engarde). */
  engarde: boolean;
  /** Es la lectura que ya está en la prueba destino. */
  destino: boolean;
};

export type MotivoLectura = 'unica' | 'mas_asaltos' | 'anomalias' | 'engarde' | 'destino';

function clave(l: Lectura): number[] {
  return [l.asaltos - l.anomalias, -l.anomalias, l.engarde ? 1 : 0, l.destino ? 1 : 0];
}

/** La lectura que gana y por qué gana frente a la segunda. */
export function elegirLectura<T>(lecturas: readonly Lectura<T>[]): { ganadora: Lectura<T>; motivo: MotivoLectura } {
  if (lecturas.length === 0) throw new Error('elegirLectura: sin lecturas');
  const orden = [...lecturas].sort((x, y) => {
    const a = clave(x);
    const b = clave(y);
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return b[i] - a[i];
    return 0;
  });
  const [ganadora, segunda] = orden;
  if (!segunda) return { ganadora, motivo: 'unica' };
  const a = clave(ganadora);
  const b = clave(segunda);
  let motivo: MotivoLectura = 'destino';
  if (a[0] !== b[0]) motivo = ganadora.asaltos > segunda.asaltos && ganadora.anomalias <= segunda.anomalias ? 'mas_asaltos' : 'anomalias';
  else if (a[1] !== b[1]) motivo = 'anomalias';
  else if (a[2] !== b[2]) motivo = 'engarde';
  return { ganadora, motivo };
}

/** Contadores que dejan los dos pasos en su informe. */
export type InformeLecturas = {
  fasesComparadas: number;
  porMotivo: Partial<Record<MotivoLectura, number>>;
  /** Asaltos con anomalía en todas las lecturas comparadas, por tipo. */
  anomalias: Partial<Record<TipoAnomalia, number>>;
  /** Asaltos con anomalía que se quedan (en la lectura ganadora). */
  anomaliasConservadas: number;
  ejemplos: { prueba: string; fase: string; ganadora: string; motivo: MotivoLectura; lecturas: string[] }[];
};

export function nuevoInformeLecturas(): InformeLecturas {
  return { fasesComparadas: 0, porMotivo: {}, anomalias: {}, anomaliasConservadas: 0, ejemplos: [] };
}

export function anotarEleccion(
  inf: InformeLecturas,
  prueba: string,
  fase: string,
  lecturas: readonly (Lectura<string> & { tipos: Anomalias['tipos'] })[],
  eleccion: { ganadora: Lectura<string>; motivo: MotivoLectura },
): void {
  if (lecturas.length < 2) return;
  inf.fasesComparadas += 1;
  inf.porMotivo[eleccion.motivo] = (inf.porMotivo[eleccion.motivo] ?? 0) + 1;
  for (const l of lecturas) {
    for (const [t, n] of Object.entries(l.tipos) as [TipoAnomalia, number][]) inf.anomalias[t] = (inf.anomalias[t] ?? 0) + n;
  }
  inf.anomaliasConservadas += eleccion.ganadora.anomalias;
  const interesante = eleccion.motivo === 'anomalias' || eleccion.motivo === 'engarde';
  if (interesante && inf.ejemplos.length < 60) {
    inf.ejemplos.push({
      prueba, fase, ganadora: eleccion.ganadora.ref, motivo: eleccion.motivo,
      lecturas: lecturas.map((l) => `${l.ref}: ${l.asaltos} asaltos, ${l.anomalias} anomalías`),
    });
  }
}
