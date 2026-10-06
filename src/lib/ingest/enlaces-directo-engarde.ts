import type { PruebaEngarde } from './sources/engarde';
import { urlTorneoEngarde } from './sources/engarde';

/**
 * Emparejado de los torneos que la RFEE publica en su cuenta de Engarde
 * (`engarde-service.com/organism/rfee`) con las pruebas del calendario.
 *
 * Nunca por el nombre: la RFEE titula «TNR SABLE MASCULINO y FEMENINO
 * ABSOLUTO» lo que Skermo llama «TNR ABSOLUTO», y dos TNR del mismo fin de
 * semana se llaman igual. Una prueba de Engarde casa con una del calendario si
 * coinciden arma, género, categoría y modalidad, la fecha difiere como mucho un
 * día y la ciudad es la misma. Sin ciudad que coincida sólo se acepta si es la
 * ÚNICA prueba española con esa combinación en esos días, y queda anotado con
 * otra regla para poder distinguirlo.
 */

export const REGLA_ENGARDE_CIUDAD = 'engarde_rfee:fecha_ciudad_prueba';
export const REGLA_ENGARDE_UNICA = 'engarde_rfee:fecha_prueba_unica';

export type PruebaCalendarioDirecto = {
  competitionId: string;
  eventId: string;
  weapon: string;
  gender: string;
  category: string;
  format: string;
  /** `competition_date` o, si no hay, el inicio del evento. */
  fecha: string;
  ciudad: string | null;
  /** ISO-2. `null` cuando la fuente no lo publica. */
  pais: string | null;
  circuit?: string | null;
};

export type PruebaEngardeDirecto = Pick<
  PruebaEngarde,
  | 'org'
  | 'evt'
  | 'compe'
  | 'url'
  | 'titulo'
  | 'arma'
  | 'genero'
  | 'categoria'
  | 'categoriaContradictoria'
  | 'individual'
  | 'fecha'
  | 'ciudad'
>;

type Division = 'oro' | 'plata' | 'bronce' | 'iberdrola';

const DIVISION_DE_CIRCUITO: Record<string, Division> = {
  LIGA_ORO: 'oro',
  LIGA_PLATA: 'plata',
  LIGA_BRONCE: 'bronce',
  LIGA_IBERDROLA: 'iberdrola',
};

/**
 * La liga por equipos de un mismo fin de semana se tira en tres divisiones
 * con la misma arma, género y categoría: la división es lo único que separa
 * «LIGA ORO FLORETE MAS» de «LIGA PLATA FLORETE MAS».
 */
export function divisionDeEngarde(titulo: string, compe: string): Division | null {
  const t = `${titulo} ${compe.replace(/[_-]/g, ' ')}`
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  if (/iberdrola/.test(t)) return 'iberdrola';
  if (/\bplata\b|\bpt\b/.test(t)) return 'plata';
  if (/\bbronce\b|\b4\S*\s*division/.test(t)) return 'bronce';
  if (/\boro\b/.test(t)) return 'oro';
  return null;
}

/** El índice deja a veces el arma en «-»; el título la dice. */
function armaDeTitulo(titulo: string): string | null {
  const t = titulo.toUpperCase();
  const armas = [
    t.includes('ESPADA') || /\bEPEE\b/.test(t) ? 'ESPADA' : null,
    t.includes('FLORETE') || /\bFOIL\b/.test(t) ? 'FLORETE' : null,
    t.includes('SABLE') || /\bSABRE\b/.test(t) ? 'SABLE' : null,
  ].filter(Boolean);
  return armas.length === 1 ? armas[0] : null;
}

export type EnlaceEmparejado = {
  eventId: string;
  /** `null` = enlace del torneo entero. */
  competitionId: string | null;
  url: string;
  regla: string;
};

