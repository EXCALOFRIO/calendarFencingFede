import type { GrupoEuropeo, TablaEuropea } from '@/components/ranking/tipos-europeo';
import { db } from '@/db';
import { DIA, MINUTO, cacheCompartida } from '@/lib/cache';
import { hoyMadrid } from '@/lib/callups/fechas';
import { getAnotacionesOlimpicas } from '@/lib/queries/olimpica';
import { personasPorFieId } from '@/lib/queries/personas-ranking';
import {
  type FilaFie,
  type FormatoClasificacion,
  type RankingGroupKey,
  getClasificacionFie,
  listGruposClasificacionFie,
} from '@/lib/queries/ranking';
import {
  type GrupoNacional,
  leerGruposOficialesVigentes,
  leerTablaNacional,
  leerTablaOficialVigente,
  listarGruposNacionales,
  listarTemporadasNacionales,
} from '@/lib/queries/ranking-temporadas';
import type { TablaFieCompleta } from '@/lib/ranking/tabla-fie-completa';
import { type GrupoEuropeoLeido, leerGruposEuropeos, leerTablaEuropea } from './europeo';

/**
 * Las tablas de /ranking en la caché compartida (`src/lib/cache`): son las
 * mismas para todas las cuentas, así que se leen de D1 una vez por isolate y
 * versión de datos, no una vez por visita.
 *
 * Nada de aquí recibe la sesión. Lo que es de la cuenta (sus tiradores, el
 * «Tú» de cada fila, el cálculo interno, que depende del permiso) se añade en
 * la petición, después de leer de la caché (`conMios`, `armarDatosNacional`).
 * Por eso la tabla FIE se guarda SIN `esMio`.
 *
 * Las que dependen del día (año de nacimiento visible, enlace a la ficha de
 * la FIE de un posible menor) llevan `hoy` en la clave.
 */
const FRESCO = 10 * MINUTO;
const CADUCA = 7 * DIA;

export const hoyRanking = () => hoyMadrid();

export const temporadasNacionalesCompartidas = cacheCompartida.definir({
  espacio: 'ranking-nac-temporadas',
  depende: ['ranking', 'deporte'],
  frescoMs: FRESCO,
  caducaMs: CADUCA,
  cargar: () => listarTemporadasNacionales(db),
});

export const gruposNacionalesVigentes = cacheCompartida.definir({
  espacio: 'ranking-nac-grupos',
  depende: ['ranking'],
  frescoMs: FRESCO,
  caducaMs: CADUCA,
  cargar: () => leerGruposOficialesVigentes(db),
});

export const tablaNacionalVigente = cacheCompartida.definir({
  espacio: 'ranking-nac-tabla',
  depende: ['ranking', 'deporte'],
  frescoMs: FRESCO,
  caducaMs: CADUCA,
  cargar: (temporada: string, weapon: string, gender: string, category: string, hoy: string) =>
    leerTablaOficialVigente(db, temporada, { weapon, gender, category } as RankingGroupKey, hoy),
});

export const gruposNacionalesDeTemporada = cacheCompartida.definir({
  espacio: 'ranking-nac-hist-grupos',
  depende: ['ranking', 'deporte'],
  frescoMs: FRESCO,
  caducaMs: CADUCA,
  cargar: (temporada: string) => listarGruposNacionales(db, temporada),
});

export const tablaNacionalDeTemporada = cacheCompartida.definir({
  espacio: 'ranking-nac-hist-tabla',
  depende: ['ranking', 'deporte'],
  frescoMs: FRESCO,
  caducaMs: CADUCA,
  cargar: (temporada: string, arma: string, genero: string, categoriaRaw: string, categoria: string, fuente: string | null) =>
    leerTablaNacional(db, temporada, {
      arma, genero, categoriaRaw, categoria, clasificados: 0, fuente: fuente ?? undefined,
    } as GrupoNacional),
});

export const gruposFieCompartidos = cacheCompartida.definir({
  espacio: 'ranking-fie-grupos',
  depende: ['ranking-fie'],
  frescoMs: FRESCO,
  caducaMs: CADUCA,
  cargar: () => listGruposClasificacionFie(),
});

/** La tabla FIE de un grupo, sin `esMio` (es de la cuenta: lo pone `conMios`). */
export type TablaFiePublica = Omit<TablaFieCompleta, 'rows'> & { rows: Omit<FilaFie, 'esMio'>[] };

export const tablaFieCompartida = cacheCompartida.definir({
  espacio: 'ranking-fie-tabla',
  depende: ['ranking-fie', 'deporte'],
  frescoMs: FRESCO,
  caducaMs: CADUCA,
  cargar: async (format: string, weapon: string, gender: string, category: string, hoy: string): Promise<TablaFiePublica | null> => {
    const tabla = await getClasificacionFie({
      format: format as FormatoClasificacion,
      weapon: weapon as RankingGroupKey['weapon'],
      gender: gender as RankingGroupKey['gender'],
      category: category as RankingGroupKey['category'],
      hoy,
    });
    if (!tabla) return null;
    const olimpica =
      category === 'ABS' && (gender === 'M' || gender === 'F')
        ? getAnotacionesOlimpicas(tabla.group.weapon, gender).catch(() => null)
        : Promise.resolve(null);
    const personas =
      tabla.format === 'INDIVIDUAL'
        ? personasPorFieId(db, tabla.rows.map((r) => r.fieId))
        : Promise.resolve({});
    const rows = tabla.rows.map(({ esMio: _esMio, ...fila }) => fila);
    return { ...tabla, rows, olimpica: await olimpica, personas: await personas };
  },
});

/** La tabla compartida con el «es mío» de la cuenta que mira. */
export function conMios(tabla: TablaFiePublica | null, mios: readonly string[]): TablaFieCompleta | null {
  if (!tabla) return null;
  const propios = new Set(mios);
  return {
    ...tabla,
    rows: tabla.rows.map((r) => ({
      ...r,
      esMio: tabla.format === 'INDIVIDUAL' && r.athleteId !== null && propios.has(r.athleteId),
    })),
  };
}

export const gruposEuropeosCompartidos = cacheCompartida.definir({
  espacio: 'ranking-efc-grupos',
  depende: ['deporte'],
  frescoMs: FRESCO,
  caducaMs: CADUCA,
  cargar: () => leerGruposEuropeos(db),
});

export const tablaEuropeaCompartida = cacheCompartida.definir({
  espacio: 'ranking-efc-tabla',
  depende: ['deporte'],
  frescoMs: FRESCO,
  caducaMs: CADUCA,
  cargar: (publicacion: string, temporada: string, weapon: string, gender: string, category: string) =>
    leerTablaEuropea(db, {
      publicacion, temporada, weapon, gender, category, clasificados: 0,
    } as GrupoEuropeoLeido),
});

/** La tabla europea de un grupo (el pedido o el más parecido que tenga lista). */
export async function tablaEuropeaDe(grupos: readonly GrupoEuropeoLeido[], g: GrupoEuropeoLeido | undefined): Promise<TablaEuropea | null> {
  const elegido = g ?? grupos[0];
  if (!elegido) return null;
  return tablaEuropeaCompartida(elegido.publicacion, elegido.temporada, elegido.weapon, elegido.gender, elegido.category);
}

/** Los grupos tal como van al navegador, sin la publicación. */
export const gruposEuropeosPublicos = (grupos: readonly GrupoEuropeoLeido[]): GrupoEuropeo[] =>
  grupos.map(({ publicacion: _p, ...g }) => g);
