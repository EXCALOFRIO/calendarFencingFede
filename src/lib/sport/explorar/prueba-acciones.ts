'use server';

import { cargarEdicionCompartida } from './cache-real';
import { edicionDeRuta, leerCriteriosEdicion, VISTAS_PRUEBA, type VistaPrueba } from './edicion-url';
import { datosDeVista, type DatosVistas } from './prueba-datos';
import { contextoReal } from './real';

/**
 * Una vista de la prueba (clasificación, poules o directas) que la página no
 * mandó al abrirse. Es un endpoint invocable por cualquiera: la guarda de
 * sesión está dentro de `cargarEdicionCompartida`, antes de consultar nada, y
 * la entrada se valida igual que la dirección de la página. Lee la misma
 * edición cacheada que la página y devuelve sólo la vista pedida, o `null`.
 */
export async function cargarVistaDePrueba(entrada: unknown): Promise<DatosVistas | null> {
  if (!entrada || typeof entrada !== 'object') return null;
  const { edicionId, prueba, cursor, vista } = entrada as Record<string, unknown>;
  if (typeof edicionId !== 'string' || typeof prueba !== 'string') return null;
  if (typeof vista !== 'string' || !(VISTAS_PRUEBA as readonly string[]).includes(vista)) return null;
  const id = edicionDeRuta(edicionId);
  const criterios = leerCriteriosEdicion({ prueba, cursor: typeof cursor === 'string' ? cursor : '' });
  if (!id || !criterios.prueba) return null;
  const r = await cargarEdicionCompartida(contextoReal(), id, criterios);
  if (r.tipo !== 'ok') return null;
  const asaltos = r.edicion.asaltos;
  if (vista !== 'clasificacion' && (asaltos === 'error' || !asaltos)) return null;
  return datosDeVista(
    vista as VistaPrueba,
    r.edicion.clasificacion?.filas ?? [],
    asaltos === 'error' ? null : (asaltos ?? null),
  );
}
