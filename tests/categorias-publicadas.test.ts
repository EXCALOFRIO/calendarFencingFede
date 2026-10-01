import { describe, expect, it } from 'vitest';
import { ordenarCategorias } from '@/lib/ambito';
import { categoryEnum } from '@/db/schema';
import { mapCategory, mapCategoryPublicada } from '@/lib/ingest/mappers';
import { skermoCompetitionMetaSchema } from '@/lib/ingest/sources/skermo-results';
import { CATEGORY_LABEL } from '@/lib/utils';

describe('categorías históricas M10 y M12', () => {
  it('el enum las incluye en su sitio y el SQL aditivo las añade con BEFORE', async () => {
    const valores = categoryEnum.enumValues;
    expect(valores.indexOf('M10')).toBe(valores.indexOf('M9') + 1);
    expect(valores.indexOf('M12')).toBe(valores.indexOf('M11') + 1);
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(new URL('../drizzle/0019_categorias_m10_m12.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/ADD VALUE IF NOT EXISTS 'M10' BEFORE 'M11'/);
    expect(sql).toMatch(/ADD VALUE IF NOT EXISTS 'M12' BEFORE 'M13'/);
    expect(sql).not.toMatch(/DROP|DELETE|UPDATE|INSERT/i);
  });

  it('el mapper de fuente las reconoce y el del calendario y el cálculo interno sigue sin hacerlo', () => {
    expect(mapCategoryPublicada('M10')).toBe('M10');
    expect(mapCategoryPublicada(' m12 ')).toBe('M12');
    expect(mapCategory('M10')).toBeNull();
    expect(mapCategory('M12')).toBeNull();
  });

  it('el mapper de fuente no aproxima etiquetas vecinas ni inventa categorías', () => {
    for (const raw of ['M25', 'M1', 'M100', 'M10X', 'Prebenjamín', '', null, undefined]) {
      expect(mapCategoryPublicada(raw as string | null | undefined)).toBeNull();
    }
    expect(mapCategoryPublicada('M11')).toBe('M11');
    expect(mapCategoryPublicada('VET40')).toBe('VET');
    expect(mapCategoryPublicada('+50')).toBe('VET');
  });

  it('el validador del cálculo interno sigue rechazándolas', () => {
    const base = {
      competitionId: '1',
      name: 'Prueba',
      date: '2019-01-01',
      weapon: 'ESPADA',
      gender: 'M',
      format: 'INDIVIDUAL',
    };
    expect(skermoCompetitionMetaSchema.safeParse({ ...base, category: 'M13' }).success).toBe(true);
    expect(skermoCompetitionMetaSchema.safeParse({ ...base, category: 'M10' }).success).toBe(false);
    expect(skermoCompetitionMetaSchema.safeParse({ ...base, category: 'M12' }).success).toBe(false);
  });

  it('etiquetas y orden de presentación las colocan entre sus vecinas', () => {
    expect(CATEGORY_LABEL.M10).toBe('M10');
    expect(CATEGORY_LABEL.M12).toBe('M12');
    expect(ordenarCategorias(['M13', 'M12', 'M9', 'M11', 'M10'])).toEqual(['M9', 'M10', 'M11', 'M12', 'M13']);
  });
});
