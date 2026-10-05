import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CRITERIOS_CARA_A_CARA_VACIOS } from '@/lib/sport/explorar/cara-a-cara-url';
import type { DatosCaraACara } from '@/lib/sport/explorar/cara-a-cara-pantalla';
import type { AsaltosDePrueba } from '@/lib/sport/explorar/tipos-busqueda';
import { CRITERIOS_VACIOS } from '@/lib/sport/explorar/url';
import { UUID_A, UUID_B, UUID_C } from './helpers/explorar';

const { ListaDeportistas } = await import('@/components/explorar/resultados');
const { ClasificacionDePrueba, EdicionCompleta, FilaEdicion } = await import('@/components/explorar/ediciones');
const { CatalogoEdiciones } = await import('@/components/explorar/catalogo-ediciones');
const { AsaltosCaraACara, CabeceraCaraACara } = await import('@/components/explorar/cara-a-cara');

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
  it('muestra iniciales, nombre legible, armas, última competición y medallas con texto', () => {
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
    expect(marcado).toContain('Espada');
    expect(marcado).toContain('Sable');
    expect(marcado).toContain('Última competición');
    expect(marcado).toContain('Grand Prix de Paris');
    expect(marcado).toContain('Mejor resultado');
    expect(marcado).toContain('Oros');
    expect(marcado).toContain('Bronce');
    expect(marcado).not.toContain('Plata');
    // Sin ranking oficial ni puntos en la fila.
    expect(marcado).not.toMatch(/ranking oficial|puntos/i);
  });

  it('sin trayectoria no inventa última competición ni medallas', () => {
    const marcado = html(React.createElement(ListaDeportistas, {
      items: [{
        id: UUID_A, nombre: 'Ana Perez', alias: null, pais: null, genero: null, anioNacimiento: null,
        resultadosImportados: 0, armas: [], mismoNombre: 1,
      }],
      siguiente: null,
      cursorActual: undefined,
      criterios: { ...CRITERIOS_VACIOS, q: 'perez' },
    }));
    expect(marcado).not.toContain('Última competición');
    expect(marcado).not.toContain('Mejor resultado');
    expect(marcado).toContain('Ninguno importado');
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
    for (const metal of ['Oro', 'Plata', 'Bronce']) expect(marcado).toContain(`>${metal}<`);
    expect(marcado.match(/>Bronce</g)).toHaveLength(1);
    expect(marcado).toContain('Lucia Garcia Perez');
    expect(marcado).toContain('Club Sintético');
    expect(marcado).toContain('aria-label="Abrir la ficha deportiva de Lucia Garcia Perez"');
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

  it('con asaltos importados ofrece pestañas de clasificación, poules y cuadro', () => {
    const marcado = completa({ asaltos });
    expect(marcado).toContain('role="tablist"');
    expect(marcado).toMatch(/role="tab"[^>]*>.*Clasificación/);
    expect(marcado).toContain('Poules');
    expect(marcado).toContain('Cuadro');
  });

  it('sin asaltos no hay pestañas vacías, y un fallo de asaltos no oculta la clasificación', () => {
    expect(completa({ asaltos: null })).not.toContain('role="tablist"');
    const conError = completa({ asaltos: 'error' });
    expect(conError).not.toContain('role="tablist"');
    expect(conError).toContain('no se han podido leer');
    expect(conError).toContain('Lucia Garcia Perez');
  });

  it('las poules y el cuadro se pueden leer por separado y enlazan sólo a fichas vinculadas', async () => {
    const { PoulesDePrueba, CuadroDePrueba } = await import('@/components/explorar/asaltos-prueba');
    const poules = html(React.createElement(PoulesDePrueba, { poules: asaltos.poules, volver: '/explorar/ediciones' }));
    expect(poules).toContain('<caption');
    expect(poules).toContain('>V5<');
    expect(poules).toContain(`href="/explorar/${UUID_A}?volver=%2Fexplorar%2Fediciones"`);
    expect(poules.match(/<a /g)).toHaveLength(1);
    const cuadro = html(React.createElement(CuadroDePrueba, { cuadro: asaltos.cuadro, volver: '/x' }));
    expect(cuadro).toContain('Final');
    expect(cuadro).toContain('ganó con');
    expect(cuadro.match(/<a /g)).toHaveLength(2);
    expect(html(React.createElement(PoulesDePrueba, { poules: [], volver: '/x' }))).toContain('No significa que no se hayan disputado');
  });
});

