import { describe, expect, it } from 'vitest';
import {
  completarNombre,
  corteDosApellidos,
  cubre,
  nombrePropio,
  separarApellidosNombre,
} from '../scripts/indexado/perfiles-nombre';
import { construirFila, posibleMenor } from '../scripts/indexado/aplicar-perfiles';
import { alturaCm, clubesDeGraceNote, leerAtletaFie, manoDeFie, palabrasDeFoto } from '../scripts/indexado/perfiles-fie';
import {
  anioDeFecha,
  consensoFecha,
  elegirClub,
  fechaSkermo,
  leerClasificacionSkermo,
  normalizarClub,
} from '../scripts/indexado/perfiles-datos';

describe('completarNombre', () => {
  it('alarga el nombre FIE con el segundo apellido de Skermo y toma su acento', () => {
    const r = completarNombre('LLAVADOR Carlos', [
      { texto: 'CARLOS LLAVADOR FERNANDEZ', fuente: 'skermo_rfee', orden: 'nombre-apellidos', peso: 14 },
      { texto: 'CARLOS LLAVADOR FERNÁNDEZ', nombre: 'CARLOS', apellidos: 'LLAVADOR FERNÁNDEZ', fuente: 'skermo_pagina' },
    ]);
    expect(r).toMatchObject({
      completo: 'Carlos Llavador Fernández', nombre: 'Carlos', apellidos: 'Llavador Fernández',
      extendido: true, conAcentos: true, motivo: 'extendido',
    });
  });

  it('sin ninguna fuente acentuada, sin acentos', () => {
    const r = completarNombre('LLAVADOR Carlos', [
      { texto: 'CARLOS LLAVADOR FERNANDEZ', fuente: 'skermo_rfee', orden: 'nombre-apellidos', peso: 3 },
    ]);
    expect(r?.completo).toBe('Carlos Llavador Fernandez');
    expect(r?.conAcentos).toBe(false);
  });

  it('no usa variantes a las que les falta una palabra del nombre actual', () => {
    const r = completarNombre('ZABALA Juan', [
      { texto: 'JUAN GARCIA LOPEZ', fuente: 'skermo_rfee', orden: 'nombre-apellidos', peso: 50 },
    ]);
    expect(r).toMatchObject({ completo: 'Juan Zabala', extendido: false, motivo: 'igual' });
  });

  it('dos segundos apellidos incompatibles con apoyo parecido: no se alarga', () => {
    const r = completarNombre('LLAVADOR Carlos', [
      { texto: 'CARLOS LLAVADOR FERNANDEZ', fuente: 'skermo_rfee', orden: 'nombre-apellidos', peso: 3 },
      { texto: 'LLAVADOR GARCIA Carlos', fuente: 'engarde', peso: 2 },
    ]);
    expect(r).toMatchObject({ completo: 'Carlos Llavador', extendido: false, motivo: 'conflicto' });
  });

  it('con apoyo claramente mayor gana la variante mayoritaria', () => {
    const r = completarNombre('LLAVADOR Carlos', [
      { texto: 'CARLOS LLAVADOR FERNANDEZ', fuente: 'skermo_rfee', orden: 'nombre-apellidos', peso: 10 },
      { texto: 'LLAVADOR GARCIA Carlos', fuente: 'engarde', peso: 1 },
    ]);
    expect(r?.completo).toBe('Carlos Llavador Fernandez');
  });

  it('completa iniciales y truncados del PDF', () => {
    const r = completarNombre('LLAVADOR C', [
      { texto: 'LLAVADOR FERNA', fuente: 'rfee_pdf' },
      { texto: 'LLAVADOR FERNANDEZ Car', fuente: 'rfee_pdf' },
      { texto: 'LLAVADOR FERNANDEZ Carlos', fuente: 'engarde', peso: 2 },
    ]);
    expect(r).toMatchObject({ completo: 'Carlos Llavador Fernandez', extendido: true });
  });

  it('partículas en minúscula dentro del nombre', () => {
    const r = completarNombre('DE LA CAL ALMENDARIZ Manuel', []);
    expect(r?.completo).toBe('Manuel de la Cal Almendariz');
    expect(r?.apellidos).toBe('de la Cal Almendariz');
  });

  it('el nombre de la foto FIE sólo aporta acentos, nunca palabras (tiene erratas)', () => {
    const r = completarNombre('BENITEZ Javier', [
      { texto: 'BENÍTEZ MOREALES JAVIER', fuente: 'fie_foto', soloAcentos: true },
    ]);
    expect(r?.completo).toBe('Javier Benítez');
  });

  it('nombres compuestos con orden Nombre Apellidos de Skermo', () => {
    const r = completarNombre('VARGAS Cristina', [
      { texto: 'CRISTINA DE LOURDES VARGAS HILLA', fuente: 'skermo_rfee', orden: 'nombre-apellidos', peso: 4 },
    ]);
    expect(r).toMatchObject({ nombre: 'Cristina de Lourdes', apellidos: 'Vargas Hilla' });
  });

  it('guiones: «MARTIN-PORTUGUES» casa con «MARTIN PORTUGUES»', () => {
    const r = completarNombre('MARTIN-PORTUGUES Lucia', [
      { texto: 'LUCÍA', nombre: 'LUCÍA', apellidos: 'MARTÍN PORTUGUÉS GARCÍA', fuente: 'skermo_pagina' },
    ]);
    expect(r?.completo).toBe('Lucía Martín Portugués García');
  });

  it('nombre no hispano de la FIE: sólo reordena', () => {
    const r = completarNombre('LEE Samson Mun Hou', []);
    expect(r).toMatchObject({ completo: 'Samson Mun Hou Lee', extendido: false });
  });

  it('todo en mayúsculas sin orden conocido: no inventa el corte', () => {
    const r = completarNombre('CARLOS LLAVADOR FERNANDEZ', []);
    expect(r?.motivo).toBe('sin_estructura');
    expect(r?.completo).toBe('Carlos Llavador Fernandez');
  });
});

