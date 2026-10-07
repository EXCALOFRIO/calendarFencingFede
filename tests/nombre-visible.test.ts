import { describe, expect, it } from 'vitest';
import { inicialesVisibles, nombreCompacto, nombreVisible, partesNombre } from '@/lib/sport/nombre-visible';

describe('nombreVisible', () => {
  it('FIE: apellidos en mayúsculas y nombre después', () => {
    expect(nombreVisible('PEREZ GARCIA Juan')).toBe('Juan Perez Garcia');
    expect(nombreVisible('GARCIA DE LAS CUEVAS Lucas')).toBe('Lucas Garcia de las Cuevas');
    expect(nombreVisible('MARTIN-PORTUGUES Lucia')).toBe('Lucia Martin-Portugues');
    expect(nombreVisible('LETOU Koffi Frederic')).toBe('Koffi Frederic Letou');
  });
  it('RFEE: todo en mayúsculas, nombre primero', () => {
    expect(nombreVisible('LUCIA RIVERO REDONDO')).toBe('Lucia Rivero Redondo');
    expect(nombreVisible('JOSE ANGEL DE LOS RIOS TOBAR')).toBe('Jose Angel de los Rios Tobar');
    expect(nombreVisible('HÉCTOR RIVAS JIMÉNEZ')).toBe('Héctor Rivas Jiménez');
  });
  it('respeta lo que ya viene en formato título', () => {
    expect(nombreVisible('Juan Pérez García')).toBe('Juan Pérez García');
  });
  it('partes e iniciales', () => {
    expect(partesNombre('CASAL CAMPELO Pedro')).toEqual({ nombre: 'Pedro', apellidos: 'CASAL CAMPELO' });
    expect(inicialesVisibles('PEREZ GARCIA Juan')).toBe('JP');
    expect(nombreVisible(null)).toBe('');
  });
});

describe('nombreCompacto', () => {
  it('primer apellido (con partículas) e inicial del nombre', () => {
    expect(nombreCompacto('ZABALA GUTIERREZ Juan')).toBe('Zabala J.');
    expect(nombreCompacto('GARCIA DE LAS CUEVAS Lucas')).toBe('Garcia L.');
    expect(nombreCompacto('MARTIN-PORTUGUES Lucia')).toBe('Martin-Portugues L.');
    expect(nombreCompacto('LETOU Koffi Frederic')).toBe('Letou K.');
  });
  it('sin apellidos marcados no adivina: nombre visible entero', () => {
    expect(nombreCompacto('LUCIA RIVERO REDONDO')).toBe('Lucia Rivero Redondo');
    expect(nombreCompacto(null)).toBe('');
  });
});
