import { describe, expect, it } from 'vitest';
import { leerPruebaFie } from '@/lib/ingest/sources/fie-resultados';

/**
 * Lectura pública real (GET, sin cuenta ni escritura) contra fie.org. Se salta
 * salvo `FIE_VIVO=1`, para que el gate normal no dependa de la red:
 *
 *   $env:FIE_VIVO='1'; npx.cmd vitest run tests/fie-resultados-vivo.test.ts
 *
 * Los recuentos son los observados el 2026-10-01; si la FIE corrige una
 * prueba, este test avisa de que hay que revisar el fixture, no el adaptador.
 */
describe.skipIf(!process.env.FIE_VIVO)('lectura real de la API pública de la FIE', () => {
  it('Bogotá 2027/1478: 28 puestos (24+4), 84 asaltos de poule y 21 de cuadro', async () => {
    const l = await leerPruebaFie(2027, 1478);
    expect(l.ranking?.cobertura).toMatchObject({ estado: 'completo', publicado: 28, importado: 28 });
    expect(l.ranking?.paginasLeidas).toBe(2);
    expect(l.poules?.grupos).toBe(4);
    expect(l.poules?.asaltos).toHaveLength(84);
    expect(l.cuadro?.asaltos).toHaveLength(21);
  }, 60_000);

  it('París 2024/246: 34 puestos, poules vacías y cuadro con final y bronce', async () => {
    const l = await leerPruebaFie(2024, 246);
    expect(l.ranking?.cobertura).toMatchObject({ estado: 'completo', publicado: 34, importado: 34 });
    expect(l.poules?.cobertura.estado).toBe('sin_resultados');
    const rondas = new Set(l.cuadro?.asaltos.map((a) => a.ronda));
    expect(rondas.has('A2') && rondas.has('C2')).toBe(true);
  }, 60_000);

  it('París 2024/250 (equipos): clasificación sin poules ni cuadro', async () => {
    const l = await leerPruebaFie(2024, 250);
    expect(l.prueba?.formato).toBe('EQUIPOS');
    expect(l.ranking?.puestos).toHaveLength(8);
    expect(l.poules).toBeNull();
    expect(l.cuadro).toBeNull();
  }, 60_000);
});
