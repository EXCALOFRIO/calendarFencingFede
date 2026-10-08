import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { puestosPoule } from '@/components/explorar/prueba/logica';
import type { DatosCaraACara } from '@/lib/sport/explorar/cara-a-cara-pantalla';
import { CRITERIOS_CARA_A_CARA_VACIOS } from '@/lib/sport/explorar/cara-a-cara-url';
import type { EncuentroCaraACara } from '@/lib/sport/explorar/cara-a-cara';
import type { PruebaCompartida } from '@/lib/sport/explorar/rendimiento';
import type { PouleDePrueba } from '@/lib/sport/explorar/tipos-busqueda';
import { UUID_A, UUID_B, UUID_C } from './helpers/explorar';

const { PoulesDePrueba } = await import('@/components/explorar/asaltos-prueba');
const { AsaltosCaraACara, CabeceraCaraACara, CaraACaraCompleto, ElegirRival, asaltosDirectos } = await import(
  '@/components/explorar/cara-a-cara'
);
const { BarraVictorias } = await import('@/components/explorar/barra-victorias');
const { PuestosComparados, escalaPuesto, marcasPuesto, mediaMovil, resumenDelante } = await import(
  '@/components/explorar/graficos/puestos-comparados'
);
const { resumenTendencia } = await import('@/components/explorar/graficos/dispersion-puestos');

const html = (nodo: React.ReactElement) => renderToStaticMarkup(nodo);

/* ------------------------------------------------------------------ poules */

const v = (tantos: number) => ({ tantos, victoria: true });
const d = (tantos: number) => ({ tantos, victoria: false });

const poule: PouleDePrueba = {
  ronda: 'P1',
  etiqueta: 'Poule 1',
  filas: [
    { clave: 'a', personaId: UUID_A, nombre: 'GARCIA Ana', pais: 'ESP', celdas: [null, v(5), d(2)], victorias: 1, asaltos: 2, tocados: 7, recibidos: 8 },
    { clave: 'b', personaId: UUID_B, nombre: 'RUIZ Bea', pais: 'FRA', celdas: [d(3), null, v(5)], victorias: 1, asaltos: 2, tocados: 8, recibidos: 7 },
    { clave: 'c', personaId: null, nombre: 'DIAZ Carla', pais: 'ITA', celdas: [v(5), d(1), null], victorias: 1, asaltos: 2, tocados: 6, recibidos: 7 },
  ],
};

describe('poule en móvil: se gira en su sitio', () => {
  it('el puesto sigue cociente de victorias, índice y tocados dados, y comparte los empates', () => {
    expect(puestosPoule(poule.filas)).toEqual([2, 1, 3]);
    const empate = { victorias: 2, asaltos: 3, tocados: 10, recibidos: 8 };
    expect(puestosPoule([empate, { ...empate }, { victorias: 3, asaltos: 3, tocados: 15, recibidos: 2 }])).toEqual([2, 2, 1]);
  });

  it('girada, la matriz pinta V5 / D3 con V al final y resalta fila y columna de la persona', () => {
    const marcado = html(
      React.createElement(PoulesDePrueba, {
        poules: [poule],
        enlace: (id: string) => `/explorar/${id}`,
        filtro: { consulta: '', persona: UUID_B },
        caraInicial: 'asaltos',
      }),
    );
    expect(marcado).toMatch(/victoria <\/span><span aria-hidden="true">V<\/span>5/);
    expect(marcado).toMatch(/derrota <\/span><span aria-hidden="true">D<\/span>3/);
    expect(marcado).toMatch(/derrota <\/span><span aria-hidden="true">D<\/span>1/);
    // Una sola tarjeta resaltada; su fila y la cabecera de su columna, marcadas.
    expect(marcado.match(/data-resaltado="true"/g)).toHaveLength(1);
    expect(marcado.match(/<li class="[^"]*bg-marcado/g)).toHaveLength(1);
    expect(marcado).toMatch(/<span class="[^"]*font-semibold text-primary-text">2<\/span>/);
    // Nada se desplaza: ni tabla con columnas fijas ni contenedor con scroll.
    expect(marcado).not.toContain('sticky');
    expect(marcado).not.toContain('overflow-auto');
    expect(marcado).not.toContain('overflow-x');
    expect(marcado).toContain(`href="/explorar/${UUID_A}"`);
    expect(marcado).toContain('>Ruiz B.<');
  });

  it('cada poule se gira tocando su cabecera: un botón real, sin hoja ni historial', () => {
    const marcado = html(React.createElement(PoulesDePrueba, { poules: [poule], filtro: { consulta: '' } }));
    expect(marcado).toMatch(/<h3 id="poule-P1-titulo"[^>]*><button type="button" aria-expanded="false" aria-controls="poule-P1-cuerpo"/);
    expect(marcado).toContain('Ver asaltos');
    expect(marcado).not.toContain('Hoja');
    expect(marcado).not.toContain('aria-haspopup');
    expect(marcado).toContain('data-cara="resumen"');
    expect(marcado).toContain('id="poule-P1-cuerpo"');
    expect(marcado).toMatch(/<ol class="divide-y" aria-label="Poule 1">/);
    // Resumen: puesto, V, TD, TR e índice; las casillas no están montadas.
    expect(marcado).toContain('<span class="sr-only">Puesto </span>2');
    expect(marcado).toContain('>+1<');
    expect(marcado).not.toContain('contra el');
    const girada = html(React.createElement(PoulesDePrueba, { poules: [poule], caraInicial: 'asaltos' }));
    expect(girada).toContain('aria-expanded="true"');
    expect(girada).toContain('Ver resumen');
  });
});

