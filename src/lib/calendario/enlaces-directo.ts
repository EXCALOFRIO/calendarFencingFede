/**
 * Enlaces para seguir una prueba en directo y consultar después sus
 * resultados: Engarde (RFEE y organizadores), Fencing Time Live (casi todo lo
 * internacional, publicado por la FIE), Ophardt / Fencing Worldwide y la propia
 * FIE.
 *
 * Fencing Time Live exige cuenta incluso para buscar: aquí sólo se enlaza la
 * URL pública que publica la FIE o el organizador y se abre en otra pestaña;
 * nunca se consulta con la sesión de nadie.
 */

export type ProveedorDirecto = 'engarde' | 'ftl' | 'ophardt' | 'fie' | 'otro';

export type EnlaceDirecto = { url: string; proveedor: ProveedorDirecto };

export const NOMBRE_PROVEEDOR: Record<ProveedorDirecto, string> = {
  engarde: 'Engarde',
  ftl: 'Fencing Time Live',
  ophardt: 'Ophardt',
  fie: 'FIE',
  otro: 'la web del organizador',
};

/** Cuanto menor, más específico del directo. Desempata entre fuentes de un mismo torneo. */
export const PRIORIDAD_PROVEEDOR: Record<ProveedorDirecto, number> = {
  engarde: 0,
  ftl: 1,
  ophardt: 2,
  fie: 3,
  otro: 4,
};

function hostDe(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function proveedorDeUrl(url: string): ProveedorDirecto {
  const h = hostDe(url);
  if (!h) return 'otro';
  if (h === 'engarde-service.com' || h.endsWith('.engarde-service.com')) return 'engarde';
  if (h === 'fencingtimelive.com' || h.endsWith('.fencingtimelive.com')) return 'ftl';
  if (
    h === 'fencingworldwide.com' ||
    h.endsWith('.fencingworldwide.com') ||
    h === 'ophardt.online' ||
    h.endsWith('.ophardt.online') ||
    h.endsWith('.ophardt-team.org')
  ) {
    return 'ophardt';
  }
  if (h === 'fie.org' || h.endsWith('.fie.org')) return 'fie';
  return 'otro';
}

/**
 * La FIE publica el enlace a mano y llega sucio: con `#today`, con la misma URL
 * pegada dos veces o con espacios. Se queda la primera URL http(s) y sin
 * fragmento; la consulta se conserva porque las URL antiguas de FTL son
 * `fencingtimelive.com/?t=17989`.
 */
export function normalizarUrlDirecto(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/https?:\/\/.+?(?=https?:\/\/|\s|$)/i);
  if (!m) return null;
  let u: URL;
  try {
    u = new URL(m[0]);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  u.hash = '';
  for (const p of [...u.searchParams.keys()]) {
    if (/^utm_/i.test(p)) u.searchParams.delete(p);
  }
  return u.toString();
}

/** La portada de un proveedor no sirve para seguir ninguna prueba. */
export function esPortada(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.pathname === '/' || u.pathname === '') && u.search === '';
  } catch {
    return true;
  }
}

/** `video` es una retransmisión (YouTube, FencingTV): no es la pastilla de resultados. */
export function esEnlaceDeResultados(kind: string | null | undefined): boolean {
  return kind !== 'en_vivo' && kind !== 'video';
}

export type EstadoDirecto = 'directo' | 'resultados';

function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * «En directo» los días en que se tira; «Resultados» antes y después.
 *
 * `hoy` es el día de Madrid, el mismo que usa el resto del calendario para no
 * romper la hidratación. En América la jornada sigue cuando en Madrid ya es el
 * día siguiente, así que ahí el directo se alarga un día.
 */
export function estadoDirecto(
  rango: { desde: string; hasta: string },
  hoy: string,
  timezone?: string | null,
): EstadoDirecto {
  const hasta = timezone?.startsWith('America/') ? sumarDias(rango.hasta, 1) : rango.hasta;
  return rango.desde <= hoy && hoy <= hasta ? 'directo' : 'resultados';
}

/** Un enlace por URL; gana el proveedor más específico y, a igualdad, el primero. */
export function mejorEnlace(enlaces: readonly EnlaceDirecto[]): EnlaceDirecto | null {
  let mejor: EnlaceDirecto | null = null;
  for (const e of enlaces) {
    if (!mejor || PRIORIDAD_PROVEEDOR[e.proveedor] < PRIORIDAD_PROVEEDOR[mejor.proveedor]) mejor = e;
  }
  return mejor;
}

type EventoConEnlaces = {
  startDate: string;
  endDate: string;
  enlaceDirecto?: EnlaceDirecto | null;
  competitions: { competitionDate: string | null; enlaceDirecto?: EnlaceDirecto | null }[];
};

/**
 * El enlace de la tarjeta. El del torneo si lo hay; si no, el que comparten
 * todas sus pruebas; si cada prueba tiene el suyo, el de la que se tira hoy (o
 * la primera), porque la ficha ya enseña los demás uno a uno.
 */
export function enlaceDeTarjeta(evento: EventoConEnlaces, hoy: string): EnlaceDirecto | null {
  if (evento.enlaceDirecto) return evento.enlaceDirecto;
  const conEnlace = evento.competitions.filter((c) => c.enlaceDirecto);
  if (conEnlace.length === 0) return null;
  const urls = new Set(conEnlace.map((c) => c.enlaceDirecto!.url));
  if (urls.size === 1) return conEnlace[0].enlaceDirecto!;
  const deHoy = conEnlace.find((c) => c.competitionDate?.slice(0, 10) === hoy);
  return (deHoy ?? conEnlace[0]).enlaceDirecto!;
}
