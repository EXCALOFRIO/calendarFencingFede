import * as React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FilasRanking } from '@/components/explorar/ficha-deportiva';
import { BarrasTipo, type FilaDesglose } from '@/components/explorar/graficos/barras-tipo';
import { PestanasPerfil } from '@/components/explorar/perfil/pestanas-perfil';
import { pastillaMotivo, textoMotivo } from '@/components/explorar/perfil/sugeridos-perfil';
import { rutaSeccionPerfil, seccionDeSegmento } from '@/lib/sport/explorar/perfil-secciones';
import { aRendimiento, type FilaPruebaRendimiento } from '@/lib/sport/explorar/rendimiento';
import type { TiradorSugerido } from '@/lib/sport/explorar/tipos-perfil';

const P = '00000000-0000-4000-8000-000000000001';
const html = (e: React.ReactElement) => renderToStaticMarkup(e);

describe('secciones del perfil en la URL', () => {
  it('Resultados es la raíz y cada sección su propio segmento', () => {
    expect(rutaSeccionPerfil(P, 'resultados')).toBe(`/explorar/${P}`);
    expect(rutaSeccionPerfil(P, 'estadisticas')).toBe(`/explorar/${P}/estadisticas`);
    expect(rutaSeccionPerfil(P, 'curiosidades')).toBe(`/explorar/${P}/curiosidades`);
    expect(seccionDeSegmento(null)).toBe('resultados');
    expect(seccionDeSegmento('rivales')).toBe('rivales');
    expect(seccionDeSegmento('cara-a-cara')).toBe('resultados');
  });

  it('las pestañas son enlaces con icono, la activa marcada y sin prefetch', () => {
    const salida = html(React.createElement(PestanasPerfil, { personaId: P, secciones: ['resultados', 'estadisticas', 'rivales'], activa: 'estadisticas' }));
    expect(salida.match(/<a /g)).toHaveLength(3);
    expect(salida).toContain(`href="/explorar/${P}/estadisticas"`);
    expect(salida).toMatch(/aria-current="page"[^>]*data-seccion="estadisticas"/);
    // Icono de 20 px y pestaña de 44 en px: la raíz de 18 px del móvil no los agranda.
    expect(salida).toContain('size-[20px]');
    expect(salida).toContain('h-[44px]');
    expect(salida).not.toContain('Ranking');
    // Rótulo visible desde `sm`; en móvil queda para lectores de pantalla.
    expect(salida).toContain('sr-only sm:not-sr-only');
  });

  it('cada sección es una ruta propia que lee sólo lo suyo; la ficha entera ya no pinta todas', () => {
    const base = 'src/app/(app)/explorar/[personaId]/(perfil)';
    expect(readFileSync(`${base}/rivales/page.tsx`, 'utf8')).not.toMatch(/fichaPerfil|cargarRendimiento/);
    expect(readFileSync(`${base}/curiosidades/page.tsx`, 'utf8')).not.toMatch(/fichaPerfil|cargarRivales/);
    expect(readFileSync(`${base}/page.tsx`, 'utf8')).not.toMatch(/cargarDiferidosPerfil|cargarRendimiento/);
    expect(readFileSync(`${base}/layout.tsx`, 'utf8')).not.toMatch(/cargarDiferidosPerfil|Rendimiento/);
  });
});

describe('ranking de la cabecera en una línea, fuera de la caja', () => {
  it('«Internacional 25º · Nacional 3º» sin borde ni rejilla', () => {
    const salida = html(React.createElement(FilasRanking, {
      chips: [
        { ambito: 'internacional', organismo: 'FIE', puesto: 25, arma: 'FLORETE', categoria: 'ABS', temporada: '2026', actual: true },
        { ambito: 'nacional', organismo: 'RFEE', puesto: 3, arma: 'FLORETE', categoria: 'ABS', temporada: '2025-2026', actual: true },
      ],
    }));
    expect(salida).toMatch(/^<ul aria-label="Ranking"/);
    expect(salida).not.toMatch(/border|rounded|grid/);
    expect(salida).toContain('Internacional');
    expect(salida).toContain('25º');
    expect(salida).toContain('3º');
    expect(salida).toContain('·');
    // «Florete» solo no añade nada.
    expect(salida).not.toContain('>Florete<');
  });
});

