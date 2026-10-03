import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rechazarEscrituraNoCoordinada } from '@/lib/ingest/cli-obsoleto';

describe('antiguos escritores históricos sin coordinación D1', () => {
  it('no modifica los modos de lectura y rechaza --aplicar', () => {
    expect(() => rechazarEscrituraNoCoordinada(['2027', '1478'])).not.toThrow();
    expect(() => rechazarEscrituraNoCoordinada(['2027', '1478', '--aplicar'])).toThrow('Escritura antigua deshabilitada');
    expect(() => rechazarEscrituraNoCoordinada(['--d1-local', 'fixture.db', '--aplicar'])).toThrow('guardia de escritura');
  });

  it.each(['fie-resultados', 'skermo-finales', 'inventario-historico', 'complementarios'])(
    '%s rechaza la escritura antes de cualquier petición o apertura de base',
    (script) => {
      const source = readFileSync(new URL(`../scripts/${script}.ts`, import.meta.url), 'utf8');
      const guard = source.indexOf('rechazarEscrituraNoCoordinada(args);');
      expect(guard).toBeGreaterThan(0);
      expect(guard).toBeLessThan(source.indexOf('await '));
    },
  );
});
