import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  coincideNombre,
  huecosCuadro,
  inicioPorDefecto,
  inicioParaRonda,
  resaltado,
  ultimaRondaResaltada,
  ventanaRondas,
  vistaInicial,
} from '@/components/explorar/prueba/logica';
import {
  agruparPruebas,
  pruebaDeId,
  pruebaPorDefecto,
  selectorDePruebas,
  type PruebaDeEdicion,
} from '@/lib/sport/explorar/edicion-modelo';
import {
  construirUrlEdicion,
  leerCriteriosEdicion,
  sanitizarRetornoEdicion,
} from '@/lib/sport/explorar/edicion-url';
import { etiquetaCortaRonda, ordenarCuadro, partePorFase, rondaCuadro, type FilaAsaltoPrueba } from '@/lib/sport/explorar/ediciones-asaltos';
import { leerEdicion } from '@/lib/sport/explorar/ediciones';
import type { AsaltoDePrueba, RondaCuadro } from '@/lib/sport/explorar/tipos-busqueda';
import { nombreCompacto } from '@/lib/sport/nombre-visible';
import { UUID_A, UUID_B, UUID_C, crearContexto } from './helpers/explorar';

const { CuadroDePrueba, PoulesDePrueba } = await import('@/components/explorar/asaltos-prueba');
const { VistaPrueba } = await import('@/components/explorar/prueba/vista-prueba');
const { EdicionCompleta } = await import('@/components/explorar/ediciones');

/**
 * Página de una prueba: lógica pura del cuadro y del buscador, agrupación de
 * pruebas publicadas por partes, selector y parámetros de la dirección.
 */

const html = (nodo: React.ReactElement) => renderToStaticMarkup(nodo);

const tirador = (nombre: string, tantos: number, personaId: string | null = null) => ({ personaId, nombre, pais: null, tantos });
const asalto = (id: string, a: [string, number], b: [string, number], ronda = 'A2'): AsaltoDePrueba => ({
  id,
  ronda,
  a: tirador(a[0], a[1]),
  b: tirador(b[0], b[1]),
});
const ronda = (clave: string, tamano: number, asaltos: AsaltoDePrueba[], etiqueta = `Tablón de ${tamano}`): RondaCuadro => ({
  ronda: clave,
  etiqueta,
  tamano,
  asaltos,
});

describe('ventana de rondas del cuadro', () => {
  it('enseña tres rondas seguidas y nunca pasa de la final', () => {
    expect(ventanaRondas(6, 0, 3)).toEqual({ desde: 0, hasta: 3, puedeAtras: false, puedeAdelante: true });
    expect(ventanaRondas(6, 3, 3)).toEqual({ desde: 3, hasta: 6, puedeAtras: true, puedeAdelante: false });
    for (const inicio of [4, 5, 99, Number.POSITIVE_INFINITY]) {
      const v = ventanaRondas(6, inicio, 3);
      expect(v.hasta).toBe(6);
      expect(v.puedeAdelante).toBe(false);
    }
  });

  it('no baja de la primera ronda y con menos rondas que columnas las ve todas', () => {
    expect(ventanaRondas(6, -4, 3).desde).toBe(0);
    expect(ventanaRondas(2, 0, 3)).toEqual({ desde: 0, hasta: 2, puedeAtras: false, puedeAdelante: false });
    expect(ventanaRondas(0, 0, 3)).toEqual({ desde: 0, hasta: 0, puedeAtras: false, puedeAdelante: false });
  });

  it('en móvil, con dos columnas, la última ventana es semifinal y final', () => {
    const v = ventanaRondas(5, 10, 2);
    expect([v.desde, v.hasta, v.puedeAdelante]).toEqual([3, 5, false]);
  });

  it('abre en el cuadro principal y deja el previo de la FIE a la izquierda', () => {
    const rondas = [
      ronda('A128', 128, [], 'Previa · Tablón de 128'),
      ronda('A64', 64, [], 'Previa · Tablón de 64'),
      ronda('B64', 64, []),
      ronda('B32', 32, []),
    ];
    expect(inicioPorDefecto(rondas)).toBe(2);
    expect(inicioPorDefecto([ronda('A8', 8, [])])).toBe(0);
    expect(inicioParaRonda(0)).toBe(0);
    expect(inicioParaRonda(4)).toBe(3);
  });
});

