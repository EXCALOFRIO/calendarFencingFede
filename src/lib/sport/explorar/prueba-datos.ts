import type { FilaClasificacion } from './edicion-modelo';
import type { VistaPrueba } from './edicion-url';
import type { AsaltosDePrueba, PouleDePrueba, RondaCuadro } from './tipos-busqueda';

/**
 * Lo que cruza al cliente en la página de una prueba: sólo los datos de la
 * vista abierta. Las otras dos se piden después (`prueba-acciones.ts`), con la
 * misma lectura cacheada de la edición. Sin imports de servidor.
 */

/** El club no se enseña en Explorar: no viaja (se acepta para pasar filas completas). */
export type FilaClasificacionLigera = Pick<
  FilaClasificacion,
  'id' | 'puesto' | 'puestoPublicado' | 'nombre' | 'pais' | 'personaId'
> & { club?: string | null };

export type DatosVistas = {
  clasificacion?: FilaClasificacionLigera[];
  poules?: PouleDePrueba[];
  cuadro?: RondaCuadro[];
};

export type DisponiblesPrueba = Record<VistaPrueba, boolean>;

export function disponiblesDePrueba(
  clasificacion: readonly unknown[],
  asaltos: Pick<AsaltosDePrueba, 'poules' | 'cuadro'> | null,
): DisponiblesPrueba {
  return {
    clasificacion: clasificacion.length > 0,
    poules: (asaltos?.poules.length ?? 0) > 0,
    directas: (asaltos?.cuadro.length ?? 0) > 0,
  };
}

export function filaLigera(f: FilaClasificacionLigera): FilaClasificacionLigera {
  return {
    id: f.id,
    puesto: f.puesto,
    puestoPublicado: f.puestoPublicado,
    nombre: f.nombre,
    pais: f.pais,
    personaId: f.personaId,
  };
}

/** Los datos de una vista y nada más; una vista sin datos va vacía, no ausente. */
export function datosDeVista(
  vista: VistaPrueba,
  clasificacion: readonly FilaClasificacionLigera[],
  asaltos: Pick<AsaltosDePrueba, 'poules' | 'cuadro'> | null,
): DatosVistas {
  if (vista === 'clasificacion') return { clasificacion: clasificacion.map(filaLigera) };
  if (vista === 'poules') return { poules: asaltos?.poules ?? [] };
  return { cuadro: asaltos?.cuadro ?? [] };
}

export function tieneVista(datos: DatosVistas, vista: VistaPrueba): boolean {
  if (vista === 'clasificacion') return datos.clasificacion !== undefined;
  if (vista === 'poules') return datos.poules !== undefined;
  return datos.cuadro !== undefined;
}
