import { describe, expect, it } from 'vitest';
import {
  enlaceDeCobertura,
  enlacesDePrueba,
  estadoResultados,
  urlResultadosSegura,
} from '@/lib/sport/explorar/edicion-modelo';
import {
  RUTA_EDICIONES,
  construirUrlEdicion,
  edicionDeRuta,
  leerCriteriosEdicion,
  rutaEdicion,
  sanitizarRetornoEdicion,
  urlExplorarDePrueba,
} from '@/lib/sport/explorar/edicion-url';
import { estadoLectura } from '@/lib/sport/explorar/etiquetas';
import { rutaFichaConRetorno, sanitizarRetorno } from '@/lib/sport/explorar/ficha-url';
import { leerCriterios } from '@/lib/sport/explorar/url';
import { UUID_A, UUID_B, UUID_C } from './helpers/explorar';

/**
 * Direcciones, enlaces y estados de las páginas de edición. Todo puro: ni base
 * de datos, ni red, ni sesión.
 */

const GUID = '0a1b2c3d-1111-4222-8333-444455556666';

describe('direcciones de edición', () => {
  it('rutaEdicion y edicionDeRuta se corresponden y rechazan lo que no es un identificador', () => {
    expect(rutaEdicion(UUID_A)).toBe(`/explorar/ediciones/${UUID_A}`);
    expect(edicionDeRuta(UUID_A.toUpperCase())).toBe(UUID_A);
    for (const malo of ['', 'abc', `${UUID_A}x`, '../../perfil', 'perfil']) {
      expect(edicionDeRuta(malo)).toBeNull();
    }
  });

  it('construirUrlEdicion sólo escribe prueba y cursor y leerCriteriosEdicion los recupera', () => {
    const url = construirUrlEdicion(UUID_A, { prueba: UUID_B, cursor: 'c1' });
    expect(url).toBe(`${RUTA_EDICIONES}/${UUID_A}?prueba=${UUID_B}&cursor=c1`);
    const consulta = Object.fromEntries(new URL(url, 'http://x').searchParams);
    expect(leerCriteriosEdicion(consulta)).toEqual({ prueba: UUID_B, cursor: 'c1' });
    expect(construirUrlEdicion(UUID_A)).toBe(`${RUTA_EDICIONES}/${UUID_A}`);
  });

  it('una prueba que no es un identificador se descarta', () => {
    expect(leerCriteriosEdicion({ prueba: '1; DROP TABLE', cursor: 'x' })).toEqual({ prueba: '', cursor: 'x' });
  });

  it('el retorno a una edición se reconstruye con claves conocidas y rechaza lo ajeno', () => {
    expect(sanitizarRetornoEdicion(`${RUTA_EDICIONES}/${UUID_A}?prueba=${UUID_B}&cursor=zz&x=1`)).toBe(
      `${RUTA_EDICIONES}/${UUID_A}?prueba=${UUID_B}&cursor=zz`,
    );
    expect(sanitizarRetornoEdicion(`${RUTA_EDICIONES}?x=1`)).toBe(RUTA_EDICIONES);
    for (const malo of [
      `${RUTA_EDICIONES}/no-es-id`,
      `${RUTA_EDICIONES}/${UUID_A}/../../perfil`,
      '/perfil',
      `https://evil.example/${RUTA_EDICIONES}/${UUID_A}`,
    ]) {
      expect(sanitizarRetornoEdicion(malo)).toBe('');
    }
  });

  it('la ficha acepta volver a la edición y rechaza hosts, esquemas y barras invertidas', () => {
    const volver = `${RUTA_EDICIONES}/${UUID_A}?prueba=${UUID_B}`;
    expect(sanitizarRetorno(volver)).toBe(volver);
    expect(sanitizarRetorno(RUTA_EDICIONES)).toBe(RUTA_EDICIONES);
    for (const malo of [
      `//evil.example${RUTA_EDICIONES}`,
      `javascript:${RUTA_EDICIONES}`,
      `${RUTA_EDICIONES}\\..\\perfil`,
      `${RUTA_EDICIONES}/${UUID_A}\n?prueba=${UUID_B}`,
      `${RUTA_EDICIONES}/${UUID_A}?prueba=${UUID_B}`.padEnd(5000, 'a'),
    ]) {
      expect(sanitizarRetorno(malo)).toBe('');
    }
  });

  it('la ficha deportiva de una fila nunca apunta a /perfil y conserva la clasificación de origen', () => {
    const volver = construirUrlEdicion(UUID_A, { prueba: UUID_B });
    const ruta = rutaFichaConRetorno(UUID_C, volver);
    expect(ruta.startsWith(`/explorar/${UUID_C}?`)).toBe(true);
    expect(ruta).not.toContain('/perfil');
    expect(new URL(ruta, 'http://x').searchParams.get('volver')).toBe(volver);
  });
});