describe('casillas del cuadro', () => {
  it('cada tirador ocupa la casilla del asalto que ganó, y el exento deja un hueco', () => {
    const final = ronda('A2', 2, [asalto('f', ['ANA', 15], ['BEA', 10])]);
    const semis = ronda('A4', 4, [asalto('s2', ['BEA', 15], ['CRIS', 3]), asalto('s1', ['ANA', 15], ['DORA', 5])]);
    const cuartos = ronda('A8', 8, [
      asalto('c1', ['ANA', 15], ['EVA', 1]),
      asalto('c2', ['DORA', 15], ['FE', 2]),
      asalto('c3', ['BEA', 15], ['GEMA', 4]),
    ]);
    const huecos = huecosCuadro([cuartos, semis, final]);
    expect(huecos[2].map((a) => a?.id)).toEqual(['f']);
    expect(huecos[1].map((a) => a?.id)).toEqual(['s1', 's2']);
    // CRIS no tiró cuartos: su casilla queda vacía y el cuadro sigue alineado.
    expect(huecos[0].map((a) => a?.id ?? null)).toEqual(['c1', 'c2', 'c3', null]);
  });

  it('si una ronda no encaja con la siguiente se pinta tal cual, sin huecos inventados', () => {
    const huecos = huecosCuadro([
      ronda('A4', 4, [asalto('x', ['X', 15], ['Y', 1])]),
      ronda('A2', 2, [asalto('f', ['ANA', 15], ['BEA', 10])]),
    ]);
    expect(huecos[0].map((a) => a?.id)).toEqual(['x']);
  });
});

describe('buscador de la prueba', () => {
  it('encuentra sin tildes ni orden y por principio de palabra', () => {
    expect(coincideNombre('PÉREZ GARCÍA Lucía', 'lucia perez')).toBe(true);
    expect(coincideNombre('PÉREZ GARCÍA Lucía', 'garc')).toBe(true);
    expect(coincideNombre('PÉREZ GARCÍA Lucía', 'arcia')).toBe(false);
    expect(coincideNombre('Ana', '   ')).toBe(false);
  });

  it('sin texto resalta a la persona de la dirección; con texto, a quien coincide', () => {
    const t = { personaId: UUID_A, nombre: 'KANO Koki' };
    expect(resaltado(t, { consulta: '', persona: UUID_A })).toBe(true);
    expect(resaltado(t, { consulta: '', persona: UUID_B })).toBe(false);
    expect(resaltado(t, { consulta: 'kano', persona: UUID_B })).toBe(true);
    expect(resaltado(t, { consulta: 'zz', persona: UUID_A })).toBe(false);
  });

  it('la ronda más avanzada del tirador buscado mueve la ventana', () => {
    const rondas = [
      ronda('A8', 8, [asalto('c1', ['ANA', 15], ['EVA', 1])]),
      ronda('A4', 4, [asalto('s1', ['ANA', 15], ['DORA', 5])]),
      ronda('A2', 2, [asalto('f', ['ANA', 9], ['BEA', 15])]),
    ];
    expect(ultimaRondaResaltada(rondas, { consulta: 'dora' })).toBe(1);
    expect(ultimaRondaResaltada(rondas, { consulta: 'ana' })).toBe(2);
    expect(ultimaRondaResaltada(rondas, { consulta: '' })).toBe(-1);
  });

  it('la vista pedida sólo vale si tiene datos', () => {
    const todas = { clasificacion: true, poules: true, directas: true };
    expect(vistaInicial('directas', todas)).toBe('directas');
    expect(vistaInicial('poules', { ...todas, poules: false })).toBe('clasificacion');
    expect(vistaInicial(undefined, { clasificacion: false, poules: true, directas: true })).toBe('directas');
  });

  it('el nombre del cuadro es el compacto común: primer apellido e inicial cuando la fuente los separa', () => {
    expect(nombreCompacto('KANO Koki')).toBe('Kano K.');
    expect(nombreCompacto('ZABALA GUTIERREZ Juan')).toBe('Zabala J.');
    expect(nombreCompacto('JUAN PEREZ GARCIA')).toBe('Juan Perez Garcia');
  });
});

