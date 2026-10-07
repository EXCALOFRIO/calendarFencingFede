import * as React from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CabeceraFicha } from '@/components/explorar/ficha-deportiva';
import { PestanasPerfil } from '@/components/explorar/perfil/pestanas-perfil';
import { aDatosPersonales, leerDatosPersonales } from '@/lib/sport/explorar/perfil-extra';
import type { FichaConPerfil } from '@/lib/sport/explorar/tipos-perfil';
import { crearContexto, UUID_A, UUID_B } from './helpers/explorar';

const HOY = '2026-10-06';
const fila = (anio: number | null) => ({ nombreCompleto: 'Lucía García Pérez', anio, mano: 'L', altura: 160, clubNombre: null, clubCodigo: null });

/** Lecturas de `perfil_deportista` y de los años del grupo, sin base real. */
function db(anioPerfil: number | null, aniosGrupo: (number | null)[]) {
  return crearContexto({
    respuestas: [
      { cuando: /FROM perfil_deportista/, filas: [fila(anioPerfil)] },
      { cuando: /FROM sport_person/, filas: aniosGrupo.map((anio) => ({ anio })) },
    ],
  }).ctx.db;
}

const ficha = (o: Partial<FichaConPerfil> = {}): FichaConPerfil => ({
  id: UUID_A, nombre: 'GARCIA PEREZ Lucia', alias: [], pais: 'ESP', genero: 'F',
  anioNacimiento: null, esMenor: false, esPropia: false,
  estadisticas: { conjunto: 'clasificaciones_individuales', porTipo: [], detalle: null },
  cobertura: { resultadosImportados: 0, pruebasConResultado: 0, ediciones: 0, lecturas: [], historiaCompleta: false },
  rankingOficial: { temporada: null, formato: 'INDIVIDUAL', temporadasDisponibles: [], entradas: [] },
  perfil: null,
  ...o,
} as unknown as FichaConPerfil);

describe('la edad de un posible menor no sale del servidor', () => {
  it('nacida en 2011 (perfil_deportista): sin edad, con el veto marcado', async () => {
    const datos = await leerDatosPersonales(db(2011, [2011]), UUID_A, HOY, [UUID_A]);
    expect(datos?.edad).toBeNull();
    expect(datos?.edadVetada).toBe(true);
    expect(JSON.stringify(datos)).not.toMatch(/2011|"edad":15/);
  });

  it('sin año en perfil_deportista ni en el grupo: sin edad', async () => {
    const datos = await leerDatosPersonales(db(null, [null, null]), UUID_A, HOY, [UUID_A, UUID_B]);
    expect(datos?.edad ?? null).toBeNull();
  });

  it('un miembro fundido que puede ser menor veta la edad del adulto', async () => {
    const datos = await leerDatosPersonales(db(1990, [1990, 2010]), UUID_A, HOY, [UUID_A, UUID_B]);
    expect(datos?.edad).toBeNull();
    expect(datos?.edadVetada).toBe(true);
  });

  it('un adulto con año conocido conserva su edad', () => {
    expect(aDatosPersonales(fila(1990), HOY, [1990])?.edad).toBe(36);
  });

  it('la cabecera no recupera la edad por el año de la ficha si los datos la vetan', () => {
    const vetados = aDatosPersonales(fila(2011), HOY, [1990])!;
    const ajena = renderToStaticMarkup(React.createElement(CabeceraFicha, { ficha: ficha({ anioNacimiento: 1990 }), datos: vetados }));
    expect(ajena).not.toMatch(/\d+(<!-- -->)? años/);
    // Su propia ficha sí enseña su edad.
    const propia = renderToStaticMarkup(React.createElement(CabeceraFicha, {
      ficha: ficha({ anioNacimiento: 2011, esPropia: true, esMenor: true }), datos: vetados,
    }));
    expect(propia).toMatch(/\d+(<!-- -->)? años/);
  });

  it('la ficha veta el año por todo el grupo, no sólo por la persona superviviente', () => {
    const codigo = readFileSync('src/lib/sport/explorar/ficha.ts', 'utf8');
    expect(codigo).toContain('anioNacimiento: (esMenor || vetarEnlaceFie(anios, ctx.hoy())) && !esPropia ? null');
  });
});

describe('sin esqueletos en el perfil', () => {
  it('ni loading.tsx ni Skeleton ni Suspense con espera visible', () => {
    const base = 'src/app/(app)/explorar/[personaId]';
    expect(existsSync(`${base}/loading.tsx`)).toBe(false);
    expect(existsSync(`${base}/(perfil)/loading.tsx`)).toBe(false);
    for (const f of ['src/components/explorar/perfil/secciones-perfil.tsx', `${base}/(perfil)/layout.tsx`, `${base}/(perfil)/page.tsx`,
      `${base}/(perfil)/estadisticas/page.tsx`, `${base}/(perfil)/rivales/page.tsx`, `${base}/(perfil)/curiosidades/page.tsx`, `${base}/(perfil)/ranking/page.tsx`]) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/Skeleton|Suspense|fallback=/);
    }
  });

  it('las pestañas se precargan sólo con intención y marcan la pulsada al instante', () => {
    const codigo = readFileSync('src/components/explorar/perfil/pestanas-perfil.tsx', 'utf8');
    // Precargar las cuatro secciones al ver el perfil serían cuatro renderizados de servidor por visita.
    expect(codigo).toContain('<EnlacePrecarga');
    expect(codigo).not.toMatch(/\bprefetch\b(?!=)/);
    expect(codigo).not.toMatch(/<Link\b/);
    expect(codigo).toContain('setPulsada(');
    const salida = renderToStaticMarkup(React.createElement(PestanasPerfil, { personaId: UUID_A, secciones: ['resultados', 'estadisticas'], activa: 'resultados' }));
    expect(salida).toMatch(/aria-current="page"[^>]*data-seccion="resultados"[^>]*data-marcada="true"/);
  });

  it('Estadísticas no relee la ficha si el rendimiento llega', () => {
    const pagina = readFileSync('src/app/(app)/explorar/[personaId]/(perfil)/estadisticas/page.tsx', 'utf8');
    expect(pagina).toContain('rendimientoUtil(rendimiento) ? null : await fichaPerfil(personaId)');
    const seccion = readFileSync('src/components/explorar/perfil/secciones-perfil.tsx', 'utf8');
    expect(seccion).toMatch(/<SoloEnSeccion seccion="estadisticas"[\s\S]*<CifrasCarrera/);
  });
});