describe('Explorar de una prueba', () => {
  const prueba = {
    arma: 'ESPADA',
    genero: 'F',
    categoria: { codigo: 'ABS', raw: 'Senior' },
    formato: 'INDIVIDUAL',
  };

  it('lleva edición, arma, género, formato y categoría literal, y Explorar los lee tal cual', () => {
    const url = urlExplorarDePrueba(UUID_A, prueba);
    const consulta = new URL(url, 'http://x').searchParams;
    expect(url.startsWith('/explorar?')).toBe(true);
    expect(consulta.get('edicionId')).toBe(UUID_A);
    expect(consulta.get('formato')).toBe('INDIVIDUAL');
    expect(consulta.get('categoriaRaw')).toBe('Senior');
    const criterios = leerCriterios(Object.fromEntries(consulta));
    expect(criterios.criterios).toMatchObject({ edicionId: UUID_A, formato: 'INDIVIDUAL', categoriaRaw: 'Senior' });
  });

  it('si el literal de la fuente no cabe en un filtro usa el código de categoría', () => {
    const url = urlExplorarDePrueba(UUID_A, { ...prueba, categoria: { codigo: 'U17', raw: 'Cadete  (U17)' } });
    const consulta = new URL(url, 'http://x').searchParams;
    expect(consulta.has('categoriaRaw')).toBe(false);
    expect(consulta.get('categoria')).toBe('U17');
    const largo = urlExplorarDePrueba(UUID_A, { ...prueba, categoria: { codigo: 'ABS', raw: 'x'.repeat(41) } });
    expect(new URL(largo, 'http://x').searchParams.has('categoriaRaw')).toBe(false);
  });

  it('sin literal publicado viaja el código y nunca un filtro vacío', () => {
    const url = urlExplorarDePrueba(UUID_A, { ...prueba, categoria: { codigo: 'ABS', raw: null } });
    const consulta = new URL(url, 'http://x').searchParams;
    expect(consulta.get('categoria')).toBe('ABS');
    expect(consulta.has('categoriaRaw')).toBe(false);
  });
});

describe('estado de los resultados de una prueba', () => {
  it('«completo» exige filas y que ninguna lectura sea parcial, en error o en conflicto', () => {
    expect(estadoResultados(8, [{ estado: 'completo' }])).toBe('completo');
    expect(estadoResultados(8, [{ estado: 'completo' }, { estado: 'parcial' }])).toBe('parcial');
    expect(estadoResultados(8, [{ estado: 'completo' }, { estado: 'error' }])).toBe('parcial');
    expect(estadoResultados(8, [{ estado: 'completo' }, { estado: 'conflicto' }])).toBe('parcial');
    expect(estadoResultados(8, [])).toBe('parcial');
  });

  it('sin filas, la ausencia no se toma por «sin resultados» salvo que la fuente lo diga', () => {
    expect(estadoResultados(0, [])).toBe('pendiente');
    expect(estadoResultados(0, [{ estado: 'pendiente' }])).toBe('pendiente');
    expect(estadoResultados(0, [{ estado: 'error' }])).toBe('error');
    expect(estadoResultados(0, [{ estado: 'conflicto' }])).toBe('conflicto');
    expect(estadoResultados(0, [{ estado: 'sin_resultados' }])).toBe('sin_resultados');
  });
});