describe('rondas de la FIE con cuadro previo y principal', () => {
  const fila = (id: string, clave: string, a: string, b: string, ta: number, tb: number): FilaAsaltoPrueba => ({
    id, fuente: 'fie', fase: 'TABLEAU', ronda: clave, refA: a, refB: b, personaA: null, personaB: null,
    nombreA: a, nombreB: b, tantosA: ta, tantosB: tb, paisA: null, paisB: null,
  });

  it('B… es el cuadro principal y A… su previa, en ese orden hacia la final', () => {
    expect(rondaCuadro('B16')).toEqual({ tamano: 16, etiqueta: 'Tablón de 16' });
    const cuadro = ordenarCuadro([
      fila('1', 'A4', 'X', 'Y', 15, 3),
      fila('2', 'B4', 'X', 'Z', 15, 9),
      fila('3', 'B2', 'X', 'W', 15, 14),
    ]);
    expect(cuadro.map((r) => r.ronda)).toEqual(['A4', 'B4', 'B2']);
    expect(cuadro[0].etiqueta).toBe('Previa · Semifinales');
    expect(cuadro.map((r) => etiquetaCortaRonda(r))).toEqual(['Previa · Semifinales', 'Semifinal', 'Final']);
  });

  it('rótulos cortos de columna', () => {
    expect([64, 16, 8, 4, 2].map((n) => etiquetaCortaRonda({ tamano: n, etiqueta: `Tablón de ${n}` }))).toEqual([
      'Tablón de 64',
      'Octavos',
      'Cuartos',
      'Semifinal',
      'Final',
    ]);
  });
});

const prueba = (id: string, extra: Partial<PruebaDeEdicion> = {}): PruebaDeEdicion => ({
  id,
  arma: 'ESPADA',
  genero: 'M',
  categoria: { codigo: 'ABS', raw: 'ABS' },
  formato: 'INDIVIDUAL',
  fecha: '2026-02-21',
  fuente: 'rfee_pdf',
  pruebaCalendarioId: null,
  resultados: { estado: 'completo', importados: 0 },
  enlaces: [],
  asaltos: 0,
  ...extra,
});
const ID = (n: number) => `0000000b-0000-4000-8000-00000000000${n}`;