/* ------------------------------------------------------------- cara a cara */

const personas = {
  yo: { id: UUID_A, nombre: 'ZABALA Juan', pais: 'ESP' },
  rival: { id: UUID_B, nombre: 'RAMIREZ LARENA Alejandro', pais: 'ESP' },
};

const encuentro = (extra: Partial<EncuentroCaraACara>): EncuentroCaraACara => ({
  pruebaId: 'c1',
  edicionId: 'ed1',
  torneo: 'CAMPEONATO DE ESPAÑA SUB23',
  fecha: '2023-04-16',
  ciudad: null,
  pais: 'ESP',
  arma: 'ESPADA',
  genero: 'M',
  categoria: 'M23',
  categoriaRaw: null,
  formato: 'INDIVIDUAL',
  temporada: '2022-2023',
  fuente: 'rfee_pdf',
  clasificacion: { tipo: 'CTO_ESPANA', etiqueta: 'Cto. España', corta: 'Cto. España', tono: 'org-rfee' } as never,
  puestos: { yo: 1, rival: 2, yoPublicado: null, rivalPublicado: null },
  delante: 'yo',
  asaltos: { total: 2, poule: { victorias: 0, derrotas: 1 }, directa: { victorias: 1, derrotas: 0 } },
  marcadores: [
    { fase: 'POULE', ronda: 'P2', mios: 3, rival: 5 },
    { fase: 'TABLEAU', ronda: 'A2', mios: 15, rival: 11 },
  ],
  equivalentes: [],
  ...extra,
});

const encuentros = [
  encuentro({ pruebaId: 'c2', edicionId: 'ed2', torneo: 'TNR ABS (3/3)', fecha: '2024-03-03', categoria: 'ABS', marcadores: [{ fase: 'TABLEAU', ronda: 'A32', mios: 15, rival: 13 }] }),
  encuentro({ pruebaId: 'c3', edicionId: 'ed3', torneo: 'TNR SENIOR', fecha: '2023-10-01', marcadores: [] }),
  encuentro({}),
];

const datos = (extra: Partial<DatosCaraACara> = {}): DatosCaraACara => ({
  estado: 'ok',
  personas,
  resumen: { asaltos: 3, victorias: 2, derrotas: 1, sinDecidir: 0, tantosFavor: 33, tantosContra: 29 },
  cobertura: {
    estado: 'verificado', exhaustivo: false, pruebasComunes: 3, pruebasConAsaltos: 2,
    pruebasSinAsaltosPublicados: 0, pruebasSinVerificar: 0, pendientes: [], pendientesTruncado: false,
  },
  items: [],
  siguiente: null,
  encuentros,
  resumenEncuentros: {
    competiciones: 3, conAmbosPuestos: 3, delanteYo: 3, delanteRival: 0, empates: 0,
    poule: { victorias: 0, derrotas: 1 }, directa: { victorias: 2, derrotas: 0 }, ultimo: null, truncado: false,
  },
  ...extra,
});

const criterios = { ...CRITERIOS_CARA_A_CARA_VACIOS, rival: UUID_B };

