import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { escaparCeldaCsv } from '@/lib/csv';

function leerCelda(celda: string): string {
  return celda.startsWith('"')
    ? celda.slice(1, -1).replace(/""/g, '"')
    : celda;
}

describe('CSV de inscripciones sin fórmulas ejecutables', () => {
  it.each([
    '=HYPERLINK("https://example.invalid";"abrir")',
    '+SUM(1;2)',
    '-1+2',
    '@SUM(1;2)',
    '  =1+1',
    '\t=1+1',
    '\r\n=1+1',
    '\u0000=1+1',
    '\u0008+1',
    '\u00a0@SUM(1;2)',
    '\ufeff=1',
    '\u200b-1',
    '\u202e=1',
    '＝1+1',
    '＋1',
    '－1',
    '＠SUM(1;2)',
    '\ttexto',
    '\rtexto',
    '\ntexto',
  ])('marca como texto la celda peligrosa %j antes de escapar el CSV', (valor) => {
    const celda = escaparCeldaCsv(valor);
    expect(leerCelda(celda)).toBe(`'${valor}`);
    expect(leerCelda(celda)).toMatch(/^'/);
  });

  it.each([
    '', 'ABC01234', 'FIE1234', '2026-10-03', 'M', 'ESPADA',
    'García Fernández', "O'Neill", "'=ya es texto", 'Madrid',
    ' https://example.invalid/', 'Torneo + final', 'Nombre; club',
    'Un "nombre"', 'texto\nsegunda línea', ' Torneo normal ',
  ])('conserva los datos normales al importar la celda %j', (valor) => {
    expect(leerCelda(escaparCeldaCsv(valor))).toBe(valor);
  });

  it('escapa separadores, comillas y saltos sin crear otra celda', () => {
    expect(escaparCeldaCsv('uno;dos')).toBe('"uno;dos"');
    expect(escaparCeldaCsv('un "nombre"')).toBe('"un ""nombre"""');
    expect(escaparCeldaCsv('uno\r\ndos')).toBe('"uno\r\ndos"');
    expect(escaparCeldaCsv('=SUM(1;2)')).toBe(`"'=SUM(1;2)"`);
  });

  it('aplica la protección a todas las columnas de la exportación real', () => {
    const codigo = readFileSync(new URL('../src/app/(app)/admin/inscripciones/actions.ts', import.meta.url), 'utf8');
    expect(codigo).toContain("await requireRole('admin')");
    expect(codigo).toContain('fila.map(escaparCeldaCsv)');
    expect(codigo).not.toContain('function escaparCelda(');
  });
});