describe('pruebas publicadas por partes', () => {
  it('une las partes sin puestos a la única con puestos y suma sus asaltos', () => {
    const grupos = agruparPruebas([
      prueba(ID(1), { asaltos: 300 }),
      prueba(ID(2), { resultados: { estado: 'completo', importados: 12 }, asaltos: 400 }),
      prueba(ID(3), { asaltos: 69 }),
      prueba(ID(4), { fecha: '2026-02-22', resultados: { estado: 'completo', importados: 5 } }),
    ]);
    expect(grupos.map((g) => g.id)).toEqual([ID(2), ID(4)]);
    expect(grupos[0].miembros).toEqual([ID(2), ID(1), ID(3)]);
    expect(grupos[0].asaltos).toBe(769);
    expect(pruebaDeId(grupos, ID(3))?.id).toBe(ID(2));
    expect(pruebaDeId(grupos, UUID_C)).toBeUndefined();
  });

  it('dos con puestos son pruebas distintas (grupos por año) y no se tocan', () => {
    const grupos = agruparPruebas([
      prueba(ID(1), { resultados: { estado: 'completo', importados: 20 } }),
      prueba(ID(2), { resultados: { estado: 'completo', importados: 21 } }),
      prueba(ID(3)),
    ]);
    expect(grupos.map((g) => g.id)).toEqual([ID(1), ID(2), ID(3)]);
  });

  it('sin puestos manda la de más asaltos, y la prueba por defecto es la primera con puestos', () => {
    const grupos = agruparPruebas([prueba(ID(1), { asaltos: 2 }), prueba(ID(2), { asaltos: 50 })]);
    expect(grupos.map((g) => g.id)).toEqual([ID(2)]);
    expect(pruebaPorDefecto([prueba(ID(1)), prueba(ID(2), { resultados: { estado: 'parcial', importados: 3 } })])?.id).toBe(ID(2));
    expect(pruebaPorDefecto([prueba(ID(1)), prueba(ID(2), { asaltos: 3 })])?.id).toBe(ID(2));
  });

  it('cada fase sale de la parte con más asaltos de esa fase; a igualdad, la que da los puestos', () => {
    const partes = partePorFase([ID(2), ID(1), ID(3)], [
      { prueba: ID(2), fase: 'POULE', n: 336 },
      { prueba: ID(2), fase: 'TABLEAU', n: 69 },
      { prueba: ID(1), fase: 'POULE', n: 380 },
      { prueba: ID(3), fase: 'TABLEAU', n: 69 },
    ]);
    expect(Object.fromEntries(partes)).toEqual({ POULE: ID(1), TABLEAU: ID(2) });
  });

  it('leerEdicion abre la prueba agrupada aunque se pida una de sus partes', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: [
        { cuando: /WHERE e\.id = /, filas: [{ id: UUID_A, nombre: 'TNR', temporada: '2026', fuente: 'rfee_pdf', ciudad: null, pais: null, inicio: null, fin: null, pruebas: 2, armas: 'ESPADA', formatos: 'INDIVIDUAL' }] },
        {
          cuando: /c\.format AS formato/,
          filas: [ID(1), ID(2)].map((id, i) => ({
            id, edicionId: UUID_A, arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaRaw: 'ABS', formato: 'INDIVIDUAL',
            fecha: '2026-02-21', fuente: 'rfee_pdf', pruebaCalendarioId: null, importados: i === 0 ? 12 : 0, asaltos: i === 0 ? 10 : 380,
          })),
        },
        { cuando: /GROUP BY r\.source/, filas: [{ fuente: 'rfee_pdf', n: 12 }] },
      ],
    });
    const r = await leerEdicion(ctx, { edicionId: UUID_A, prueba: ID(2) });
    if (r.estado !== 'ok') throw new Error('se esperaba ok');
    expect(r.edicion.pruebasDetalle.map((p) => p.id)).toEqual([ID(1)]);
    expect(r.edicion.pruebaElegida).toBe(ID(1));
    expect(r.edicion.pruebaDesconocida).toBe(false);
    expect(sentencias.some((s) => /GROUP BY b\.competition_id, b\.phase/.test(s.text))).toBe(true);
  });

  it('sin pedir prueba se abre la primera con puestos', async () => {
    const { ctx } = crearContexto({
      respuestas: [
        { cuando: /WHERE e\.id = /, filas: [{ id: UUID_A, nombre: 'Copa', temporada: '2026', fuente: 'fie', ciudad: null, pais: null, inicio: null, fin: null, pruebas: 2, armas: 'ESPADA', formatos: 'INDIVIDUAL,EQUIPOS' }] },
        {
          cuando: /c\.format AS formato/,
          filas: [
            { id: ID(1), edicionId: UUID_A, arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaRaw: 'S', formato: 'EQUIPOS', fecha: null, fuente: 'fie', pruebaCalendarioId: null, importados: 0, asaltos: 0 },
            { id: ID(2), edicionId: UUID_A, arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaRaw: 'S', formato: 'INDIVIDUAL', fecha: null, fuente: 'fie', pruebaCalendarioId: null, importados: 3, asaltos: 0 },
          ],
        },
      ],
    });
    const r = await leerEdicion(ctx, { edicionId: UUID_A });
    if (r.estado !== 'ok') throw new Error('se esperaba ok');
    expect(r.edicion.pruebaElegida).toBe(ID(2));
  });
});

describe('selector de pruebas', () => {
  const pruebas = [
    prueba(ID(1)),
    prueba(ID(2), { formato: 'EQUIPOS' }),
    prueba(ID(3), { arma: 'FLORETE' }),
    prueba(ID(4), { arma: 'FLORETE', genero: 'F' }),
  ];

  it('una fila por dimensión que cambia y cada botón lleva a una prueba real lo más parecida', () => {
    const filas = selectorDePruebas(pruebas, pruebas[0]);
    expect(filas.map((f) => f.dimension)).toEqual(['formato', 'arma', 'genero']);
    const [formato, arma, genero] = filas;
    expect(formato.opciones.map((o) => [o.valor, o.pruebaId, o.activa])).toEqual([
      ['INDIVIDUAL', ID(1), true],
      ['EQUIPOS', ID(2), false],
    ]);
    expect(arma.opciones.find((o) => o.valor === 'FLORETE')?.pruebaId).toBe(ID(3));
    expect(genero.opciones.find((o) => o.valor === 'F')?.pruebaId).toBe(ID(4));
  });

  it('con una sola prueba no hay nada que elegir; gemelas de distinto día salen como variante', () => {
    expect(selectorDePruebas([pruebas[0]], pruebas[0])).toEqual([]);
    const gemela = prueba(ID(5), { fecha: '2026-02-22' });
    const filas = selectorDePruebas([pruebas[0], gemela], gemela);
    expect(filas).toHaveLength(1);
    expect(filas[0].dimension).toBe('variante');
    expect(filas[0].opciones.map((o) => o.activa)).toEqual([false, true]);
  });
});