export function claveCiudad(ciudad: string | null | undefined): string {
  return (ciudad ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function distancia(a: string, b: string): number {
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let previo = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const actual = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, previo + (a[i - 1] === b[j - 1] ? 0 : 1));
      previo = actual;
    }
  }
  return fila[b.length];
}

/**
 * Engarde recorta («MEDINA DEL.» por «Medina del Campo») y Skermo tiene
 * erratas («ESPLUES DE LLOBREGAT»): basta con que una clave contenga a la otra
 * (cinco letras como mínimo) o con que se parezcan casi del todo.
 */
export function mismaCiudad(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = claveCiudad(a);
  const y = claveCiudad(b);
  if (x.length < 3 || y.length < 3) return false;
  if (x === y) return true;
  const [corta, larga] = x.length <= y.length ? [x, y] : [y, x];
  if (corta.length >= 5 && larga.includes(corta)) return true;
  return larga.length >= 8 && distancia(x, y) / larga.length <= 0.15;
}

function dias(iso: string): number {
  return Math.round(Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) / 86_400_000);
}

const esEspana = (pais: string | null) => pais === null || pais === 'ES';

/**
 * Empareja las pruebas de UN torneo de Engarde con el calendario.
 *
 * Devuelve un enlace por prueba del calendario (a la página de su prueba en
 * Engarde) y uno por evento (a la página del torneo), éste sólo si al menos
 * una de sus pruebas casó. Una prueba del calendario reclamada por dos pruebas
 * de Engarde se queda sin enlace: ante la duda, nada.
 */
export function emparejarTorneoEngarde(
  pruebas: readonly PruebaEngardeDirecto[],
  calendario: readonly PruebaCalendarioDirecto[],
): { enlaces: EnlaceEmparejado[]; sinPareja: number; ambiguas: number } {
  const elegidas = new Map<string, { prueba: PruebaEngardeDirecto; cal: PruebaCalendarioDirecto; regla: string }[]>();
  let sinPareja = 0;
  let ambiguas = 0;

  for (const p of pruebas) {
    const arma = p.arma ?? armaDeTitulo(p.titulo);
    if (!arma || !p.genero || !p.categoria || p.categoriaContradictoria || p.individual === null || !p.fecha) {
      sinPareja += 1;
      continue;
    }
    const formato = p.individual ? 'INDIVIDUAL' : 'EQUIPOS';
    const division = formato === 'EQUIPOS' ? divisionDeEngarde(p.titulo, p.compe) : null;
    const candidatos = calendario.filter(
      (c) =>
        c.weapon === arma &&
        c.gender === p.genero &&
        c.category === p.categoria &&
        c.format === formato &&
        (formato === 'INDIVIDUAL' || (DIVISION_DE_CIRCUITO[c.circuit ?? ''] ?? null) === division) &&
        Math.abs(dias(c.fecha) - dias(p.fecha!)) <= 1,
    );
    const porCiudad = candidatos.filter((c) => mismaCiudad(c.ciudad, p.ciudad));
    let elegido: PruebaCalendarioDirecto | null = null;
    let regla = REGLA_ENGARDE_CIUDAD;
    if (porCiudad.length === 1) {
      elegido = porCiudad[0];
    } else if (porCiudad.length === 0) {
      const espanolas = candidatos.filter((c) => esEspana(c.pais));
      if (espanolas.length === 1 && candidatos.length === 1) {
        elegido = espanolas[0];
        regla = REGLA_ENGARDE_UNICA;
      }
    }
    if (!elegido) {
      if (candidatos.length > 1) ambiguas += 1;
      else sinPareja += 1;
      continue;
    }
    const lista = elegidas.get(elegido.competitionId) ?? [];
    lista.push({ prueba: p, cal: elegido, regla });
    elegidas.set(elegido.competitionId, lista);
  }

  const enlaces: EnlaceEmparejado[] = [];
  const reglaPorEvento = new Map<string, { eventId: string; regla: string; org: string; evt: string }>();
  for (const todas of elegidas.values()) {
    // «1ª FASE» y «2ª FASE» son la misma prueba partida en dos días: se enlaza la última, que
    // es la que acaba publicando la clasificación final.
    const lista =
      todas.length > 1 && todas.every((x) => /\bfase\b/i.test(x.prueba.titulo))
        ? [todas.reduce((a, b) => ((b.prueba.fecha ?? '') > (a.prueba.fecha ?? '') ? b : a))]
        : todas;
    if (lista.length > 1) {
      ambiguas += lista.length;
      continue;
    }
    const [{ prueba, cal, regla }] = lista;
    enlaces.push({ eventId: cal.eventId, competitionId: cal.competitionId, url: prueba.url, regla });
    const clave = `${cal.eventId}|${prueba.org}|${prueba.evt}`;
    const previa = reglaPorEvento.get(clave);
    // La regla del torneo es la más débil de sus pruebas.
    if (!previa || regla === REGLA_ENGARDE_UNICA) {
      reglaPorEvento.set(clave, { eventId: cal.eventId, regla, org: prueba.org, evt: prueba.evt });
    }
  }
  for (const { eventId, regla, org, evt } of reglaPorEvento.values()) {
    enlaces.push({ eventId, competitionId: null, url: urlTorneoEngarde(org, evt), regla });
  }
  return { enlaces: sinTorneoAmbiguo(enlaces), sinPareja, ambiguas };
}

