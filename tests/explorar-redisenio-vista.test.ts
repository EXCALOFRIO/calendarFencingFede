import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CRITERIOS_CARA_A_CARA_VACIOS } from '@/lib/sport/explorar/cara-a-cara-url';
import { CRITERIOS_CATALOGO_VACIOS } from '@/lib/sport/explorar/catalogo-url';

vi.mock('next/navigation', () => ({
  usePathname: () => '/explorar/ediciones',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
import type { DatosCaraACara } from '@/lib/sport/explorar/cara-a-cara-pantalla';
import type { AsaltosDePrueba } from '@/lib/sport/explorar/tipos-busqueda';
import { CRITERIOS_VACIOS } from '@/lib/sport/explorar/url';
import { UUID_A, UUID_B } from './helpers/explorar';

const { ListaDeportistas } = await import('@/components/explorar/resultados');
const { ClasificacionDePrueba, EdicionCompleta, FilaEdicion } = await import('@/components/explorar/ediciones');
const { CatalogoEdiciones } = await import('@/components/explorar/catalogo-ediciones');
const { CabeceraCaraACara } = await import('@/components/explorar/cara-a-cara');

const html = (nodo: React.ReactElement) => renderToStaticMarkup(nodo);
const ED = '0000000a-0000-4000-8000-000000000001';
const PRUEBA = '0000000b-0000-4000-8000-000000000001';

const resumenEdicion = (extra: Record<string, unknown> = {}) => ({
  id: ED,
  nombre: 'Copa del Mundo de Paris',
  temporada: '2026',
  fuente: 'fie',
  ciudad: 'Paris',
  pais: 'FRA',
  inicio: '2026-01-10',
  fin: '2026-01-12',
  pruebas: 2,
  armas: ['ESPADA' as const],
  formatos: ['INDIVIDUAL' as const],
  serie: null,
  ...extra,
});

const prueba = {
  id: PRUEBA,
  arma: 'ESPADA' as const,
  genero: 'F' as const,
  categoria: { codigo: 'ABS', raw: 'Senior' },
  formato: 'INDIVIDUAL' as const,
  fecha: '2026-01-10',
  fuente: 'fie',
  pruebaCalendarioId: null,
  resultados: { estado: 'completo' as const, importados: 4 },
  enlaces: [],
};

const fila = (id: string, puesto: number | null, nombre: string, personaId: string | null = null) => ({
  id, puesto, puestoPublicado: null, nombre, pais: 'ESP', club: 'Club Sintético', personaId,
});

const clasificacion = {
  pruebaId: PRUEBA,
  fuente: 'fie',
  siguiente: null,
  otrasFuentes: [],
  filas: [fila('r1', 1, 'GARCIA PEREZ Lucia', UUID_A), fila('r2', 2, 'Ana Ruiz'), fila('r3', 3, 'Bea Sol'), fila('r4', 5, 'Eva Mar')],
};

describe('resultados de búsqueda agrupados por persona', () => {
  it('una línea por persona: iniciales, nombre legible, medallas con su metal y un solo dato corto', () => {
    const marcado = html(React.createElement(ListaDeportistas, {
      items: [{
        id: UUID_A, nombre: 'GARCIA PEREZ Lucia', alias: null, pais: 'ESP', genero: 'F', anioNacimiento: 2001,
        resultadosImportados: 7, armas: ['ESPADA', 'SABLE'], mismoNombre: 1,
        trayectoria: {
          ultima: { edicionId: ED, torneo: 'GRAND PRIX DE PARIS', fecha: '2026-03-02' },
          mejorPuesto: 1, oros: 2, platas: 0, bronces: 1,
        },
      }],
      siguiente: null,
      cursorActual: undefined,
      criterios: { ...CRITERIOS_VACIOS, q: 'garcia' },
    }));
    expect(marcado).toContain('>LG<');
    expect(marcado).toContain('Lucia Garcia Perez');
    // Con dos armas, el dato corto es el número de pruebas.
    expect(marcado).toContain('7 pruebas');
    expect(marcado).toContain('> oros<');
    expect(marcado).toContain('> bronce<');
    expect(marcado).not.toMatch(/plata/i);
    expect(marcado).not.toContain('Última competición');
    expect(marcado).not.toContain('Mejor resultado');
    expect(marcado).not.toMatch(/ranking oficial|puntos/i);
  });

  it('sin trayectoria no inventa medallas ni actividad', () => {
    const marcado = html(React.createElement(ListaDeportistas, {
      items: [{
        id: UUID_A, nombre: 'Ana Perez', alias: null, pais: null, genero: null, anioNacimiento: null,
        resultadosImportados: 0, armas: [], mismoNombre: 1,
      }],
      siguiente: null,
      cursorActual: undefined,
      criterios: { ...CRITERIOS_VACIOS, q: 'perez' },
    }));
    expect(marcado).toContain('Ana Perez');
    expect(marcado).not.toMatch(/> (oros?|platas?|bronces?)</);
    expect(marcado).not.toMatch(/\d+ pruebas?/);
  });
});

describe('clasificación, poules y cuadro de una edición', () => {
  it('el podio lleva el metal escrito y el resto de puestos no', () => {
    const marcado = html(React.createElement(ClasificacionDePrueba, {
      edicion: resumenEdicion(),
      prueba,
      clasificacion: clasificacion as never,
      criterios: { prueba: PRUEBA, cursor: '' },
    }));
    for (const metal of ['Oro', 'Plata', 'Bronce']) expect(marcado).toContain(`>${metal}, puesto <`);
    expect(marcado.match(/>Bronce, puesto </g)).toHaveLength(1);
    expect(marcado).toContain('bg-amber-100');
    expect(marcado).toContain('Lucia Garcia Perez');
    // En Explorar no se enseñan clubes.
    expect(marcado).not.toContain('Club Sintético');
    // El enlace se nombra por lo que enseña (WCAG 2.5.3).
    expect(marcado).not.toContain('aria-label="Abrir la ficha deportiva de');
  });

  const asaltos: AsaltosDePrueba = {
    fuente: 'fie',
    truncado: false,
    poules: [{
      ronda: 'P1',
      etiqueta: 'Poule 1',
      filas: [
        { clave: 'P1-0', personaId: UUID_A, nombre: 'ANA', pais: 'ESP', celdas: [null, { tantos: 5, victoria: true }], victorias: 1, asaltos: 1, tocados: 5, recibidos: 2 },
        { clave: 'P1-1', personaId: null, nombre: 'BEA', pais: 'FRA', celdas: [{ tantos: 2, victoria: false }, null], victorias: 0, asaltos: 1, tocados: 2, recibidos: 5 },
      ],
    }],
    cuadro: [{
      ronda: 'A2',
      etiqueta: 'Final',
      tamano: 2,
      asaltos: [{
        id: 'b1', ronda: 'A2',
        a: { personaId: UUID_A, nombre: 'ANA', pais: 'ESP', tantos: 15 },
        b: { personaId: UUID_B, nombre: 'BEA', pais: 'FRA', tantos: 11 },
      }],
    }],
  };
  const completa = (extra: Record<string, unknown>) => html(React.createElement(EdicionCompleta, {
    edicion: {
      ...resumenEdicion(),
      pruebasDetalle: [prueba],
      pruebaDesconocida: false,
      clasificacion: clasificacion as never,
      ...extra,
    },
    criterios: { prueba: PRUEBA, cursor: '' },
  }));

  const pestanaActiva = (marcado: string, etiqueta: string) =>
    new RegExp(`<button[^>]*aria-current="true"[^>]*>(?:(?!</button>).)*${etiqueta}`).test(marcado);
  const pestanaApagada = (marcado: string, etiqueta: string) =>
    new RegExp(`<button[^>]*disabled=""[^>]*>(?:(?!</button>).)*${etiqueta}`).test(marcado);

  it('con asaltos importados ofrece clasificación, poules y directas, y abre en la clasificación', () => {
    const marcado = completa({ asaltos });
    // Botones con aria-current, no pestañas ARIA a medias.
    expect(marcado).toContain('role="group" aria-label="Vista"');
    expect(marcado).not.toContain('role="tab"');
    expect(pestanaActiva(marcado, 'Clasificación')).toBe(true);
    expect(pestanaApagada(marcado, 'Poules')).toBe(false);
    expect(pestanaApagada(marcado, 'Directas')).toBe(false);
    expect(marcado).toContain('role="search"');
  });

  it('sin asaltos no se ofrecen poules ni directas, y un fallo de asaltos no oculta la clasificación', () => {
    const sin = completa({ asaltos: null });
    expect(pestanaApagada(sin, 'Poules')).toBe(false);
    expect(sin).not.toContain('role="tab"');
    expect(sin).not.toContain('>Directas<');
    const conError = completa({ asaltos: 'error' });
    expect(conError).not.toContain('role="tab"');
    expect(conError).toMatch(/no se han podido leer/i);
    expect(conError).toContain('Lucia Garcia Perez');
  });

  it('las poules y el cuadro se pueden leer por separado y enlazan sólo a fichas vinculadas', async () => {
    const { PoulesDePrueba, CuadroDePrueba } = await import('@/components/explorar/asaltos-prueba');
    const enlace = (id: string) => `/explorar/${id}?volver=%2Fexplorar%2Fediciones`;
    const poules = html(React.createElement(PoulesDePrueba, { poules: asaltos.poules, enlace, caraInicial: 'asaltos' }));
    expect(poules).toMatch(/<span aria-hidden="true">V<\/span>5/);
    expect(poules).toContain(`href="/explorar/${UUID_A}?volver=%2Fexplorar%2Fediciones"`);
    // Una sola estructura: cada ficha se enlaza una vez.
    expect(poules.match(/<a /g)).toHaveLength(1);
    const cuadro = html(React.createElement(CuadroDePrueba, { cuadro: asaltos.cuadro, enlace }));
    expect(cuadro).toContain('Final');
    expect(cuadro).toContain('ganó con');
    // Las dos fichas y, con las dos vinculadas, los tantos abren su cara a cara.
    expect(cuadro.match(/<a (?![^>]*data-enlace)/g)).toHaveLength(2);
    expect(cuadro).toContain(`href="/explorar/${UUID_A}/cara-a-cara?rival=${UUID_B}"`);
    expect(cuadro.match(/data-enlace="cara-a-cara"/g)).toHaveLength(1);
    expect(html(React.createElement(PoulesDePrueba, { poules: [] }))).toContain('Sin poules.');
  });
});

describe('catálogo de ediciones', () => {
  it('la fila de un evento: fecha en bloque, nombre, bandera sola, año, armas y pastilla de tipo, sin fuente ni recuentos', () => {
    const fie = html(React.createElement(FilaEdicion, { e: { ...resumenEdicion(), clasificados: 312 } }));
    expect(fie).toContain('data-slot="sistema-bloque-fecha"');
    expect(fie).toContain('dateTime="2026-01-10"');
    expect(fie).toContain('Copa del Mundo de Paris');
    expect(fie).toContain('/banderas/fr.png');
    expect(fie).toContain('>2026 · Espada<');
    expect(fie).not.toMatch(/>FRA<\/abbr>/);
    expect(fie).toContain('data-tipo=');
    expect(fie).not.toMatch(/312|clasificados|>FIE</);
    const evento = html(React.createElement(FilaEdicion, {
      e: { ...resumenEdicion(), armas: ['ESPADA', 'FLORETE', 'SABLE'], formatos: ['EQUIPOS', 'INDIVIDUAL'], ediciones: 12 },
    }));
    expect(evento).toContain('>2026 · 3 armas · Equipos<');
    expect(evento.match(/<li>/g)).toHaveLength(1);
  });

  it('los filtros viven en una hoja «Filtros (N)»; los puestos son chips que se quitan, y siguen viajando por GET', () => {
    const marcado = html(React.createElement(CatalogoEdiciones, {
      criterios: { ...CRITERIOS_CATALOGO_VACIOS, fuente: 'rfee_pdf', genero: 'F' },
      vista: { estado: 'ok', total: 0, pruebas: 0, siguiente: null, ediciones: [] },
    }));
    expect(marcado).toContain('type="hidden" name="fuente" value="rfee_pdf"');
    expect(marcado).toContain('type="hidden" name="genero" value="F"');
    expect(marcado).toMatch(/data-slot="sistema-chip"[^>]*data-tipo="menu"[^>]*data-marcado="true"[^>]*>(?:<[^>]+>)*Filtros/);
    expect(marcado).toMatch(/<span class="cifra[^"]*">2<\/span>/);
    expect(marcado).toContain('aria-label="Quitar Nacional (PDF)"');
    expect(marcado).toContain('aria-label="Quitar Femenino"');
    expect(marcado).not.toContain('<select');
    expect(marcado).not.toContain('<option');
    expect(marcado).not.toContain('uppercase');
    const todas = html(React.createElement(CatalogoEdiciones, {
      criterios: CRITERIOS_CATALOGO_VACIOS,
      vista: { estado: 'ok', total: 0, pruebas: 0, siguiente: null, ediciones: [] },
    }));
    expect(todas).not.toContain('name="fuente"');
    expect(todas).not.toContain('data-tipo="quitar"');
    expect(todas).toMatch(/data-tipo="menu"[^>]*>(?:<[^>]+>)*Filtros/);
  });
});

describe('cara a cara', () => {
  const asalto = (id: string, resultado: 'victoria' | 'derrota', mios: number, rival: number, pruebaId = 'c1') => ({
    id,
    marcador: { mios, rival },
    resultado,
    torneo: { id: 'e1', nombre: 'GRAND PRIX DE PARIS' },
    prueba: { id: pruebaId, arma: 'ESPADA' as const, genero: 'F' as const, categoria: { codigo: 'ABS', raw: 'Senior' }, formato: 'INDIVIDUAL' as const },
    temporada: '2026',
    fecha: '2026-03-02',
    fase: 'TABLEAU' as const,
    rondaPublicada: 'A8',
    enlace: null,
  });
  const datos = (extra: Partial<DatosCaraACara> = {}): DatosCaraACara => ({
    estado: 'ok',
    personas: {
      yo: { id: UUID_A, nombre: 'Lucia Garcia', pais: 'ESP' },
      rival: { id: UUID_B, nombre: 'Marta Ruiz', pais: 'FRA' },
    },
    resumen: { asaltos: 3, victorias: 2, derrotas: 1, sinDecidir: 0, tantosFavor: 35, tantosContra: 30 },
    cobertura: {
      estado: 'verificado', exhaustivo: false, pruebasComunes: 2, pruebasConAsaltos: 2,
      pruebasSinAsaltosPublicados: 0, pruebasSinVerificar: 0, pendientes: [], pendientesTruncado: false,
    },
    items: [asalto('b1', 'victoria', 15, 10), asalto('b2', 'derrota', 5, 15), asalto('b3', 'victoria', 15, 5, 'c2')],
    siguiente: null,
    ...extra,
  } as DatosCaraACara);

  it('la cabecera enfrenta a las dos personas con el balance grande y los últimos resultados', () => {
    const marcado = html(React.createElement(CabeceraCaraACara, { datos: datos(), criterios: CRITERIOS_CARA_A_CARA_VACIOS }));
    expect(marcado).toContain('>LG<');
    expect(marcado).toContain('>MR<');
    expect(marcado).toContain('aria-label="2 victorias y 1 derrota de Lucia Garcia"');
    expect(marcado).toContain('aria-label="Últimos asaltos, del más reciente: victoria, derrota, victoria"');
  });

  it('en otra página o sin asaltos no se presentan como últimos ni se pinta un 0–0', () => {
    const pagina = html(React.createElement(CabeceraCaraACara, {
      datos: datos(), criterios: { ...CRITERIOS_CARA_A_CARA_VACIOS, cursor: 'c' },
    }));
    expect(pagina).not.toContain('del más reciente:');
    const vacio = html(React.createElement(CabeceraCaraACara, {
      datos: datos({ resumen: { asaltos: 0, victorias: 0, derrotas: 0, sinDecidir: 0, tantosFavor: 0, tantosContra: 0 }, items: [] }),
      criterios: CRITERIOS_CARA_A_CARA_VACIOS,
    }));
    expect(vacio).toContain('vs');
    expect(vacio).not.toContain('victorias y');
  });
});
