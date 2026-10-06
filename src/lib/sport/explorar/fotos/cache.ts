import { fieFichaPublicaUrl } from '@/lib/ingest/sources/fie-tiradores';
import type { CuboR2 } from '@/lib/storage';
import { urlRetratoOficial, type FotoPublicada } from '../foto-contrato';
import { resolverFotoOficial, type OpcionesFuente } from '../foto-fuente';

/**
 * CACHÉ DE LA RESOLUCIÓN DEL RETRATO FIE, NO DE LA IMAGEN.
 *
 * Lo lento de un retrato no eran sus píxeles: el redimensionador de la FIE los
 * sirve en AVIF/WebP (2 KB a 96 px, 16 KB a 320) con `max-age` de un mes, y el
 * navegador ya no vuelve a pedirlos. Lo lento era averiguar CUÁL es la foto:
 * cada avatar costaba un GET a `fie.org/api/fie/fencer/<id>` y un HEAD a la
 * imagen, sin caché, en cada visita.
 *
 * Aquí se recuerda esa respuesta —la dirección ya validada, o «no hay»— por
 * FIE ID, en dos niveles: un mapa en el isolate (sin coste) y un objeto JSON
 * de ~200 bytes en R2 (`fotos/fie/<id>.json`). Guardar la dirección es lo
 * mismo que ya hace `fie_fencer.photo_url`; los píxeles siguen sin copiarse
 * (ver `src/db/schema/fie.ts`, «LA FOTO NO SE COPIA A R2»).
 *
 * R2 y no D1: cada marca sería una escritura contra el ledger de capacidad de
 * D1 (`sport_write_context`), y el veto de identidad y de menores sigue
 * leyéndose en D1 en cada petición; aquí sólo se ahorra la parte externa.
 *
 * La Cache API de Workers no se usa: en `*.workers.dev` sus operaciones no
 * hacen nada (sólo funciona en dominios propios).
 */

export const VIGENCIA_FOTO = {
  /** La FIE cambia retratos de temporada en temporada, no de un día para otro. */
  publicadaDias: 30,
  /** Más corta: un adulto que cumple 19 o una foto nueva aparecen en una semana. */
  sinFotoDias: 7,
  /** Acota lo que un isolate puede ir por detrás de R2. */
  memoriaMs: 10 * 60_000,
  /** Tras un fallo pasajero no se martillea a la FIE en cada avatar. */
  falloMs: 5 * 60_000,
} as const;
export const MAX_FOTOS_EN_MEMORIA = 2000;
const MAX_BYTES_MARCA = 2048;

export type MarcaFoto =
  | { v: 1; estado: 'publicada'; src: string; comprobada: string }
  | { v: 1; estado: 'sin_foto'; comprobada: string };

/** Lo mínimo para guardar marcas; en pruebas y scripts se sustituye por un mapa o una carpeta. */
export type AlmacenMarcas = {
  leer(clave: string): Promise<string | null>;
  guardar(clave: string, json: string): Promise<void>;
};

export type ResultadoCacheFoto = {
  foto: FotoPublicada | null;
  /** `false` sólo si no hay foto porque la fuente falló y no había marca previa. */
  definitivo: boolean;
};

export function claveMarcaFie(fieId: number): string {
  return `fotos/fie/${fieId}.json`;
}

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

/** Una marca leída de R2 se valida igual que una respuesta de la FIE. */
export function leerMarca(texto: string | null): MarcaFoto | null {
  if (!texto || texto.length > MAX_BYTES_MARCA) return null;
  try {
    const valor: unknown = JSON.parse(texto);
    if (!valor || typeof valor !== 'object') return null;
    const m = valor as Record<string, unknown>;
    if (m.v !== 1 || typeof m.comprobada !== 'string' || !DIA_RE.test(m.comprobada) ||
      Number.isNaN(Date.parse(m.comprobada))) return null;
    if (m.estado === 'sin_foto') return { v: 1, estado: 'sin_foto', comprobada: m.comprobada };
    if (m.estado === 'publicada' && urlRetratoOficial(m.src)) {
      return { v: 1, estado: 'publicada', src: m.src as string, comprobada: m.comprobada };
    }
    return null;
  } catch {
    return null;
  }
}