describe('cara a cara: asaltos directos antes que los cruces', () => {
  it('lista cada asalto del más reciente al más antiguo; dentro de una prueba, la final antes que la poule', () => {
    expect(asaltosDirectos(encuentros).map((a) => `${a.encuentro.pruebaId}:${a.marcador.ronda}`)).toEqual([
      'c2:A32',
      'c1:A2',
      'c1:P2',
    ]);
  });

  it('cada fila enlaza la prueba en la persona, con la ronda en palabras y el ganador marcado', () => {
    const marcado = html(React.createElement(AsaltosCaraACara, { datos: datos(), encuentros }));
    expect(marcado).toMatch(/<h2 id="h2h-asaltos"[^>]*>Asaltos <span[^>]*>3<\/span><\/h2>/);
    expect(marcado).toContain(`href="/explorar/ediciones/ed2?prueba=c2&amp;persona=${UUID_A}"`);
    expect(marcado).toContain(`href="/explorar/ediciones/ed1?prueba=c1&amp;persona=${UUID_A}"`);
    expect(marcado).toContain('>Tablón de 32<');
    expect(marcado).toContain('>Final<');
    expect(marcado).toContain('>Poule<');
    expect(marcado).not.toMatch(/>A32<|>P2<|>A2</);
    expect(marcado).toContain('Juan Zabala 15, Alejandro Ramirez Larena 13. gana Juan Zabala');
    expect(marcado).toContain('gana Alejandro Ramirez Larena');
    expect(marcado.match(/bg-ok/g)).toHaveLength(2);
    expect(marcado.match(/bg-danger/g)).toHaveLength(1);
    expect(marcado).toContain('M23');
    // Fecha en `BloqueFecha` (día y mes) y el año como cabecera de grupo, nunca «05/10/26».
    expect(marcado).toContain('data-slot="sistema-bloque-fecha"');
    expect(marcado).toMatch(/<h3[^>]*>20\d\d<\/h3>/);
    expect(marcado).not.toMatch(/\b\d{2}\/\d{2}\/\d{2}\b/);
  });

  it('va antes que los cruces y desaparece sin asaltos', () => {
    const completo = html(React.createElement(CaraACaraCompleto, { datos: datos(), criterios }));
    expect(completo.indexOf('h2h-asaltos')).toBeGreaterThan(-1);
    expect(completo.indexOf('h2h-asaltos')).toBeLessThan(completo.indexOf('h2h-cruces'));
    const sin = encuentros.map((e) => ({ ...e, marcadores: [] }));
    expect(html(React.createElement(AsaltosCaraACara, { datos: datos(), encuentros: sin }))).toBe('');
  });

  it('el retrato de la cabecera enlaza la ficha sin añadir una parada de tabulador', () => {
    const marcado = html(React.createElement(CabeceraCaraACara, { datos: datos(), criterios }));
    for (const id of [UUID_A, UUID_B]) {
      expect(marcado).toContain(`<a tabindex="-1" aria-hidden="true" class="block rounded-full" href="/explorar/${id}"`);
      expect(marcado.match(new RegExp(`href="/explorar/${id}"`, 'g'))).toHaveLength(2);
    }
  });
});

describe('lista de rivales: barra de victorias y derrotas', () => {
  it('la barra parte en verde y rojo y se lee en palabras', () => {
    const marcado = html(React.createElement(BarraVictorias, { victorias: 8, derrotas: 4 }));
    expect(marcado).toContain('role="img" aria-label="8 victorias y 4 derrotas"');
    expect(marcado).toContain('bg-ok');
    expect(marcado).toContain('bg-danger');
    expect(marcado).toContain('width:66.66');
    expect(html(React.createElement(BarraVictorias, { victorias: 1, derrotas: 0 }))).toContain('1 victoria y 0 derrotas');
  });

  it('los rivales confirmados enseñan su balance en vez de «N asaltos importados»', () => {
    const marcado = html(
      React.createElement(ElegirRival, {
        persona: personas.yo,
        rivales: {
          tipo: 'ok',
          items: [{ id: UUID_C, nombre: 'Marta Ruiz', pais: 'FRA', asaltos: 3, victorias: 2, derrotas: 1 }],
          siguiente: null,
          sinResultados: false,
        },
        otros: null,
        criterios: CRITERIOS_CARA_A_CARA_VACIOS,
      }),
    );
    expect(marcado).toContain('aria-label="2 victorias y 1 derrota"');
    expect(marcado).not.toContain('asaltos importados');
  });
});

