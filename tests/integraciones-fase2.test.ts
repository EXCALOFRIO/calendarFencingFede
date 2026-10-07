import { describe, expect, it, vi } from 'vitest';
import { leerContextoCalendario, leerEventoCalendario, quitarEventoDeUrl } from '@/lib/calendario/contexto-url';
import { mismoNombre, nombreComparable, sinDuplicadosEnPantalla } from '@/lib/entries/duplicados-pantalla';
import { etiquetasDePartes, ordenarPartes } from '@/lib/sport/explorar/conjunta-edicion';

vi.mock('@/app/(app)/explorar/resultados-evento', () => ({ resultadosDelEvento: vi.fn() }));
vi.mock('@/components/calendario/ficha/resultados-accion', () => ({ podiosDelEvento: vi.fn() }));
vi.mock('lucide-react', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('lucide-react');
});
vi.mock('radix-ui', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('radix-ui');
});

const { pruebaExacta } = await import('@/components/calendario/ficha/resultados-torneo');

const EVENTO = '0A1B2C3D-0000-4000-8000-000000000001';

describe('calendario: ?evento= abre la ficha', () => {
  it('lee un UUID (en minúsculas) y descarta lo demás', () => {
    expect(leerEventoCalendario({ evento: EVENTO })).toBe(EVENTO.toLowerCase());
    expect(leerEventoCalendario({ evento: [EVENTO, 'otro'] })).toBe(EVENTO.toLowerCase());
    expect(leerEventoCalendario({ evento: 'no-es-uuid' })).toBeNull();
    expect(leerEventoCalendario({})).toBeNull();
  });

  it('el contexto del calendario no lo incluye', () => {
    expect(leerContextoCalendario({ evento: EVENTO, mes: '2026-11' })).not.toHaveProperty('evento');
  });

  it('se quita de la dirección sin tocar el resto de la consulta ni el fragmento', () => {
    expect(quitarEventoDeUrl(`/?mes=2026-11&evento=${EVENTO}&arma=SABLE#x`)).toBe('/?mes=2026-11&arma=SABLE#x');
    expect(quitarEventoDeUrl(`/?evento=${EVENTO}`)).toBe('/');
    expect(quitarEventoDeUrl('/?mes=2026-11')).toBe('/?mes=2026-11');
    expect(quitarEventoDeUrl('/#evento=x')).toBe('/#evento=x');
    expect(quitarEventoDeUrl('/')).toBe('/');
  });
});

describe('calendario: «Ver resultados» lleva a la prueba exacta', () => {
  const prueba = (id: string, extra: Record<string, unknown>) => ({
    id,
    arma: 'SABLE',
    genero: 'M',
    categoria: { codigo: 'SENIOR' },
    formato: 'individual',
    pruebaCalendarioId: null,
    ...extra,
  });
  const ediciones = [
    { id: 'ed-1', pruebasDetalle: [prueba('p-f', { genero: 'F' }), prueba('p-m', {}), prueba('p-eq', { formato: 'equipos', pruebaCalendarioId: 'comp-eq' })] },
  ] as never;
  const competicion = (o: Record<string, string>) => ({ weapon: 'SABLE', gender: 'M', category: 'SENIOR', format: 'individual', ...o }) as never;

  it('primero el vínculo guardado', () => {
    expect(pruebaExacta(ediciones, 'comp-eq', competicion({}))?.prueba.id).toBe('p-eq');
  });

  it('si no, por arma, género, categoría y formato', () => {
    expect(pruebaExacta(ediciones, 'otra', competicion({}))).toEqual({ edicionId: 'ed-1', prueba: expect.objectContaining({ id: 'p-m' }) });
    expect(pruebaExacta(ediciones, null, competicion({ gender: 'F' }))?.prueba.id).toBe('p-f');
  });

  it('sin coincidencia o sin competición, nada', () => {
    expect(pruebaExacta(ediciones, null, competicion({ category: 'JUNIOR' }))).toBeNull();
    expect(pruebaExacta(ediciones, null, null)).toBeNull();
  });
});