describe('enlaces de resultados comprobados', () => {
  const engarde = 'https://www.engarde-service.com/competition/ctomadabs19/emabs/ind';
  const fww = 'https://www.fencingworldwide.com/en/12345-2024/results/';
  const ftl = `https://www.fencingtimelive.com/events/results/${GUID}`;

  it('sólo se ofrece enlace con estado verificado o solo_enlace y URL específica del proveedor', () => {
    expect(enlaceDeCobertura({ fuente: 'enlace:engarde', cursor: 'verificado', url: engarde })).toEqual({
      proveedor: 'engarde',
      tipo: 'verificado',
      url: engarde,
    });
    expect(enlaceDeCobertura({ fuente: 'enlace:fww', cursor: 'verificado', url: fww })).toMatchObject({
      tipo: 'verificado',
    });
  });

  it('Fencing Time Live «solo_enlace» sigue el torneo: nunca se presenta como verificado', () => {
    const e = enlaceDeCobertura({ fuente: 'enlace:ftl', cursor: 'solo_enlace', url: ftl });
    expect(e).toEqual({ proveedor: 'ftl', tipo: 'solo_enlace', url: ftl });
    expect(enlaceDeCobertura({ fuente: 'enlace:ftl', cursor: 'verificado', url: ftl })).toMatchObject({
      tipo: 'verificado',
    });
  });

  it.each([
    ['no_publicado', 'no_publicado'],
    ['solo_referencia', 'no_publicado'],
    ['revision', 'en_revision'],
    ['rechazado', 'en_revision'],
    ['error', 'error'],
    [null, 'no_comprobable'],
    ['desconocido', 'no_comprobable'],
  ])('el estado %s nunca ofrece URL aunque la fila traiga una', (cursor, motivo) => {
    const e = enlaceDeCobertura({ fuente: 'enlace:engarde', cursor, url: engarde });
    expect(e).toEqual({ proveedor: 'engarde', tipo: 'sin_enlace', motivo });
  });

  it('un estado verificado sin URL específica no ofrece enlace', () => {
    expect(enlaceDeCobertura({ fuente: 'enlace:engarde', cursor: 'verificado', url: null })).toMatchObject({
      tipo: 'sin_enlace',
    });
  });

  it('una fuente que no es de enlaces se ignora', () => {
    expect(enlaceDeCobertura({ fuente: 'fie', cursor: 'verificado', url: engarde })).toBeNull();
    expect(enlacesDePrueba([{ fuente: 'rfee', cursor: 'verificado', url: engarde }])).toEqual([]);
  });

  it('un enlace por proveedor, en orden estable', () => {
    const lista = enlacesDePrueba([
      { fuente: 'enlace:ftl', cursor: 'solo_enlace', url: ftl },
      { fuente: 'enlace:engarde', cursor: 'verificado', url: engarde },
      { fuente: 'enlace:fww', cursor: 'no_publicado', url: null },
    ]);
    expect(lista.map((e) => e.proveedor)).toEqual(['engarde', 'fww', 'ftl']);
  });

  it('no se aceptan portadas, otros hosts, esquemas ni credenciales', () => {
    const malas: [Parameters<typeof urlResultadosSegura>[0], string][] = [
      ['engarde', 'https://www.engarde-service.com/'],
      ['engarde', 'https://www.engarde-service.com/competition/solo/dos'],
      ['engarde', 'https://evil.example/competition/a/b/c'],
      ['engarde', 'javascript:alert(1)'],
      ['engarde', 'https://user:pass@www.engarde-service.com/competition/a/b/c'],
      ['fww', 'https://www.fencingworldwide.com/'],
      ['fww', 'https://www.fencingworldwide.com/en/abc'],
      ['fww', 'ftp://www.fencingworldwide.com/en/1-2024'],
      ['ftl', 'https://www.fencingtimelive.com/'],
      ['ftl', 'https://www.fencingtimelive.com/events/results/no-guid'],
      ['ftl', `https://fencingtimelive.com.evil.example/events/results/${GUID}`],
    ];
    for (const [proveedor, url] of malas) expect(urlResultadosSegura(proveedor, url)).toBeNull();
    expect(urlResultadosSegura('engarde', null)).toBeNull();
    expect(urlResultadosSegura('ftl', 'no es una url')).toBeNull();
  });

  it('descarta parámetros y fragmento de la URL ofrecida', () => {
    expect(urlResultadosSegura('ftl', `${ftl}?token=secreto#x`)).toBe(ftl.replace('www.', 'www.'));
  });
});

describe('lectura de la cobertura de enlaces', () => {
  it('un enlace completo se lee como enlace registrado, no como lectura completa de resultados', () => {
    const l = estadoLectura('link', 'completo');
    expect(l.texto).toBe('Enlace registrado');
    expect(l.ayuda).toMatch(/No significa que sus resultados estén importados/);
    expect(estadoLectura('link', 'pendiente').texto).toBe('Sin enlace publicado');
  });

  it('los demás hechos conservan su texto y no se llaman «enlace»', () => {
    expect(estadoLectura('results', 'completo').texto).not.toMatch(/enlace/i);
  });
});
