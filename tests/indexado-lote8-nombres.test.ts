import { describe, expect, it } from 'vitest';
import {
  analizarNombre, firmaApellidos, mejorRelacion, nivelUnion, normalizarUnion, relacionNombres,
} from '../scripts/indexado/nombres-union';

describe('normalización para uniones', () => {
  it('mayúsculas, tildes, ñ, ç, guiones, apóstrofos, espacios y partículas', () => {
    expect(normalizarUnion('  NÚÑEZ   DE LA PEÑA  Ángel ')).toBe('nunez pena angel');
    expect(normalizarUnion('Muñoz-Repiso García')).toBe(normalizarUnion('MUNOZ REPISO GARCIA'));
    expect(normalizarUnion("D'ALESSANDRO Giulia")).toBe(normalizarUnion('DALESSANDRO Giulia'));
    expect(normalizarUnion('GARÇON Françoise')).toBe('garcon francoise');
    expect(normalizarUnion('VAN DER BERG Jan')).toBe('berg jan');
    expect(normalizarUnion('PUJOL I FERRER Jordi')).toBe('pujol ferrer jordi');
    expect(normalizarUnion('GARCÍA Y LÓPEZ Luis')).toBe('garcia lopez luis');
    expect(normalizarUnion('SØRENSEN Æble')).toBe('sorensen aeble');
  });

  it('abreviaturas: Mª, M.ª, Fco., Fdez., José Mª', () => {
    expect(normalizarUnion('GARCIA LOPEZ Mª José')).toBe('garcia lopez maria jose');
    expect(normalizarUnion('GARCIA LOPEZ M.ª José')).toBe('garcia lopez maria jose');
    expect(normalizarUnion('MARTIN Fco. Javier')).toBe('martin francisco javier');
    expect(normalizarUnion('FDEZ. GARCIA José Mª')).toBe('fernandez garcia jose maria');
    expect(normalizarUnion('Mª JOSE GARCIA LOPEZ')).toBe('maria jose garcia lopez');
  });

  it('parte nombre y apellidos según las mayúsculas de la fuente', () => {
    expect(analizarNombre('ROMERO ORTÍN Héctor')).toMatchObject({ apellidos: ['romero', 'ortin'], nombre: ['hector'] });
    expect(analizarNombre('Héctor ROMERO ORTÍN')).toMatchObject({ apellidos: ['romero', 'ortin'], nombre: ['hector'] });
    expect(analizarNombre('José María Pérez García')).toMatchObject({ apellidos: ['perez', 'garcia'], nombre: ['jose', 'maria'] });
    expect(analizarNombre('HÉCTOR ROMERO ORTÍN')).toMatchObject({ apellidos: null, nombre: null });
    expect(analizarNombre('HÉCTOR ROMERO ORTÍN', 'nombre_primero')).toMatchObject({ apellidos: ['romero', 'ortin'] });
  });
});