/** Una marca del futuro (reloj adelantado al escribirla) tampoco vale. */
export function marcaVigente(marca: MarcaFoto, hoy: string): boolean {
  const dias = diasEntre(marca.comprobada, hoy);
  const maximo = marca.estado === 'publicada' ? VIGENCIA_FOTO.publicadaDias : VIGENCIA_FOTO.sinFotoDias;
  return Number.isFinite(dias) && dias >= 0 && dias < maximo;
}

function fotoDeMarca(fieId: number, marca: MarcaFoto | null): FotoPublicada | null {
  return marca?.estado === 'publicada' ? { src: marca.src, fichaUrl: fieFichaPublicaUrl(fieId) } : null;
}

export function almacenR2(cubo: CuboR2): AlmacenMarcas {
  return {
    async leer(clave) {
      const objeto = await cubo.get(clave);
      if (!objeto?.body) return null;
      if (objeto.size > MAX_BYTES_MARCA) {
        void objeto.body.cancel().catch(() => {});
        return null;
      }
      return new Response(objeto.body).text();
    },
    async guardar(clave, json) {
      const bytes = new TextEncoder().encode(json);
      await cubo.put(clave, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
        httpMetadata: { contentType: 'application/json' },
      });
    },
  };
}

type EnMemoria = { marca: MarcaFoto | null; hasta: number };
const memoria = new Map<number, EnMemoria>();

function recordar(fieId: number, marca: MarcaFoto | null, ms: number, ahora: number) {
  memoria.delete(fieId);
  memoria.set(fieId, { marca, hasta: ahora + ms });
  while (memoria.size > MAX_FOTOS_EN_MEMORIA) memoria.delete(memoria.keys().next().value!);
}

/** Sólo para pruebas: cada caso empieza con el isolate vacío. */
export function olvidarFotosEnMemoria(): void {
  memoria.clear();
}

/**
 * Memoria -> R2 -> FIE. Ante un fallo pasajero se sirve la última foto
 * conocida aunque haya caducado: es mejor que enseñar iniciales por un 503.
 * Nunca se comparte una promesa entre peticiones: en Workers, esperar la E/S
 * de otra petición puede colgarse.
 */
export async function fotoFieConCache(
  fieId: number,
  hoy: string,
  opciones: OpcionesFuente & { almacen?: AlmacenMarcas | null; ahora?: () => number } = {},
): Promise<ResultadoCacheFoto> {
  const ahora = opciones.ahora ?? Date.now;
  const recordada = memoria.get(fieId);
  if (recordada && recordada.hasta > ahora()) {
    return { foto: fotoDeMarca(fieId, recordada.marca), definitivo: recordada.marca !== null };
  }

  const clave = claveMarcaFie(fieId);
  let previa: MarcaFoto | null = null;
  if (opciones.almacen) {
    previa = leerMarca(await opciones.almacen.leer(clave).catch(() => null));
    if (previa && marcaVigente(previa, hoy)) {
      recordar(fieId, previa, VIGENCIA_FOTO.memoriaMs, ahora());
      return { foto: fotoDeMarca(fieId, previa), definitivo: true };
    }
  }

  const resolucion = await resolverFotoOficial(fieId, hoy, opciones);
  if (resolucion.tipo === 'fallo') {
    const ultima = previa?.estado === 'publicada' ? previa : null;
    recordar(fieId, ultima, VIGENCIA_FOTO.falloMs, ahora());
    return { foto: fotoDeMarca(fieId, ultima), definitivo: ultima !== null };
  }
  const marca: MarcaFoto = resolucion.tipo === 'publicada'
    ? { v: 1, estado: 'publicada', src: resolucion.foto.src, comprobada: hoy }
    : { v: 1, estado: 'sin_foto', comprobada: hoy };
  if (opciones.almacen && DIA_RE.test(hoy)) {
    // Una escritura fallida sólo cuesta repetir la consulta otro día.
    await opciones.almacen.guardar(clave, JSON.stringify(marca)).catch(() => {});
  }
  recordar(fieId, marca, VIGENCIA_FOTO.memoriaMs, ahora());
  return { foto: fotoDeMarca(fieId, marca), definitivo: true };
}