describe('inscritos: la misma persona dos veces sólo se pinta una', () => {
  it('el nombre se compara sin tildes, mayúsculas ni orden', () => {
    expect(nombreComparable('GARCÍA PÉREZ, Ana')).toBe(nombreComparable('Ana Garcia Perez'));
  });

  it('el de la FIE (un apellido) dentro del de Skermo (dos apellidos)', () => {
    expect(mismoNombre(nombreComparable('ROMAN Adrian'), nombreComparable('ADRIÁN ROMÁN BLANQUE'))).toBe(true);
    expect(mismoNombre(nombreComparable('ROMAN Adrian'), nombreComparable('ADRIÁN ROMÁN'))).toBe(true);
    expect(mismoNombre(nombreComparable('ROMAN'), nombreComparable('ROMAN Adrian'))).toBe(false);
    expect(mismoNombre(nombreComparable('ROMAN Adrian'), nombreComparable('Adrián Romero Blanque'))).toBe(false);
    expect(mismoNombre(nombreComparable('ROMAN Adrian'), nombreComparable('Adrián Román Blanque de la Vega'))).toBe(false);
  });

  it('oculta la copia sin enlazar de la misma prueba y deja lo demás', () => {
    const filas = [
      { id: 1, competitionId: 'c1', nombre: 'ROMAN Adrian', personaId: 'ath-1' },
      { id: 2, competitionId: 'c1', nombre: 'ADRIÁN ROMÁN BLANQUE', personaId: null },
      { id: 3, competitionId: 'c2', nombre: 'ADRIÁN ROMÁN BLANQUE', personaId: null },
      { id: 4, competitionId: 'c1', nombre: 'Adrián Román', personaId: null, esMio: true },
      { id: 5, competitionId: 'c1', nombre: 'ROMAN Adrian', personaId: null, equipo: 'ESP' },
      { id: 6, competitionId: 'c1', nombre: 'Lucía Sanz', personaId: null },
    ];
    expect(sinDuplicadosEnPantalla(filas).map((f) => f.id)).toEqual([1, 3, 4, 5, 6]);
  });

  it('con dos homónimos enlazados no oculta nada', () => {
    const filas = [
      { id: 1, competitionId: 'c1', nombre: 'ROMAN Adrian', personaId: 'ath-1' },
      { id: 2, competitionId: 'c1', nombre: 'Adrian ROMAN', personaId: 'ath-2' },
      { id: 3, competitionId: 'c1', nombre: 'ADRIÁN ROMÁN BLANQUE', personaId: null },
    ];
    expect(sinDuplicadosEnPantalla(filas)).toHaveLength(3);
  });
});

describe('pruebas conjuntas: rótulos de las partes', () => {
  const parte = (id: string, categoriaRaw: string | null, extra: Record<string, unknown> = {}) => ({
    id,
    edicion: 'ed',
    arma: 'ESPADA' as const,
    genero: 'M' as const,
    categoria: 'VETERANO',
    categoriaRaw,
    ...extra,
  });

  it('literal corto de la fuente; uno largo del Criterium se queda en su año', () => {
    const e = etiquetasDePartes([parte('a', 'VET40'), parte('b', '2013 21.06.2025 COLMENAR VIEJO')] as never);
    expect(e.get('a')).toBe('VET40');
    expect(e.get('b')).toBe('2013');
  });

  it('dos partes con el mismo rótulo se distinguen por sus puestos o, si coinciden, por su orden', () => {
    const conPuestos = etiquetasDePartes([parte('a', 'VET40', { puestos: 7 }), parte('b', 'VET40', { puestos: 12 })] as never);
    expect([conPuestos.get('a'), conPuestos.get('b')]).toEqual(['VET40 · 7', 'VET40 · 12']);
    const iguales = etiquetasDePartes([parte('a', 'VET40', { puestos: 7 }), parte('b', 'VET40', { puestos: 7 })] as never);
    expect([iguales.get('a'), iguales.get('b')]).toEqual(['VET40 · 1', 'VET40 · 2']);
  });

  it('arma y género sólo si las partes no los comparten', () => {
    const e = etiquetasDePartes([parte('a', 'VET40'), parte('b', 'VET40', { genero: 'F' })] as never);
    expect(e.get('a')).not.toBe(e.get('b'));
    expect(e.get('a')).toMatch(/VET40$/);
  });

  it('orden natural de los números', () => {
    const orden = ordenarPartes([{ etiqueta: 'VET60' }, { etiqueta: 'VET40 · 12' }, { etiqueta: 'VET40 · 7' }, { etiqueta: 'VET50' }]);
    expect(orden.map((p) => p.etiqueta)).toEqual(['VET40 · 7', 'VET40 · 12', 'VET50', 'VET60']);
  });
});