describe('nombres cortos de competición en filas estrechas', () => {
  it('acorta sólo el nombre del evento, al principio', async () => {
    const { nombrePruebaCorto } = await import('@/lib/sport/explorar/presentacion');
    const corto = (nombre: string, fuente = 'rfee_pdf') => nombrePruebaCorto({ nombre, fuente, formato: 'INDIVIDUAL' });
    expect(corto('CAMPEONATO DE ESPAÑA ABSOLUTO')).toBe('Cto. España Absoluto');
    expect(corto('Campeonatos de España Sub23 2020')).toBe('Cto. España Sub23 2020');
    expect(corto('TORNEO NACIONAL DE RANKING SENIOR')).toBe('TNR Senior');
    expect(corto("Championnats d'Europe", 'fie')).toBe('Europeo');
    expect(corto('Championnats du Monde Vétérans', 'fie')).toBe('Mundial de Veteranos');
    expect(corto('Coupe du Monde par équipes', 'fie')).toBe('Copa del Mundo');
    expect(corto('Trofeo del Campeonato del Mundo')).toBe('Trofeo del Campeonato del Mundo');
  });

  it('las filas de asaltos y cruces enseñan la forma corta y guardan la entera en title y para el lector', () => {
    const espana = [encuentro({ torneo: 'CAMPEONATO DE ESPAÑA ABSOLUTO' })];
    const marcado = html(React.createElement(CaraACaraCompleto, { datos: datos({ encuentros: espana }), criterios }));
    expect(marcado).toContain('title="Campeonato de España Absoluto">Cto. España Absoluto<');
    expect(marcado.match(/>Cto\. España Absoluto</g)).toHaveLength(3);
    // La frase entera va en sr-only, no en un aria-label que tape lo visible.
    expect(marcado).toMatch(/<span class="sr-only">[^<]*Campeonato de España Absoluto/);
  });
});

/* ----------------------------------------------------------------- gráficas */

const prueba = (i: number, yo: number, rival: number): PruebaCompartida => ({
  pruebaId: `p${i}`,
  edicionId: `e${i}`,
  fecha: `20${10 + i}-03-01`,
  temporada: `20${10 + i}`,
  torneo: `TNR ${i}`,
  tipo: 'TNR' as never,
  tono: 'org-rfee',
  ambito: 'nacional',
  categoria: 'ABS',
  puestoYo: yo,
  puestoRival: rival,
  participantes: 64,
  delante: yo < rival ? 'yo' : yo > rival ? 'rival' : 'empate',
});

describe('puestos comparados: 1º arriba, media móvil, podios y resumen', () => {
  it('resume quién acaba por delante en una línea', () => {
    const pruebas = [prueba(1, 1, 8), prueba(2, 3, 2), prueba(3, 5, 9), prueba(4, 16, 4), prueba(5, 2, 12)];
    expect(resumenDelante(pruebas, 'Zabala', 'Ramírez')).toEqual({ quien: 'yo', texto: 'Zabala por delante en el 60 % (3 de 5)' });
    expect(resumenDelante([prueba(1, 1, 2), prueba(2, 2, 1)], 'Zabala', 'Ramírez')?.texto).toBe('Empate: 1 y 1 de 2');
    expect(resumenDelante([], 'a', 'b')).toBeNull();
  });

  it('la escala pone el 1º arriba y rotula puestos redondos sin pisarse', () => {
    const y = escalaPuesto(64);
    expect(y(1)).toBe(0);
    expect(y(64)).toBeCloseTo(100);
    expect(y(8)).toBeLessThan(y(16));
    expect(marcasPuesto(64)).toEqual([1, 3, 8, 16, 32, 64]);
    expect(mediaMovil([1, 2, 3, 4], 1)).toEqual([1.5, 2, 3, 3.5]);
  });

  it('pinta el resumen, la media móvil de cada una y el aro de podio', () => {
    const pruebas = [prueba(1, 1, 8), prueba(2, 3, 2), prueba(3, 5, 9), prueba(4, 16, 4), prueba(5, 2, 12)];
    const marcado = html(React.createElement(PuestosComparados, { pruebas, yo: 'Zabala', rival: 'Ramírez', titulo: 'Puestos' }));
    expect(marcado).toContain('Zabala por delante en el 60 % (3 de 5)');
    expect(marcado).toContain('>1º<');
    expect(marcado).toContain('Media móvil');
    expect(marcado).toContain('Podio');
    expect(marcado.match(/<path /g)).toHaveLength(2);
    expect(marcado).toContain('#D4A017');
  });

  it('el perfil resume su tendencia frente a la de hace un año', () => {
    expect(resumenTendencia([0.5, 0.4, 0.2], [0, 200, 400])).toEqual({ valor: 0.2, sentido: 'mejora' });
    expect(resumenTendencia([0.2, 0.21], [0, 400])).toEqual({ valor: 0.21, sentido: 'estable' });
    expect(resumenTendencia([0.2, 0.4], [0, 400])).toEqual({ valor: 0.4, sentido: 'baja' });
    expect(resumenTendencia([0.3], [10])).toEqual({ valor: 0.3, sentido: null });
  });
});
