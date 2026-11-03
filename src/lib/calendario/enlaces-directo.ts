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
  // La web se llama fencingworldwide.com; «Ophardt» es su autor, no su nombre.
  ophardt: 'Fencing Worldwide',
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

// ---------------------------------------------------------------------------
// Las fuentes oficiales de una prueba: inscritos, ficha y resultados
// ---------------------------------------------------------------------------

/**
 * Un enlace oficial de una prueba, con a qué lleva: la lista de inscritos
 * (Skermo nacional o la de la FIE, que publica todos los países), la página de
 * la prueba en la fuente y los resultados en vivo de cada proveedor.
 *
 * Es la salida de la ficha hacia fuera —«entrar aquí y saltar a la fuente
 * oficial sin buscar en 27 sitios»—: lo que el calendario no guarda, como la
 * lista completa de la FIE, queda a un clic y con su nombre.
 */
export type EnlaceFuente = {
  para: 'inscritos' | 'ficha' | 'resultados';
  proveedor: ProveedorDirecto | 'skermo';
  url: string;
};

/**
 * Como `NOMBRE_PROVEEDOR`, con los nombres que se ven al abrir la web, más
 * Skermo, que no es un «directo» sino una fuente.
 */
export const NOMBRE_FUENTE: Record<EnlaceFuente['proveedor'], string> = {
  ...NOMBRE_PROVEEDOR,
  skermo: 'Skermo',
};

export function esUrlFie(url: string | null | undefined): boolean {
  const h = hostDe(url ?? '');
  return !!h && (h === 'fie.org' || h.endsWith('.fie.org'));
}

export function esUrlSkermo(url: string | null | undefined): boolean {
  const h = hostDe(url ?? '');
  return !!h && (h === 'skermo.org' || h.endsWith('.skermo.org'));
}

/**
 * La FIE publica la lista completa en `fie.org/competition/<temporada>/<prueba>/entries`.
 * Es la URL que el calendario guarda como `sourceUrl` de las pruebas FIE.
 */
export function esUrlInscritosFie(url: string | null | undefined): boolean {
  try {
    return !!url && esUrlFie(url) && /\/entries\/?$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * La ficha de la prueba en la FIE es la URL de inscritos sin la coletilla
 * `/entries`: ahí están las poules, el tableau y, al acabar, los resultados.
 */
export function urlFichaFie(urlInscritos: string | null | undefined): string | null {
  if (!urlInscritos || !esUrlInscritosFie(urlInscritos)) return null;
  try {
    const u = new URL(urlInscritos);
    u.pathname = u.pathname.replace(/\/entries\/?$/, '');
    return u.toString();
  } catch {
    return null;
  }
}

/** `fie.org/competition/<temporada>/<prueba>` — con o sin `/entries`. */
function esPaginaDePruebaFie(url: string | null | undefined): boolean {
  try {
    return !!url && esUrlFie(url) && /^\/competition\/\d+\/\d+(?:\/entries)?\/?$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * De cualquier página de una prueba de la FIE a su ficha y a su lista
 * completa de inscritos. Sirve igual la `sourceUrl` del calendario
 * (`…/entries`) que la de una edición importada (la ficha pelada).
 */
export function urlsDePruebaFie(
  url: string | null | undefined,
): { ficha: string; inscritos: string } | null {
  if (!esPaginaDePruebaFie(url)) return null;
  const ficha = urlFichaFie(url) ?? url!.replace(/\/$/, '');
  return { ficha, inscritos: `${ficha}/entries` };
}

/** Primero lo que más se pide (¿estoy dentro?), la ficha de la fuente al final. */
const ORDEN_PARA: Record<EnlaceFuente['para'], number> = {
  inscritos: 0,
  resultados: 1,
  ficha: 2,
};

const ORDEN_FUENTE: Record<EnlaceFuente['proveedor'], number> = {
  ...PRIORIDAD_PROVEEDOR,
  skermo: 5,
};

type PruebaConFuentes = {
  sourceUrl?: string | null;
  inscritosFieUrl?: string | null;
  enlacesDirectos?: readonly EnlaceDirecto[] | null;
  /** El mejor enlace suelto, cuando la lista completa no viaja en el detalle. */
  enlaceDirecto?: EnlaceDirecto | null;
};

/**
 * Los enlaces oficiales de una prueba, uno por URL y ya ordenados: inscritos
 * delante —«mirar rápido a quién le toca en la poule»—, resultados por
 * proveedor después y la ficha de la fuente al final.
 *
 * `enlacesDelTorneo` entra cuando la prueba no tiene directo propio: el
 * Engarde del torneo entero vale igualmente para seguirla. Si una misma URL
 * vale para dos cosas (la ficha de la FIE es también su página de resultados)
 * se queda el uso que antes se consulta.
 */
export function enlacesOficialesDePrueba(
  prueba: PruebaConFuentes,
  enlacesDelTorneo?: readonly EnlaceDirecto[] | null,
): EnlaceFuente[] {
  const inscritosFie =
    prueba.inscritosFieUrl ?? urlsDePruebaFie(prueba.sourceUrl)?.inscritos ?? null;

  const porUrl = new Map<string, EnlaceFuente>();
  const poner = (e: EnlaceFuente) => {
    const previo = porUrl.get(e.url);
    if (!previo || ORDEN_PARA[e.para] < ORDEN_PARA[previo.para]) porUrl.set(e.url, e);
  };

  if (inscritosFie) poner({ para: 'inscritos', proveedor: 'fie', url: inscritosFie });
  if (esUrlSkermo(prueba.sourceUrl)) {
    poner({ para: 'inscritos', proveedor: 'skermo', url: prueba.sourceUrl! });
  }
  const deLaPrueba =
    prueba.enlacesDirectos ?? (prueba.enlaceDirecto ? [prueba.enlaceDirecto] : []);
  for (const l of [...deLaPrueba, ...(enlacesDelTorneo ?? [])]) {
    poner({ para: 'resultados', proveedor: l.proveedor, url: l.url });
  }
  const fichaFie = urlFichaFie(inscritosFie);
  if (fichaFie) poner({ para: 'ficha', proveedor: 'fie', url: fichaFie });

  return [...porUrl.values()].sort(
    (a, b) =>
      ORDEN_PARA[a.para] - ORDEN_PARA[b.para] ||
      ORDEN_FUENTE[a.proveedor] - ORDEN_FUENTE[b.proveedor],
  );
}