describe('catálogo de ediciones', () => {
  it('la fila lleva la insignia del organismo, sede con bandera y el número de clasificados', () => {
    const fie = html(React.createElement(FilaEdicion, { e: { ...resumenEdicion(), clasificados: 312 } }));
    expect(fie).toContain('bg-org-fie-tinte');
    expect(fie).toContain('312');
    expect(fie).toContain('clasificados');
    expect(fie).toContain('Paris');
    const rfee = html(React.createElement(FilaEdicion, { e: resumenEdicion({ fuente: 'rfee_pdf' }) }));
    expect(rfee).toContain('bg-org-rfee-tinte');
    expect(rfee).not.toContain('clasificados');
  });

  it('el selector de fuente es el de la interfaz y sigue enviando «fuente» por GET', () => {
    const marcado = html(React.createElement(CatalogoEdiciones, {
      criterios: { q: '', fuente: 'rfee_pdf', temporada: '' },
      vista: { estado: 'ok', total: 0, pruebas: 0, siguiente: null, ediciones: [] },
    }));
    expect(marcado).toContain('id="catalogo-fuente"');
    expect(marcado).toContain('type="hidden" name="fuente" value="rfee_pdf"');
    expect(marcado).not.toContain('<option');
    expect(marcado).not.toContain('uppercase');
    const todas = html(React.createElement(CatalogoEdiciones, {
      criterios: { q: '', fuente: '', temporada: '' },
      vista: { estado: 'ok', total: 0, pruebas: 0, siguiente: null, ediciones: [] },
    }));
    expect(todas).toContain('type="hidden" name="fuente" value=""');
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
    expect(marcado).toContain('2 victorias y 1 derrota de Lucia Garcia');
    expect(marcado).toContain('Últimos asaltos');
    expect(marcado.match(/class="sr-only">Victoria</g)).toHaveLength(2);
    expect(marcado.match(/class="sr-only">Derrota</g)).toHaveLength(1);
  });

  it('en otra página o sin asaltos no se presentan como últimos ni se pinta un 0–0', () => {
    const pagina = html(React.createElement(CabeceraCaraACara, {
      datos: datos(), criterios: { ...CRITERIOS_CARA_A_CARA_VACIOS, cursor: 'c' },
    }));
    expect(pagina).not.toContain('Últimos asaltos');
    const vacio = html(React.createElement(CabeceraCaraACara, {
      datos: datos({ resumen: { asaltos: 0, victorias: 0, derrotas: 0, sinDecidir: 0, tantosFavor: 0, tantosContra: 0 }, items: [] }),
      criterios: CRITERIOS_CARA_A_CARA_VACIOS,
    }));
    expect(vacio).toContain('vs');
    expect(vacio).not.toContain('victorias y');
  });

  it('los asaltos se agrupan por prueba sin perder el orden ni el marcador visto desde la persona', () => {
    const marcado = html(React.createElement(AsaltosCaraACara, {
      datos: datos(), criterios: { ...CRITERIOS_CARA_A_CARA_VACIOS, rival: UUID_B },
    }));
    expect(marcado.match(/Grand Prix de Paris/g)).toHaveLength(2);
    expect(marcado).toContain('2 asaltos en esta prueba: 1 ganado por Lucia Garcia');
    expect(marcado).toContain('Cuartos de final');
    expect(marcado.indexOf('>15</span><span')).toBeLessThan(marcado.indexOf('>5</span><span'));
    expect(marcado).not.toContain(UUID_C);
  });
});