describe('piezas del nombre', () => {
  it('cubre: exacta, inicial y truncado; partículas opcionales', () => {
    expect(cubre(['carlos', 'llavador', 'fernandez'], ['llavador', 'carlos'])).toBe(true);
    expect(cubre(['carlos', 'llavador', 'fernandez'], ['llavador', 'c'])).toBe(true);
    expect(cubre(['carlos', 'llavador', 'fernandez'], ['llavador', 'ferna'])).toBe(true);
    expect(cubre(['manuel', 'cal'], ['manuel', 'de', 'la', 'cal'])).toBe(true);
    expect(cubre(['carlos', 'llavador'], ['carlos', 'llavador', 'fernandez'])).toBe(false);
    // «ca» es demasiado corto para un truncado.
    expect(cubre(['carlos', 'llavador'], ['ca', 'llavador'])).toBe(false);
  });

  it('separarApellidosNombre', () => {
    expect(separarApellidosNombre('LLAVADOR FERNANDEZ Carlos')).toEqual({ apellidos: ['LLAVADOR', 'FERNANDEZ'], nombre: ['Carlos'] });
    expect(separarApellidosNombre('LLAVADOR C')).toEqual({ apellidos: ['LLAVADOR'], nombre: ['C'] });
    expect(separarApellidosNombre('GARCIA Y LOPEZ Ana')).toEqual({ apellidos: ['GARCIA', 'Y', 'LOPEZ'], nombre: ['Ana'] });
    expect(separarApellidosNombre('CARLOS LLAVADOR')).toBeNull();
    expect(separarApellidosNombre('Carlos Llavador')).toBeNull();
  });

  it('corteDosApellidos', () => {
    expect(corteDosApellidos(['JUAN', 'ZABALA', 'GUTIERREZ'])).toBe(1);
    expect(corteDosApellidos(['MARIA', 'JOSE', 'DE', 'LA', 'CAL', 'RUIZ'])).toBe(2);
    expect(corteDosApellidos(['ANA', 'GARCIA'])).toBe(1);
  });

  it('nombrePropio', () => {
    expect(nombrePropio(["d'alessandro", 'marco'])).toBe("D'Alessandro Marco");
    expect(nombrePropio(['maría', 'de', 'los', 'ángeles'])).toBe('María de los Ángeles');
  });
});