describe('sin clubes en el perfil', () => {
  const s = (o: Partial<TiradorSugerido>): TiradorSugerido => ({
    id: P, nombre: 'RUIZ Marta', pais: 'ESP', club: 'CLUB X', motivo: 'mismo_club',
    asaltos: 0, victorias: 0, derrotas: 0, pruebas: 4, ...o,
  } as TiradorSugerido);

  it('un sugerido por club se explica por lo que comparten en pista', () => {
    expect(textoMotivo(s({}))).toBe('Coinciden en 4 pruebas');
    expect(pastillaMotivo(s({ asaltos: 3, victorias: 2, derrotas: 1 }))).toBe('Rival · 2–1');
    expect(textoMotivo(s({}))).not.toMatch(/club/i);
  });

  it('la cabecera no lee ni pinta el club', () => {
    const ficha = readFileSync('src/components/explorar/ficha-deportiva.tsx', 'utf8');
    const cabecera = ficha.slice(ficha.indexOf('export function CabeceraFicha'), ficha.indexOf('/* ------------------------------------------------------------- ranking oficial'));
    expect(cabecera).not.toMatch(/\.club\b/);
    expect(readFileSync('src/lib/sport/explorar/perfil-datos.ts', 'utf8')).not.toContain('sqlClubesRecientes(');
  });
});

describe('desglose por categoría', () => {
  const fila = (o: Partial<FilaPruebaRendimiento>): FilaPruebaRendimiento => ({
    pruebaId: `p-${Math.random()}`, fuente: 'fie', torneo: 'Coupe du Monde', categoria: 'ABS', pais: 'FRA',
    ambitoEvento: null, circuitoEvento: null, fuenteEvento: null, puesto: 5,
    asaltos: 0, victorias: 0, derrotas: 0, dados: 0, recibidos: 0,
    pouleA: 0, pouleV: 0, pouleD: 0, pouleDados: 0, pouleRecibidos: 0,
    directaA: 0, directaV: 0, directaD: 0, directaDados: 0, directaRecibidos: 0,
    participantes: 120, arma: 'FLORETE', genero: 'M', temporada: '2025', fecha: '2025-01-10', fechaOrden: '2025-01-10',
    ...o,
  } as FilaPruebaRendimiento);

  it('una categoría sin puesto ni asaltos no sale; con una sola, sí', () => {
    const r = aRendimiento([
      fila({ categoria: 'M20', puesto: 3 }),
      fila({ categoria: 'VET', puesto: null, fecha: '2024-01-01', fechaOrden: '2024-01-01' }),
    ]);
    expect(r.vistas.todo.porCategoria.map((c) => c.clave)).toEqual(['M20']);
    const codigo = readFileSync('src/components/explorar/graficos/seccion-rendimiento.tsx', 'utf8');
    expect(codigo).toContain('categorias.length > 0');
  });

  it('la fila no pinta poule, directa ni «ganados» sin asaltos de esa fase', () => {
    const base = aRendimiento([fila({ asaltos: 6, victorias: 4, derrotas: 2, pouleA: 6, pouleV: 4, pouleD: 2 })]).vistas.todo.porCategoria[0];
    const conPoule = html(React.createElement(BarrasTipo, { filas: [base as FilaDesglose], titulo: 'x' }));
    expect(conPoule).toContain('Poule');
    expect(conPoule).not.toContain('Directa');
    expect(conPoule).toContain('ganados');
    const sinAsaltos = aRendimiento([fila({})]).vistas.todo.porCategoria[0];
    const vacia = html(React.createElement(BarrasTipo, { filas: [sinAsaltos as FilaDesglose], titulo: 'x' }));
    expect(vacia).toContain('Mejor');
    expect(vacia).not.toMatch(/Poule|Directa|ganados|–/);
  });
});