/**
 * Un evento del calendario puede corresponder a varios torneos de Engarde
 * (por ejemplo, uno por arma). Entonces ninguno es «el del torneo» y no se
 * elige uno al azar: ese evento se queda sin enlace de torneo, y los de cada
 * prueba siguen. Se aplica sobre todos los torneos de una pasada juntos.
 */
export function sinTorneoAmbiguo<T extends { eventId: string; competitionId: string | null; url: string }>(
  enlaces: readonly T[],
): T[] {
  const urls = new Map<string, Set<string>>();
  for (const e of enlaces) {
    if (e.competitionId !== null) continue;
    const s = urls.get(e.eventId) ?? new Set<string>();
    s.add(e.url);
    urls.set(e.eventId, s);
  }
  return enlaces.filter((e) => e.competitionId !== null || (urls.get(e.eventId)?.size ?? 0) <= 1);
}

/** Lo que devuelve `prog/getTournois.php` por torneo. */
export type TorneoListaEngarde = { Organisme?: string; Event?: string; Titre?: string; date?: string };

/** Lista de torneos de un organismo. `null` si la respuesta no es la esperada. */
export function parsearListaTorneosEngarde(cuerpo: string, organismo: string): { evt: string; titulo: string; fecha: string }[] | null {
  let j: { result?: TorneoListaEngarde[] };
  try {
    j = JSON.parse(cuerpo.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  if (!Array.isArray(j.result)) return null;
  return j.result.flatMap((t) =>
    t.Organisme?.toLowerCase() === organismo &&
    typeof t.Event === 'string' &&
    /^[a-z0-9_-]{1,60}$/i.test(t.Event) &&
    typeof t.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(t.date)
      ? [{ evt: t.Event, titulo: t.Titre ?? '', fecha: t.date }]
      : [],
  );
}

/**
 * Torneos que merece la pena mirar esta noche: los que empiezan en los
 * próximos `diasFuturo` días y los que empezaron hace como mucho
 * `diasPasado` (un torneo de tres días sigue en directo y luego publica la
 * clasificación final).
 */
export function torneosEnVentanaEngarde<T extends { fecha: string }>(
  torneos: readonly T[],
  hoy: string,
  { diasPasado = 7, diasFuturo = 45 }: { diasPasado?: number; diasFuturo?: number } = {},
): T[] {
  const h = dias(hoy);
  return torneos.filter((t) => {
    const d = dias(t.fecha) - h;
    return d >= -diasPasado && d <= diasFuturo;
  });
}
