import { getAnotacionesOlimpicas } from '@/lib/queries/olimpica';
import type { AnotacionOlimpica, ArmaOlimpica, GeneroOlimpico } from '@/lib/ranking/olimpica';
import type { MejorMundial } from './ranking-nacional';

/**
 * Marca olímpica de la persona en cada prueba olímpica (absoluto, masculino o
 * femenino) en la que figura en la clasificación FIE vigente. Sólo entra quien
 * está en zona de clasificación: «cerca» y «pendiente» no se enseñan en la
 * cabecera.
 */
export type OlimpicaPerfil = { arma: MejorMundial['arma']; genero: MejorMundial['genero']; anotacion: AnotacionOlimpica };

export async function leerOlimpicaPerfil(actuales: readonly MejorMundial[] | undefined): Promise<OlimpicaPerfil[]> {
  const candidatas = (actuales ?? []).filter((m) =>
    m.categoria === 'ABS' && (m.genero === 'M' || m.genero === 'F') && m.arma !== undefined && Number.isFinite(m.fieId));
  if (candidatas.length === 0) return [];
  const salida = await Promise.all(candidatas.map(async (m): Promise<OlimpicaPerfil | null> => {
    try {
      const prueba = await getAnotacionesOlimpicas(m.arma as ArmaOlimpica, m.genero as GeneroOlimpico);
      const anotacion = prueba?.individual[String(m.fieId)];
      return anotacion?.estado === 'clasificado' ? { arma: m.arma, genero: m.genero, anotacion } : null;
    } catch {
      return null;
    }
  }));
  return salida.filter((o): o is OlimpicaPerfil => o !== null);
}