describe('relación entre dos nombres publicados', () => {
  const r = relacionNombres;
  it('el mismo nombre en los tres formatos de las fuentes', () => {
    expect(r('ROMERO ORTÍN Héctor', 'HÉCTOR ROMERO ORTÍN')).toBe('mismo');
    expect(r('HECTOR ROMERO ORTIN', 'ROMERO ORTIN HECTOR')).toBe('mismo');
    expect(r('ROMERO ORTIN Hector', 'Héctor Romero Ortín')).toBe('mismo');
    expect(r('GARCIA LOPEZ Mª José', 'MARIA JOSE GARCIA LOPEZ')).toBe('mismo');
  });

  it('apellidos cruzados: hace falta otra evidencia', () => {
    expect(r('ROMERO ORTIN Héctor', 'ORTIN ROMERO Héctor')).toBe('orden_cruzado');
    expect(r('ROMERO ORTIN Hector', 'HECTOR ORTIN ROMERO')).toBe('orden_cruzado');
    expect(r('HECTOR ROMERO ORTIN', 'HECTOR ORTIN ROMERO')).toBe('orden_cruzado');
    expect(r('ROMERO ORTIN', 'ORTIN ROMERO')).toBe('orden_cruzado');
    expect(r('ORTIN ROMERO', 'ROMERO ORTIN Hector')).toBe('orden_cruzado');
    // La FIE publica un solo apellido: si es el segundo del otro, también es cruzado.
    expect(r('ORTIN Sandra', 'SANDRA ROMERO ORTIN')).toBe('orden_cruzado');
    expect(nivelUnion('orden_cruzado')).toBe('evidencia');
  });

  it('hermanos (mismos apellidos, otro nombre): nunca', () => {
    expect(r('ORTIN ROMERO Sandra', 'ORTIN ROMERO German')).toBe('hermanos');
    expect(r('SANDRA ORTIN ROMERO', 'GERMAN ORTIN ROMERO')).toBe('hermanos');
    expect(r('ORTIN ROMERO Sandra', 'GERMAN ORTIN ROMERO')).toBe('hermanos');
    expect(r('FLOREZ DE VARGAS Carlos', 'FLOREZ DE VARGAS Ana')).toBe('hermanos');
    expect(nivelUnion('hermanos')).toBe('nunca');
  });

  it('primos (un apellido en común y el otro claramente distinto): nunca por nombre', () => {
    expect(r('GARCIA LOPEZ Juan', 'GARCIA PEREZ Juan')).toBe('primos');
    expect(r('JUAN GARCIA LOPEZ', 'JUAN MARTIN GARCIA')).toBe('primos');
    expect(r('TORRES MAZA Carmen', 'CARMEN TORRES CHISCANO', { b: 'nombre_primero' })).toBe('primos');
    expect(nivelUnion('primos')).toBe('nunca');
    // Dos letras al final con el mismo comienzo puede ser una errata: no se decide por nombre.
    expect(r('LOPEZ YUSTA Emilio', 'LOPEZ YUSTES Emilio')).toBe('distinto');
    // Un apellido recortado a dos letras no es otro apellido.
    expect(nivelUnion(r('ZAGO MA Enzo', 'ENZO ZAGO MARTIN', { b: 'nombre_primero' }))).toBe('libre');
  });

  it('nombre compuesto frente a simple: el simple es una parte del compuesto, en orden', () => {
    expect(r('GARCIA LOPEZ José María', 'GARCIA LOPEZ José')).toBe('compuesto_simple');
    expect(r('JOSE MARIA GARCIA LOPEZ', 'GARCIA LOPEZ Jose')).toBe('compuesto_simple');
    // Quien firma con el segundo nombre («Francisco Javier» → «Javier»).
    expect(r('MOLINA GARCIA Javier', 'MOLINA GARCIA Francisco Javier')).toBe('compuesto_simple');
    expect(r('ZAMORANO SALARDON Maria Covadon', 'COVADONGA ZAMORANO SALARDÓN')).toBe('compuesto_simple');
    expect(r('SHAW Paul', 'SHAW John-Paul')).toBe('compuesto_simple');
    // El mismo par de nombres en otro orden es otro nombre.
    expect(r('GARCIA LOPEZ María José', 'GARCIA LOPEZ José María')).toBe('hermanos');
    expect(r('GARCIA LOPEZ Juan Carlos', 'GARCIA LOPEZ Juan Pablo')).toBe('hermanos');
    expect(nivelUnion('compuesto_simple')).toBe('libre');
  });

  it('apellidos compuestos, partidos o juntados, y recortes del PDF sin nombre', () => {
    expect(nivelUnion(r('GONZALEZ DE HERRERO FER', 'PABLO GONZALEZ DE HERRERO FERNÁNDEZ', { a: 'apellidos_primero', b: 'nombre_primero' }))).toBe('libre');
    expect(nivelUnion(r('SANTESTEBAN MARTINEZ DE LUC', 'ASIER SANTESTEBAN MARTINEZ DE LUCO', { a: 'apellidos_primero', b: 'nombre_primero' }))).toBe('libre');
    expect(nivelUnion(r('MUÑOZ LOPEZ-BARA', 'JAIME MUÑOZ LOPEZ-BARAJAS', { a: 'apellidos_primero', b: 'nombre_primero' }))).toBe('libre');
    expect(nivelUnion(r('LOPEZ RUIPEREZ', 'CARLOS LOPEZ RUIPEREZ GARCIA', { a: 'apellidos_primero', b: 'nombre_primero' }))).toBe('libre');
    expect(r('CARRASCOSA LORENTE Miguel', 'CARRASC OSA LORENTE Miguel')).toBe('mismo');
    expect(nivelUnion(r('LAMA PEREIRA RODRÍGUEZ Julia', 'JULIA LAMAPEREIRA RODRÍGUEZ', { b: 'nombre_primero' }))).toBe('libre');
    expect(nivelUnion(r('GARCIA MARTIN Nicolas', 'GARCÍA-SAN MIGUEL MARTIN Nicolás'))).toBe('libre');
    expect(r('CHANG Kaiden', 'KAIDEN SEMAPAKDI-CHANG', { b: 'nombre_primero' })).toBe('recortado');
    expect(nivelUnion(r('PALAO NUÑEZ Jorge', 'PALAO NU #65533;EZ Jorge'))).not.toBe('nunca');
    // «Ll» es el comienzo de «Lluís»: no es otro nombre de pila.
    expect(nivelUnion(r('VÁZQUEZ CARRIÓ Ll', 'LUIS VÁZQUEZ CARRIÓ', { b: 'nombre_primero' }))).toBe('libre');
  });

  it('extranjeros en Skermo: un apellido y dos nombres', () => {
    expect(r('PERSAUD Daivik Ros', 'DAIVIK ROSHAN PERSAUD', { b: 'nombre_primero' })).toBe('recortado');
    expect(r('DINCA Maria Sofía', 'MARIA SOFÍA DINCA', { b: 'nombre_primero' })).toBe('mismo');
    expect(r('COSTE Daniel Jac', 'DANIEL JACQUES COSTE', { b: 'nombre_primero' })).toBe('recortado');
    expect(r('SERBANESCU Ale', 'ALEXA MARIA SERBANESCU', { b: 'nombre_primero' })).toBe('compuesto_simple');
    expect(r('ODORICO Loukas Jac', 'LOUKAS JACQUELINO, JEAN-LUIS ODORICO', { b: 'nombre_primero' })).toBe('compuesto_simple');
  });

  it('el formato de cada fuente y sus errores', () => {
    // Dos palabras al revés en fuentes con formatos distintos: el mismo nombre.
    expect(r('ANTIVERO LUCILA', 'LUCILA ANTIVERO', { a: 'apellidos_primero', b: 'nombre_primero' })).toBe('mismo');
    // El PDF que escribe el nombre delante, frente a Engarde.
    expect(r('BELMONTE Elodie', 'ELODIE BELMONTE', { b: 'apellidos_primero' })).toBe('mismo');
    expect(nivelUnion(r('ELODIE BELMONTE', 'ELODIE BELMONTE DELGADO', { a: 'apellidos_primero', b: 'nombre_primero' }))).toBe('libre');
    // …pero dos palabras al revés en el mismo formato siguen siendo los apellidos cruzados.
    expect(r('ROMERO ORTIN', 'ORTIN ROMERO S', { a: 'apellidos_primero', b: 'apellidos_primero' })).toBe('orden_cruzado');
    // La FIE con un apellido frente al PDF que recorta: no se sabe si la tercera palabra es nombre.
    expect(nivelUnion(r('AGUILAR Gloria', 'AGUILAR FERNANDEZ MAYORALA', { b: 'apellidos_primero' }))).toBe('libre');
    expect(nivelUnion(r('SOLANO FERNANDEZ SOR', 'GONZALO SOLANO FERNANDEZ-SORDO', { a: 'apellidos_primero', b: 'nombre_primero' }))).toBe('libre');
    expect(nivelUnion(r('CARVALHO GERARDO PIR', 'JOAO RODRIGO CARVALHO GERARDO PIRES DA CRUZ', { a: 'apellidos_primero', b: 'nombre_primero' }))).toBe('libre');
    expect(nivelUnion(r('LAMA PEREIRA ROD', 'LAMAPEREIRA RODRIGUEZ Julia', { a: 'apellidos_primero' }))).toBe('libre');
    // Pero con dos apellidos publicados, una tercera palabra entera es el nombre de pila.
    expect(r('ORTIN ROMERO GERMAN', 'ORTIN ROMERO Sandra', { a: 'apellidos_primero' })).toBe('hermanos');
  });

  it('recortes del PDF e iniciales', () => {
    expect(r('ROMERO ORTÍN Hé', 'ROMERO ORTIN Hector')).toBe('recortado');
    expect(r('RAMIREZ LARENA Al', 'ALEJANDRO RAMIREZ LARENA')).toBe('recortado');
    expect(r('ZABALA GUTIERRE', 'JUAN ZABALA GUTIERREZ')).toBe('recortado');
    expect(r('GARCIA LOPEZ M.', 'GARCIA LOPEZ Maria')).toBe('recortado');
    expect(r('ORTIN German', 'GERMAN ORTIN ROMERO')).toBe('recortado');
    expect(r('ROMERO ORTIN', 'ROMERO ORTIN Hector')).toBe('recortado');
  });

  it('un carácter distinto: candidato único y otra pista', () => {
    expect(r('ALMANCHA PEREZ Luis', 'ALMARCHA PEREZ Luis')).toBe('variante_caracter');
    // Dos letras cambiadas ya no es una errata de un carácter: otro segundo apellido.
    expect(nivelUnion(r('KIM YUOM San', 'KIM YOUM San'))).toBe('nunca');
    expect(r('ALMANCHA PEREZ Luisa', 'ALMARCHA PEREZ Luis')).toBe('distinto');
    expect(nivelUnion('variante_caracter')).toBe('pista');
  });

  it('elige el par más compatible y firma el orden de los apellidos', () => {
    expect(mejorRelacion(['ORTIN ROMERO'], ['ROMERO ORTIN Hector', 'HÉCTOR ROMERO ORTÍN'])?.relacion).toBe('orden_cruzado');
    expect(mejorRelacion(['ROMERO ORTIN'], ['ORTIN ROMERO', 'HÉCTOR ROMERO ORTÍN'])).toEqual({ relacion: 'recortado', a: 'ROMERO ORTIN', b: 'HÉCTOR ROMERO ORTÍN' });
    expect(firmaApellidos('ROMERO ORTÍN Héctor')).toBe(firmaApellidos('HÉCTOR ROMERO ORTÍN'));
    expect(firmaApellidos('ORTIN ROMERO Héctor')).not.toBe(firmaApellidos('ROMERO ORTIN Héctor'));
    expect(firmaApellidos('ORTIN ROMERO')).not.toBe(firmaApellidos('ROMERO ORTIN'));
  });
});
