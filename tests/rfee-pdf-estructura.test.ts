import { describe, expect, it } from 'vitest';
import { perfilarEstructuraPdf } from '../src/lib/ingest/sources/rfee-pdf/estructura';
import { cabecera, pagina, fila, paginaClasificacion } from './fixtures/rfee-pdf/sintetico';
const create = (name: string, title: string) => paginaClasificacion(1,
  cabecera('ESPADA MASCULINA INDIVIDUAL', '8 JUNIO 2019', title),
  [{ puesto: '1', nombre: name, club: 'CLUB SINTETICO' }]);
describe('local PDF structural grouping, without AI or imports', () => {
  it('groups shared column layouts without exposing participant names, scores or titles', () => {
    const a = perfilarEstructuraPdf([create('ALFA UNO', 'TORNEO UNO')]);
    const b = perfilarEstructuraPdf([create('BRAVO DOS', 'TORNEO DOS')]);
    expect(a.esquemas).toEqual(b.esquemas);
    expect(a.rutaSugerida).toBe('evaluar_lector_local');
    expect(a.acceptance).toBe('requires_source_reconciliation');
    expect(JSON.stringify(a)).not.toMatch(/ALFA|TORNEO|CLUB SINTETICO/);
  });
  it('does not pretend unknown or unreadable pages share a supported complete layout', () => {
    const known = create('ALFA UNO', 'TORNEO UNO');
    expect(perfilarEstructuraPdf([known, pagina(2, [fila(700, [10, 'OTRA MAQUETACION SIN SECCION'])])]))
      .toMatchObject({ bloquesDesconocidos: 1, rutaSugerida: 'revision_de_excepciones' });
    expect(perfilarEstructuraPdf([pagina(1, [])]))
      .toMatchObject({ bloquesSinTexto: 1, rutaSugerida: 'revision_de_excepciones' });
    expect(perfilarEstructuraPdf([]).rutaSugerida).toBe('revision_de_excepciones');
  });
  it('requires bounded pages and meaningful geometry', () => {
    const p = create('ALFA UNO', 'TORNEO UNO');
    for (const invalid of [{ ...p, ancho: 0 }, { ...p, alto: Infinity }, { ...p, numero: 0 }]) {
      expect(() => perfilarEstructuraPdf([invalid])).toThrow('pdf_structure_bounds_invalid');
    }
    expect(() => perfilarEstructuraPdf(Array(401).fill(p))).toThrow('pdf_structure_bounds_invalid');
  });
});
