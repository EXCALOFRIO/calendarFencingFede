import { describe, expect, it } from 'vitest';
import {
  ordenCategoria,
  rotuloArma,
  rotuloCategoria,
  rotuloFormato,
  rotuloGenero,
  rotuloPrueba,
} from '@/lib/sport/rotulos';
import {
  CATEGORY_LABEL, CATEGORY_SHORT, GENDER_LABEL, GENDER_SHORT, WEAPON_LABEL, WEAPON_SHORT,
} from '@/lib/utils';

describe('rotuloArma', () => {
  it('escribe la palabra y sólo da el código si se pide', () => {
    expect(rotuloArma('FLORETE')).toBe('Florete');
    expect(rotuloArma('espada')).toBe('Espada');
    expect(rotuloArma('SABLE', 'codigo')).toBe('SAB');
    expect(rotuloArma(null)).toBe('');
    expect(rotuloArma('XYZ')).toBe('');
  });
});

describe('rotuloGenero', () => {
  it('concuerda con el arma', () => {
    expect(rotuloGenero('M', { arma: 'FLORETE' })).toBe('masculino');
    expect(rotuloGenero('F', { arma: 'SABLE' })).toBe('femenino');
    expect(rotuloGenero('M', { arma: 'ESPADA' })).toBe('masculina');
    expect(rotuloGenero('F', { arma: 'ESPADA' })).toBe('femenina');
    expect(rotuloGenero('MIXTO', { arma: 'ESPADA' })).toBe('mixta');
  });
  it('sin arma y en corto', () => {
    expect(rotuloGenero('M')).toBe('Masculino');
    expect(rotuloGenero('F')).toBe('Femenino');
    expect(rotuloGenero('MIXTO')).toBe('Mixto');
    expect(rotuloGenero('M', { variante: 'corto' })).toBe('Masc.');
    expect(rotuloGenero('F', { arma: 'ESPADA', variante: 'corto' })).toBe('Fem.');
    expect(rotuloGenero(undefined)).toBe('');
  });
});

describe('rotuloCategoria y rotuloFormato', () => {
  it('mantiene los códigos de edad y nombra ABS y VET', () => {
    expect(rotuloCategoria('ABS')).toBe('Absoluto');
    expect(rotuloCategoria('VET')).toBe('Veteranos');
    expect(rotuloCategoria('m17')).toBe('M17');
    expect(rotuloCategoria('ABS', { omitirAbsoluto: true })).toBe('');
    expect(rotuloCategoria('ABS', { variante: 'corto' })).toBe('Abs');
    expect(rotuloCategoria(null)).toBe('');
  });
  it('modalidad', () => {
    expect(rotuloFormato('INDIVIDUAL')).toBe('Individual');
    expect(rotuloFormato('EQUIPOS')).toBe('Equipos');
    expect(rotuloFormato(undefined)).toBe('');
  });
  it('ordena ABS, de menor a mayor edad y VET al final', () => {
    const cats = ['VET', 'M20', 'ABS', 'M9', 'M17', 'M23'];
    expect([...cats].sort((a, b) => ordenCategoria(a) - ordenCategoria(b))).toEqual(['ABS', 'M9', 'M17', 'M20', 'M23', 'VET']);
  });
});

describe('rotuloPrueba', () => {
  it('largo', () => {
    expect(rotuloPrueba({ arma: 'ESPADA', genero: 'F', categoria: 'M17', formato: 'EQUIPOS' })).toBe('Espada femenina M17 · Equipos');
    expect(rotuloPrueba({ arma: 'FLORETE', genero: 'M', categoria: 'ABS', formato: 'INDIVIDUAL' })).toBe('Florete masculino');
    expect(rotuloPrueba({ arma: 'SABLE', genero: 'F', categoria: { codigo: 'VET' } })).toBe('Sable femenino · Veteranos');
    expect(rotuloPrueba({ arma: 'ESPADA', genero: 'F', categoria: 'ABS', formato: 'INDIVIDUAL' }, { categoria: 'siempre', formato: 'siempre' })).toBe(
      'Espada femenina · Absoluto · Individual',
    );
    expect(rotuloPrueba({ arma: 'ESPADA', genero: 'F', categoria: 'VET', formato: 'EQUIPOS' })).toBe('Espada femenina · Veteranos · Equipos');
  });
  it('corto', () => {
    expect(rotuloPrueba({ arma: 'FLORETE', genero: 'M', categoria: 'ABS' }, { variante: 'corto' })).toBe('Florete Masc.');
    expect(rotuloPrueba({ arma: 'ESPADA', genero: 'F', categoria: 'M17', formato: 'EQUIPOS' }, { variante: 'corto' })).toBe('Espada Fem. M17 · Equipos');
  });
  it('opciones de categoría y formato', () => {
    const p = { arma: 'SABLE', genero: 'M', categoria: 'ABS', formato: 'INDIVIDUAL' };
    expect(rotuloPrueba(p, { categoria: 'siempre', formato: 'siempre' })).toBe('Sable masculino · Absoluto · Individual');
    expect(rotuloPrueba({ ...p, categoria: 'VET' }, { variante: 'corto' })).toBe('Sable Masc. · Vet');
    expect(rotuloPrueba({ ...p, categoria: 'V40' })).toBe('Sable masculino V40');
    expect(rotuloPrueba({ ...p, categoria: 'M20', formato: 'EQUIPOS' }, { categoria: 'nunca', formato: 'nunca' })).toBe('Sable masculino');
  });
  it('nunca escribe códigos crudos ni undefined', () => {
    const texto = rotuloPrueba({ arma: undefined, genero: 'F', categoria: null, formato: 'EQUIPOS' });
    expect(texto).toBe('Femenino · Equipos');
    expect(rotuloPrueba({})).toBe('');
    expect(rotuloPrueba({ arma: '???', genero: 'Z' })).toBe('');
    for (const t of [texto]) expect(t).not.toMatch(/undefined|null|FLO|ESP|SAB/);
  });
});

describe('tablas antiguas de utils', () => {
  it('conservan nombres y valores', () => {
    expect(WEAPON_LABEL).toEqual({ FLORETE: 'Florete', ESPADA: 'Espada', SABLE: 'Sable' });
    expect(WEAPON_SHORT).toEqual({ FLORETE: 'FLO', ESPADA: 'ESP', SABLE: 'SAB' });
    expect(GENDER_LABEL).toEqual({ M: 'Masculino', F: 'Femenino', MIXTO: 'Mixto' });
    expect(GENDER_SHORT).toEqual({ M: 'M', F: 'F', MIXTO: 'Mx' });
    expect(CATEGORY_LABEL.ABS).toBe('Absoluto');
    expect(Object.keys(CATEGORY_LABEL)).toEqual(['M7', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M17', 'M20', 'M23', 'ABS', 'VET']);
    expect(CATEGORY_SHORT).toEqual({ ABS: 'Abs', VET: 'Vet' });
  });
});
