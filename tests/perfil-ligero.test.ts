import * as React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CaraACaraHoja } from '@/components/explorar/perfil/elegir-rival-hoja';
import { RivalesPorAmbitoVista } from '@/components/explorar/perfil/rivales-ambito';
import { SeccionEstadisticas } from '@/components/explorar/perfil/secciones-perfil';
import { SeccionRendimiento } from '@/components/explorar/graficos/seccion-rendimiento';
import { aRendimiento, type FilaPruebaRendimiento } from '@/lib/sport/explorar/rendimiento';
import { aRivalesPorAmbito, type FilaRivalAmbito } from '@/lib/sport/explorar/rivales-ambito';
import type { EstadisticasRivales } from '@/lib/sport/explorar/tipos-social';

/**
 * El perfil más ligero: un solo panel en el DOM en Estadísticas y Rivales,
 * Curiosidades al final de Estadísticas, filas de persona del sistema y el
 * cara a cara elegido en una hoja.
 */

const P = '00000000-0000-4000-8000-000000000001';
const html = (e: React.ReactElement) => renderToStaticMarkup(e);
const leer = (ruta: string) => readFileSync(ruta, 'utf8');

const fila = (o: Partial<FilaPruebaRendimiento>): FilaPruebaRendimiento => ({
  pruebaId: `p-${Math.random()}`, fuente: 'fie', torneo: 'Coupe du Monde', categoria: 'ABS', pais: 'FRA',
  ambitoEvento: null, circuitoEvento: null, fuenteEvento: null, puesto: 5,
  asaltos: 6, victorias: 4, derrotas: 2, dados: 30, recibidos: 20,
  pouleA: 6, pouleV: 4, pouleD: 2, pouleDados: 30, pouleRecibidos: 20,
  directaA: 0, directaV: 0, directaD: 0, directaDados: 0, directaRecibidos: 0,
  participantes: 120, arma: 'FLORETE', genero: 'M', temporada: '2025', fecha: '2025-01-10', fechaOrden: '2025-01-10',
  ...o,
} as FilaPruebaRendimiento);

const conDosAmbitos = () =>
  aRendimiento([
    fila({}),
    fila({ fuente: 'skermo_rfee', torneo: 'TORNEO NACIONAL MADRID', pais: 'ESP', fecha: '2024-11-10', fechaOrden: '2024-11-10', temporada: '2024-2025' }),
  ]);

const filaRival = (p: Partial<FilaRivalAmbito>): FilaRivalAmbito => ({
  rival: 'r1', nombre: 'RIVAL Uno', pais: 'ESP', prueba: 'p1', asaltos: 1, victorias: 1, derrotas: 0,
  equivalencia: null, fecha: '2025-01-10', arma: 'ESPADA', genero: 'M', categoria: 'ABS', formato: 'INDIVIDUAL',
  fuente: 'skermo_rfee', torneo: 'TORNEO NACIONAL', paisTorneo: 'ESP', ambitoEvento: null, circuitoEvento: null,
  fuenteEvento: null, ...p,
});

