import { construirUrlEdicion, type CriteriosEdicion, type VistaPrueba } from '@/lib/sport/explorar/edicion-url';
import { rutaFichaConRetorno } from '@/lib/sport/explorar/ficha-url';

/** Lo que conserva la dirección de una prueba al ir y volver de una ficha. */
export type BasePrueba = Pick<CriteriosEdicion, 'prueba' | 'cursor' | 'origen' | 'catalogo'>;

/** Dirección de la ficha de una persona deportiva desde una prueba. */
export type EnlaceFicha = (personaId: string) => string;

/**
 * La ficha vuelve a la misma prueba y vista, con esa persona resaltada: al
 * volver, la página baja hasta ella.
 */
export function enlaceFichaDePrueba(edicionId: string, base: BasePrueba, vista: VistaPrueba): EnlaceFicha {
  return (personaId) =>
    rutaFichaConRetorno(personaId, construirUrlEdicion(edicionId, { ...base, vista, persona: personaId }));
}
