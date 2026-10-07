import { z } from 'zod';
import { categoryEnum } from '@/db/schema';
import { palabrasNombre } from '@/lib/nombres';
import { FECHA_RE, UUID_RE } from './cursor';
import type { FiltrosBusqueda, FiltrosPrueba } from './tipos';

/**
 * Validación en el borde de las entradas del explorador. Las acciones de
 * servidor reciben datos del navegador sin tipar: aquí se acotan longitudes,
 * vocabularios y fechas antes de que lleguen a una consulta.
 */

export const LIMITE_MAXIMO = 50;
export const LIMITE_POR_DEFECTO = 25;

const uuid = z.string().regex(UUID_RE);
const fecha = z
  .string()
  .regex(FECHA_RE)
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v));

const camposPrueba = {
  temporada: z.string().regex(/^\d{4}(-\d{4})?$/).optional(),
  desde: fecha.optional(),
  hasta: fecha.optional(),
  torneo: z.string().trim().min(2).max(80).optional(),
  edicionId: uuid.optional(),
  arma: z.enum(['FLORETE', 'ESPADA', 'SABLE']).optional(),
  genero: z.enum(['M', 'F', 'MIXTO']).optional(),
  categoria: z.enum(categoryEnum.enumValues).optional(),
  categoriaRaw: z.string().trim().min(1).max(40).optional(),
  formato: z.enum(['INDIVIDUAL', 'EQUIPOS']).optional(),
  ambito: z.enum(['NACIONAL', 'INTERNACIONAL', 'AUTONOMICO']).optional(),
  organizador: z.enum(['FIE', 'EFC', 'RFEE']).optional(),
};

const paginacion = {
  cursor: z.string().min(1).max(600).optional(),
  limite: z.number().int().min(1).max(LIMITE_MAXIMO).optional(),
};

const intervaloValido = (v: { desde?: string; hasta?: string }) =>
  !v.desde || !v.hasta || v.desde <= v.hasta;

export const esquemaBusqueda = z
  .object({
    ...camposPrueba,
    q: z.string().trim().max(80).optional(),
    nacionalidad: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .transform((v) => v.toUpperCase())
      .optional(),
    ...paginacion,
  })
  .strict()
  .refine(intervaloValido);

export const esquemaHistorial = z
  .object({ personaId: uuid, ...camposPrueba, ...paginacion })
  .strict()
  .refine(intervaloValido);

export const esquemaFicha = z
  .object({
    personaId: uuid.optional(),
    temporadaRanking: z.string().regex(/^\d{4}(-\d{4})?$/).optional(),
    formato: z.enum(['INDIVIDUAL', 'EQUIPOS']).optional(),
  })
  .strict();

export const esquemaCaraACara = z
  .object({
    personaId: uuid,
    rivalId: uuid,
    temporada: camposPrueba.temporada,
    desde: camposPrueba.desde,
    hasta: camposPrueba.hasta,
    arma: camposPrueba.arma,
    fase: z.enum(['POULE', 'TABLEAU']).optional(),
    /** Regla de `clasificarCompeticion`, como Rivales; no la de `camposPrueba.ambito` (calendario). */
    ambito: z.enum(['nacional', 'internacional']).optional(),
    ...paginacion,
  })
  .strict()
  .refine(intervaloValido);

export const esquemaRivales = z
  .object({
    personaId: uuid,
    temporada: camposPrueba.temporada,
    q: z.string().trim().max(80).optional(),
    ...paginacion,
  })
  .strict();

/** Palabras de búsqueda normalizadas; menos de dos letras no es un criterio. */
export function normalizarConsulta(q: string | undefined): string | undefined {
  if (!q) return undefined;
  const palabras = palabrasNombre(q).slice(0, 6);
  const texto = palabras.join(' ');
  return texto.length >= 2 ? texto : undefined;
}

/** Forma canónica de los filtros de prueba: sin claves vacías, orden estable. */
export function filtrosPrueba(v: FiltrosPrueba): FiltrosPrueba {
  const limpio: FiltrosPrueba = {};
  const origen = v as Record<string, unknown>;
  const destino = limpio as Record<string, unknown>;
  for (const clave of Object.keys(camposPrueba)) {
    if (origen[clave] !== undefined) destino[clave] = origen[clave];
  }
  if (limpio.torneo) limpio.torneo = palabrasNombre(limpio.torneo).join(' ') || undefined;
  return limpio;
}

export function tieneCriterioDePrueba(f: FiltrosPrueba): boolean {
  return Object.values(filtrosPrueba(f)).some((v) => v !== undefined);
}

export function filtrosBusqueda(v: FiltrosBusqueda): FiltrosBusqueda {
  const base: FiltrosBusqueda = { ...filtrosPrueba(v) };
  const q = normalizarConsulta(v.q);
  if (q) base.q = q;
  if (v.nacionalidad) base.nacionalidad = v.nacionalidad.toUpperCase();
  return base;
}