describe('ficha FIE', () => {
  const ficha = {
    id: 21966, name: 'LLAVADOR Carlos', firstName: 'Carlos', lastName: 'LLAVADOR', countryCode: 'ESP',
    gender: 'M', date: '1992-04-26', hand: 'L', height: null, weapon: 'F', category: 'S', rank: 25,
    points: '68.500', image: 'https://static.fie.org/uploads/33/165113-LLAVADOR_FERNANDEZ_CARLOS_PAM478161.jpg',
    club: null, licenseStatus: 'Valid',
    fencerBiography: { club: null, residence: null, birthplace: null },
    graceNoteBiography: [{ header: 'x', rows: [
      { title: 'Club / Team', content: 'Sala de Armas de Madrid [ESP] / Frascati Scherma [ITA]: ' },
      { title: 'Handedness', content: 'Left' },
      { title: 'Residence', content: 'Frascati, ITA' },
    ] }],
    worldChampionshipMedals: { gold: 0, silver: 0, bronze: 1 },
    medals: [{}, {}],
  };

  it('lee los campos de perfil', () => {
    expect(leerAtletaFie(ficha, 21966)).toMatchObject({
      fechaNacimiento: '1992-04-26', mano: 'zurdo', alturaCm: null, pais: 'ESP',
      clubes: [{ nombre: 'Sala de Armas de Madrid', pais: 'ESP' }, { nombre: 'Frascati Scherma', pais: 'ITA' }],
      palabrasFoto: ['LLAVADOR', 'FERNANDEZ', 'CARLOS'],
      residencia: 'Frascati, ITA',
      medallas: { olimpicas: 0, mundiales: 1, total: 2 },
    });
  });

  it('rechaza la ficha de otro ID', () => {
    expect(leerAtletaFie(ficha, 1)).toBeNull();
  });

  it('mano, altura, clubes y foto', () => {
    expect(manoDeFie('R', null)).toBe('diestro');
    expect(manoDeFie(null, 'Left')).toBe('zurdo');
    expect(manoDeFie(null, null)).toBeNull();
    expect(alturaCm(185)).toBe(185);
    expect(alturaCm('1.78')).toBe(178);
    expect(alturaCm('1,78 m')).toBe(178);
    expect(alturaCm(40)).toBeNull();
    expect(clubesDeGraceNote('Club de Esgrima de Madrid: Spain')).toEqual([{ nombre: 'Club de Esgrima de Madrid', pais: null }]);
    expect(palabrasDeFoto('https://static.fie.org/uploads/37/187922-BEN%C3%8DTEZ_MOREALES_JAVIER.jpeg')).toEqual(['BENÍTEZ', 'MOREALES', 'JAVIER']);
    expect(palabrasDeFoto('https://static.fie.org/uploads/2/14427-7739.jpg')).toEqual([]);
  });
});

describe('construirFila (privacidad y combinación)', () => {
  const fieBase = leerAtletaFie({
    id: 49385, name: 'ZABALA Juan', firstName: 'Juan', lastName: 'ZABALA', countryCode: 'ESP', gender: 'M',
    date: '2003-07-15', hand: 'R', height: 180, image: null, licenseStatus: 'Valid', rank: 133, weapon: 'F', category: 'S',
  }, 49385)!;
  const nacional = {
    personaId: 'p1',
    club: { codigo: 'CCC-M', nombre: null, fuente: 'skermo_rfee', fecha: '2026-05-30' },
    fechas: [{ fecha: '2003-07-15', fuente: 'skermo_clasificacion' }],
    aniosSubdivision: [],
    variantes: [{ texto: 'JUAN ZABALA GUTIERREZ', nombre: 'JUAN', apellidos: 'ZABALA GUTIERREZ', fuente: 'skermo_clasificacion' }],
  };

  it('adulto: nombre completo, año, mano, altura y club; fecha sólo con --con-fecha', () => {
    const { fila } = construirFila({ personaId: 'p1', actual: 'ZABALA Juan', variantes: [], fie: { ...fieBase, personaId: 'p1' }, nacional }, '2026-10-05', false, 1);
    expect(fila).toMatchObject({
      full_name: 'Juan Zabala Gutierrez', name_extended: 1, birth_year: 2003, birth_date: null,
      hand: 'R', height_cm: 180, club_code: 'CCC-M', club_seen_on: '2026-05-30', fie_id: 49385,
    });
    const conFecha = construirFila({ personaId: 'p1', actual: 'ZABALA Juan', variantes: [], fie: { ...fieBase, personaId: 'p1' }, nacional }, '2026-10-05', true, 1);
    expect(conFecha.fila.birth_date).toBe('2003-07-15');
  });

  it('posible menor: sólo el año (que activa el veto), sin fecha, mano, altura ni extras', () => {
    const menor = { ...fieBase, personaId: 'p2', fechaNacimiento: '2010-01-01' };
    const { fila } = construirFila({ personaId: 'p2', actual: 'ZABALA Juan', variantes: [], fie: menor, nacional: null }, '2026-10-05', true, 1);
    expect(fila).toMatchObject({ birth_year: 2010, birth_date: null, hand: null, height_cm: null });
    expect(fila.extra).toBeNull();
    expect(posibleMenor(2008, '2026-10-05')).toBe(true);
    expect(posibleMenor(2007, '2026-10-05')).toBe(false);
  });

  it('sin fecha publicada, el año de la subdivisión del PDF', () => {
    const { fila } = construirFila({
      personaId: 'p3', actual: 'GARCIA Ana', variantes: [], fie: null,
      nacional: { personaId: 'p3', club: null, fechas: [], aniosSubdivision: [2009, 2009], variantes: [] },
    }, '2026-10-05', false, 1);
    expect(fila).toMatchObject({ birth_year: 2009, birth_source: 'rfee_pdf_subdivision', hand: null });
  });
});

