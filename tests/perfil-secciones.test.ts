import * as React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FilasRanking } from '@/components/explorar/ficha-deportiva';
import { BarrasTipo, type FilaDesglose } from '@/components/explorar/graficos/barras-tipo';
import { PestanasPerfil } from '@/components/explorar/perfil/pestanas-perfil';
import { pastillaMotivo, textoMotivo } from '@/components/explorar/perfil/sugeridos-perfil';
import { rutaCuriosidades, rutaSeccionPerfil, SECCIONES_PERFIL, seccionDeSegmento } from '@/lib/sport/explorar/perfil-secciones';
import { aRendimiento, type FilaPruebaRendimiento } from '@/lib/sport/explorar/rendimiento';
import type { TiradorSugerido } from '@/lib/sport/explorar/tipos-perfil';

const P = '00000000-0000-4000-8000-000000000001';
const html = (e: React.ReactElement) => renderToStaticMarkup(e);

describe('secciones del perfil en la URL', () => {
  it('Resultados es la raíz, cada sección su propio segmento y Curiosidades vive en Estadísticas', () => {
    expect(SECCIONES_PERFIL.map((s) => s.rotulo)).toEqual(['Resultados', 'Estadísticas', 'Rivales', 'Ranking']);
    expect(rutaSeccionPerfil(P, 'resultados')).toBe(`/explorar/${P}`);
    expect(rutaSeccionPerfil(P, 'estadisticas')).toBe(`/explorar/${P}/estadisticas`);
    expect(rutaCuriosidades(P)).toBe(`/explorar/${P}/estadisticas#curiosidades`);
    expect(seccionDeSegmento(null)).toBe('resultados');
    expect(seccionDeSegmento('rivales')).toBe('rivales');
    expect(seccionDeSegmento('curiosidades')).toBe('estadisticas');
    expect(seccionDeSegmento('cara-a-cara')).toBe('resultados');
  });

  it('las pestañas llevan rótulo, sustituyen la entrada del historial y no saltan arriba', () => {
    const salida = html(React.createElement(PestanasPerfil, { personaId: P, secciones: ['resultados', 'estadisticas', 'rivales', 'ranking'], activa: 'estadisticas' }));
    expect(salida.match(/<a /g)).toHaveLength(4);
    expect(salida).toContain('data-variante="subrayado"');
    for (const r of ['Resultados', 'Estadísticas', 'Rivales', 'Ranking']) expect(salida).toContain(`>${r}</span>`);
    expect(salida).not.toContain('sr-only sm:not-sr-only');
    expect(salida).not.toContain('Curiosidades');
    expect(salida).toMatch(new RegExp(`<a(?=[^>]*href="/explorar/${P}/estadisticas")(?=[^>]*aria-current="page")`));
    expect(salida.match(/aria-current="page"/g)).toHaveLength(1);
    const codigo = readFileSync('src/components/explorar/perfil/pestanas-perfil.tsx', 'utf8');
    // `replace`: cuatro pestañas tocadas no son cuatro Atrás; `scroll={false}`: Next no salta al principio.
    expect(codigo).toMatch(/<SelectorSegmentado[\s\S]*\breplace\b[\s\S]*scroll=\{false\}/);
    expect(codigo).toContain('DESPLAZAMIENTO');
  });

  it('cada sección es una ruta propia que lee sólo lo suyo; la ficha entera ya no pinta todas', () => {
    const base = 'src/app/(app)/explorar/[personaId]/(perfil)';
    expect(readFileSync(`${base}/rivales/page.tsx`, 'utf8')).not.toMatch(/fichaPerfil|cargarRendimiento/);
    expect(readFileSync(`${base}/page.tsx`, 'utf8')).not.toMatch(/cargarDiferidosPerfil|cargarRendimiento/);
    expect(readFileSync(`${base}/layout.tsx`, 'utf8')).not.toMatch(/cargarDiferidosPerfil|Rendimiento/);
    // Estadísticas lee rendimiento y curiosidades a la vez.
    expect(readFileSync(`${base}/estadisticas/page.tsx`, 'utf8')).toMatch(/Promise\.all\(\[\s*cargarRendimientoCompartido[\s\S]*cargarCuriosidadesCompartidas/);
  });

  it('la ruta antigua de Curiosidades redirige al bloque de Estadísticas, tras la guarda de sesión', () => {
    const fuente = readFileSync('src/app/(app)/explorar/[personaId]/(perfil)/curiosidades/page.tsx', 'utf8');
    expect(fuente).toContain('redirect(rutaCuriosidades(personaId))');
    expect(fuente.indexOf('await exigirSesion()')).toBeLessThan(fuente.indexOf('redirect('));
    expect(fuente).not.toMatch(/cargar\w+Compartid/);
  });
});

describe('ranking de la cabecera con PastillaRanking', () => {
  it('«FIE #25» y «RFEE #3», sin «Intl.»/«Nac.» ni rótulos repetidos', () => {
    const salida = html(React.createElement(FilasRanking, {
      chips: [
        { ambito: 'internacional', organismo: 'FIE', puesto: 25, arma: 'FLORETE', categoria: 'ABS', temporada: '2026', actual: true },
        { ambito: 'nacional', organismo: 'RFEE', puesto: 3, arma: 'FLORETE', categoria: 'M20', temporada: '2025-2026', actual: true },
      ],
    }));
    expect(salida).toMatch(/^<ul aria-label="Ranking"/);
    expect(salida.match(/data-slot="sistema-pastilla-ranking"/g)).toHaveLength(2);
    expect(salida).toContain('>FIE #25<');
    expect(salida).toContain('>RFEE #3<');
    expect(salida).not.toMatch(/Intl\.|Nac\.|>Internacional<|>Nacional</);
    // Sólo se escribe lo que añade: la categoría que no es Absoluto; «Florete» solo, no.
    expect(salida).toContain('>M20<');
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