describe('dirección de la prueba', () => {
  it('prueba, persona y vista viajan y se leen de vuelta; la clasificación es la vista por defecto', () => {
    const url = construirUrlEdicion(UUID_A, { prueba: UUID_B, persona: UUID_C, vista: 'directas' });
    expect(url).toBe(`/explorar/ediciones/${UUID_A}?prueba=${UUID_B}&vista=directas&persona=${UUID_C}`);
    const leido = leerCriteriosEdicion(Object.fromEntries(new URL(url, 'http://x').searchParams));
    expect(leido).toEqual({ prueba: UUID_B, cursor: '', persona: UUID_C, vista: 'directas' });
    expect(construirUrlEdicion(UUID_A, { prueba: UUID_B, vista: 'clasificacion' })).toBe(`/explorar/ediciones/${UUID_A}?prueba=${UUID_B}`);
    expect(sanitizarRetornoEdicion(url)).toBe(url);
  });

  it('una persona o una vista que no se entienden se descartan', () => {
    expect(leerCriteriosEdicion({ persona: 'x; DROP', vista: 'tablas' })).toEqual({ prueba: '', cursor: '' });
    expect(construirUrlEdicion(UUID_A, { persona: 'no-es-id' })).toBe(`/explorar/ediciones/${UUID_A}`);
  });
});