describe('datos nacionales', () => {
  it('fechas de Skermo', () => {
    expect(fechaSkermo('31/08/2007')).toBe('2007-08-31');
    expect(fechaSkermo('31/02/2007')).toBeNull();
    expect(fechaSkermo('')).toBeNull();
    expect(anioDeFecha('2007-08-31')).toBe(2007);
  });

  it('normalizarClub quita el país de la FIE y espacios', () => {
    expect(normalizarClub('CCC-M (ESP)')).toBe('CCC-M');
    expect(normalizarClub('  SAMA-M ')).toBe('SAMA-M');
    expect(normalizarClub('UTB - Z')).toBe('UTB-Z');
    expect(normalizarClub('')).toBeNull();
  });

  it('elegirClub: el más reciente; un truncado del PDF se completa con el código entero', () => {
    const r = elegirClub([
      { club: 'FED-', fuente: 'rfee_pdf', fecha: '2026-03-14' },
      { club: 'FED-M-C', fuente: 'skermo_rfee', fecha: '2025-05-31' },
      { club: 'SAMA-M', fuente: 'engarde', fecha: '2017-06-24' },
    ]);
    expect(r).toEqual({ codigo: 'FED-M-C', nombre: null, fuente: 'rfee_pdf', fecha: '2026-03-14' });
  });

  it('elegirClub: un nombre legible (FIE extranjera) va a nombre, no a código', () => {
    expect(elegirClub([{ club: 'CAP Paulistano (BRA)', fuente: 'fie', fecha: '2024-01-01' }]))
      .toEqual({ codigo: null, nombre: 'CAP Paulistano', fuente: 'fie', fecha: '2024-01-01' });
  });

  it('elegirClub: truncado sin código entero se salta', () => {
    expect(elegirClub([
      { club: 'CEL-', fuente: 'rfee_pdf', fecha: '2026-01-01' },
      { club: 'SAMA-M', fuente: 'engarde', fecha: '2015-01-01' },
    ])?.codigo).toBe('SAMA-M');
  });

  it('consensoFecha', () => {
    expect(consensoFecha([{ fecha: '1992-04-26', fuente: 'skermo' }, { fecha: '1992-04-26', fuente: 'fie' }]))
      .toMatchObject({ fecha: '1992-04-26', anio: 1992, conflicto: false });
    expect(consensoFecha([{ fecha: '1992-04-26', fuente: 'a' }, { fecha: '1992-05-26', fuente: 'b' }]))
      .toMatchObject({ fecha: null, anio: 1992, conflicto: true });
    expect(consensoFecha([{ fecha: '1992-04-26', fuente: 'a' }, { fecha: '1995-04-26', fuente: 'b' }]))
      .toMatchObject({ fecha: null, anio: null, conflicto: true });
  });

  it('leerClasificacionSkermo', () => {
    const html = `<table class="table"><thead><tr><th class="hidden-sm hidden-xs">Posici&oacute;n</th><th>Licencia</th>
      <th>Nombre</th><th>Apellidos</th><th>Club</th><th>Fecha Nacimiento</th><th>Puntuaci&oacute;n</th></tr></thead>
      <tbody><tr><td>3</td><td>LMH00752</td><td><span class="hidden-lg hidden-md">3. </span>LAIA</td>
      <td>MART&Iacute;N HERN&Aacute;NDEZ</td><td>EHB-B</td><td>28/10/2007</td><td>1726.07</td></tr></tbody></table>`;
    expect(leerClasificacionSkermo(html)).toEqual([
      { licencia: 'LMH00752', nombre: 'LAIA', apellidos: 'MARTÍN HERNÁNDEZ', club: 'EHB-B', fechaNacimiento: '2007-10-28' },
    ]);
  });

  it('elegirClub: a igual fecha manda Skermo sobre el PDF', () => {
    const r = elegirClub([
      { club: 'CCC-', fuente: 'rfee_pdf', fecha: '2026-03-14' },
      { club: 'CCC-M', fuente: 'skermo_rfee', fecha: '2026-03-14' },
    ]);
    expect(r?.codigo).toBe('CCC-M');
  });
});
