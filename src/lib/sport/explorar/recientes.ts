import { UUID_RE } from './cursor';

/**
 * «Recientes» del buscador de Explorar: las fichas abiertas desde la búsqueda,
 * sólo en este navegador (localStorage) y por cuenta, nunca en el servidor.
 * Sólo se guarda lo que ya es público en la ficha: identificador, nombre y
 * país. Lo leído se valida campo a campo porque cualquiera puede editarlo.
 */
export type PerfilReciente = { id: string; nombre: string; pais: string | null };

export const MAX_RECIENTES = 12;
const PREFIJO = 'explorar:recientes:v1:';

export function claveRecientes(profileId: string): string {
  return `${PREFIJO}${profileId}`;
}

export function leerRecientes(texto: string | null | undefined): PerfilReciente[] {
  if (!texto || texto.length > 8192) return [];
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    return [];
  }
  if (!Array.isArray(valor)) return [];
  const vistos = new Set<string>();
  const salida: PerfilReciente[] = [];
  for (const v of valor) {
    if (!v || typeof v !== 'object') continue;
    const { id, nombre, pais } = v as Record<string, unknown>;
    if (typeof id !== 'string' || !UUID_RE.test(id) || vistos.has(id.toLowerCase())) continue;
    if (typeof nombre !== 'string' || !nombre.trim() || nombre.length > 160) continue;
    const paisValido = typeof pais === 'string' && /^[A-Z]{2,3}$/.test(pais) ? pais : null;
    vistos.add(id.toLowerCase());
    salida.push({ id: id.toLowerCase(), nombre, pais: paisValido });
    if (salida.length === MAX_RECIENTES) break;
  }
  return salida;
}

/** La persona abierta pasa la primera; sin duplicados y como mucho doce. */
export function anadirReciente(lista: readonly PerfilReciente[], p: PerfilReciente): PerfilReciente[] {
  const id = p.id.toLowerCase();
  return [{ id, nombre: p.nombre.slice(0, 160), pais: p.pais }, ...lista.filter((r) => r.id !== id)]
    .slice(0, MAX_RECIENTES);
}

export function quitarReciente(lista: readonly PerfilReciente[], id: string): PerfilReciente[] {
  return lista.filter((r) => r.id !== id.toLowerCase());
}