describe('un solo panel en el DOM', () => {
  it('Estadísticas: con Todo / Internacional / Nacional sólo se pinta el elegido, sin radios ocultos', () => {
    const r = conDosAmbitos();
    expect(r.vistas.internacional.total.competiciones).toBeGreaterThan(0);
    expect(r.vistas.nacional.total.competiciones).toBeGreaterThan(0);
    const salida = html(React.createElement(SeccionRendimiento, { datos: r, nivel: 'pagina', tituloOculto: true }));
    expect(salida).toContain('role="radiogroup"');
    expect(salida.match(/data-panel="/g)).toHaveLength(1);
    expect(salida).toContain('data-panel="todo"');
    expect(salida).not.toMatch(/type="radio"|group-has-\[/);
    // Los bloques de debajo del pliegue no se maquetan hasta acercarse.
    expect(salida).toContain('[content-visibility:auto]');
  });

  it('Rivales: un panel, filas de persona del sistema que van directas al duelo', () => {
    const datos = aRivalesPorAmbito([
      filaRival({ rival: 'a', nombre: 'A', asaltos: 4, victorias: 3, derrotas: 1 }),
      filaRival({ rival: 'b', nombre: 'B', prueba: 'i', asaltos: 2, victorias: 0, derrotas: 2, fuente: 'fie', torneo: 'Coupe du monde', paisTorneo: 'FRA' }),
    ], new Map(), P);
    const salida = html(React.createElement(RivalesPorAmbitoVista, { personaId: P, datos, nivel: 'pagina' }));
    expect(salida.match(/data-ambito="/g)).toHaveLength(1);
    expect(salida).toContain('data-slot="sistema-fila-persona"');
    expect(salida).toContain(`href="/explorar/${P}/cara-a-cara?rival=a"`);
    expect(salida).not.toMatch(/type="radio"|group-has-\[/);
  });

  it('el cambio de sección ya no fotografía la sección entera con una View Transition', () => {
    const codigo = leer('src/components/explorar/perfil/transicion-seccion.tsx');
    expect(codigo).not.toMatch(/ViewTransition|TransicionContenido/);
    expect(codigo).toContain('sis-aparecer');
  });
});

describe('Curiosidades dentro de Estadísticas', () => {
  const stats = { total: { asaltos: 3 }, curiosidades: [] } as unknown as EstadisticasRivales;

  it('va al final, con su ancla, y no sale sin asaltos', () => {
    const r = conDosAmbitos();
    const con = html(React.createElement(SeccionEstadisticas, { rendimiento: r, personaId: P, curiosidades: { ...stats, poule: { asaltos: 0 }, eliminacion: { asaltos: 0 }, sangreFria: { asaltos: 0, victorias: 0, porcentaje: null } } as never }));
    expect(con).toContain('id="curiosidades"');
    expect(con.indexOf('id="curiosidades"')).toBeGreaterThan(con.indexOf('data-panel="todo"'));
    const sin = html(React.createElement(SeccionEstadisticas, { rendimiento: r, personaId: P, curiosidades: { ...stats, total: { asaltos: 0 } } as never }));
    expect(sin).not.toContain('id="curiosidades"');
    const fallo = html(React.createElement(SeccionEstadisticas, { rendimiento: r, personaId: P, curiosidades: null }));
    expect(fallo).toContain('id="curiosidades"');
    expect(fallo).toContain('role="alert"');
  });
});

describe('cara a cara en una hoja', () => {
  it('«Cara a cara» de la cabecera es un enlace a la página de elegir que abre una hoja', () => {
    const salida = html(React.createElement(CaraACaraHoja, { personaId: P, nombre: 'Lucia Garcia' }));
    expect(salida).toContain(`href="/explorar/${P}/cara-a-cara"`);
    expect(salida).toContain('aria-haspopup="dialog"');
    expect(salida).toContain('>Cara a cara<');
    const icono = html(React.createElement(CaraACaraHoja, { personaId: P, nombre: 'Lucia Garcia', icono: true }));
    expect(icono).toContain('aria-label="Cambiar de rival"');
  });

  it('la cabecera del perfil usa la hoja y el duelo, superficies lisas y piezas del sistema', () => {
    const ficha = leer('src/components/explorar/ficha-deportiva.tsx');
    const cabecera = ficha.slice(ficha.indexOf('export function CabeceraFicha'), ficha.indexOf('/* ------------------------------------------------------------- ranking oficial'));
    expect(cabecera).toContain('<CaraACaraHoja');
    expect(cabecera).not.toMatch(/Intl\.|Nac\./);
    const duelo = leer('src/components/explorar/cara-a-cara.tsx');
    expect(duelo).not.toMatch(/bg-linear|from-marcado|via-card/);
    expect(duelo).toContain("from '@/components/sistema/bloque-fecha'");
    expect(duelo).toContain("from '@/components/sistema/fila-persona'");
    expect(duelo).toContain('rotuloRonda(');
    expect(duelo).not.toMatch(/function FilaPersona|function Aviso|Intl\.DateTimeFormat/);
  });

  it('sin rival, la ruta del cara a cara sigue siendo la página de elegir (enlaces directos)', () => {
    const pagina = leer('src/app/(app)/explorar/[personaId]/cara-a-cara/page.tsx');
    expect(pagina).toContain("vista.tipo === 'elegir'");
    expect(pagina).toContain('<ElegirRival');
  });
});