describe('vistas de la prueba en pantalla', () => {
  const cuadro: RondaCuadro[] = [
    ronda('A8', 8, [asalto('c1', ['ANA', 15], ['EVA', 1], 'A8'), asalto('c2', ['DORA', 15], ['FE', 2], 'A8')]),
    ronda('A4', 4, [asalto('s1', ['ANA', 15], ['DORA', 5], 'A4')], 'Semifinales'),
    ronda('A2', 2, [asalto('f', ['ANA', 15], ['BEA', 10], 'A2')], 'Final'),
    { ronda: 'C2', etiqueta: 'Tercer puesto', tamano: null, asaltos: [asalto('t', ['DORA', 15], ['GEMA', 3], 'C2')] },
  ];

  it('el cuadro abre con tres rondas en escritorio y dos en móvil, y la flecha atrás empieza desactivada', () => {
    const marcado = html(React.createElement(CuadroDePrueba, { cuadro }));
    expect(marcado).toMatch(/disabled="" aria-label="Ronda anterior"/);
    expect(marcado).toContain('Cuartos');
    expect(marcado).toContain('Semifinal');
    expect(marcado).toContain('Tercer puesto');
    expect(marcado).toContain('ganó con');
    // Final: oculta en móvil (dos columnas), visible desde sm.
    const final = marcado.match(/<h3(?:(?!<\/h3>).)*>Final<\/span><\/h3>/)?.[0];
    expect(final).toMatch(/class="[^"]*\bhidden\b[^"]*sm:block/);
  });

  it('con la final a la vista no se puede avanzar', () => {
    const marcado = html(React.createElement(CuadroDePrueba, { cuadro, inicio: 9 }));
    expect(marcado.match(/disabled="" aria-label="Ronda siguiente"/g)).toHaveLength(2);
  });

  it('las poules enlazan sólo a fichas vinculadas y resaltan la poule de la persona', () => {
    const poules = [{
      ronda: 'P1',
      etiqueta: 'Poule 1',
      filas: [
        { clave: 'P1-0', personaId: UUID_A, nombre: 'ANA', pais: 'ESP', celdas: [null, { tantos: 5, victoria: true }], victorias: 1, asaltos: 1, tocados: 5, recibidos: 2 },
        { clave: 'P1-1', personaId: null, nombre: 'BEA', pais: 'FRA', celdas: [{ tantos: 2, victoria: false }, null], victorias: 0, asaltos: 1, tocados: 2, recibidos: 5 },
      ],
    }];
    const marcado = html(React.createElement(PoulesDePrueba, {
      poules, enlace: (id: string) => `/explorar/${id}`, filtro: { consulta: '', persona: UUID_A },
    }));
    expect(marcado).toContain('<caption');
    expect(marcado).toContain('>V5<');
    expect(marcado).toContain('data-resaltado="true"');
    // Dos enlaces a la misma ficha: la lista de móvil y la matriz de escritorio.
    expect(marcado.match(/<a /g)).toHaveLength(2);
    expect(marcado).toContain(`href="/explorar/${UUID_A}"`);
  });

  it('VistaPrueba abre la vista pedida, resalta a la persona y su enlace vuelve con ella', () => {
    const base = { prueba: UUID_B, cursor: '' };
    const marcado = html(React.createElement(VistaPrueba, {
      edicionId: UUID_A,
      base,
      persona: UUID_C,
      vista: 'clasificacion',
      clasificacion: [
        { id: 'r1', puesto: 1, puestoPublicado: null, nombre: 'Ana Vinculada', pais: 'ESP', club: null, personaId: UUID_C },
        { id: 'r2', puesto: 4, puestoPublicado: null, nombre: 'Bea Suelta', pais: 'ESP', club: null, personaId: null },
      ],
      asaltos: null,
    }));
    // Sin poules ni directas no hay pestañas que elegir: ni deshabilitadas ni la tira.
    expect(marcado).not.toContain('role="tab"');
    expect(marcado).not.toContain('disabled=""');
    expect(marcado).toContain('data-resaltado="true"');
    const volver = construirUrlEdicion(UUID_A, { prueba: UUID_B, persona: UUID_C });
    expect(marcado).toContain(`href="/explorar/${UUID_C}?volver=${encodeURIComponent(volver).replace(/&/g, '&amp;')}"`);
    expect(marcado).toContain('Oro, puesto');
    expect(marcado.match(/<a (?![^>]*data-enlace)/g)).toHaveLength(1);
  });

  it('la página no repite textos de estado ni enlaces de búsqueda, y la categoría nunca sale en bruto', () => {
    const p = prueba(UUID_B, { categoria: { codigo: 'ABS', raw: 'S' }, resultados: { estado: 'completo', importados: 1 }, fuente: 'fie' });
    const marcado = html(React.createElement(EdicionCompleta, {
      edicion: {
        id: UUID_A, nombre: 'Coupe du Monde par équipes', temporada: '2026', fuente: 'fie', ciudad: 'Paris', pais: 'FR',
        inicio: '2026-01-10', fin: '2026-01-12', pruebas: 2, armas: ['ESPADA'], formatos: ['INDIVIDUAL', 'EQUIPOS'], serie: null,
        pruebasDetalle: [p, prueba(UUID_C, { formato: 'EQUIPOS', fuente: 'fie' })],
        pruebaDesconocida: false,
        pruebaElegida: UUID_B,
        clasificacion: { pruebaId: UUID_B, fuente: 'fie', siguiente: null, otrasFuentes: [], filas: [
          { id: 'r1', puesto: 1, puestoPublicado: null, nombre: 'KANO Koki', pais: 'JP', club: null, personaId: null },
        ] },
        asaltos: null,
      },
      criterios: { prueba: '', cursor: '' },
    }));
    expect(marcado).toContain('>Copa del Mundo<');
    expect(marcado).toContain('>Espada masculina<');
    expect(marcado).toContain('>Absoluto<');
    expect(marcado).not.toMatch(/Volver a/);
    // La única mención de la FIE es la insignia del organizador, no la fuente.
    expect(marcado.match(/>FIE</g)).toHaveLength(1);
    expect(marcado).not.toMatch(/· S ·/);
    expect(marcado).toContain('>Individual<');
    expect(marcado).toContain(`href="${construirUrlEdicion(UUID_A, { prueba: UUID_C })}"`);
    for (const ruido of ['La fuente se leyó entera', 'Sin enlaces de resultados', 'Buscar en Explorar', 'Ver la clasificación']) {
      expect(marcado).not.toContain(ruido);
    }
    expect(marcado).toContain('Koki Kano');
  });
});
