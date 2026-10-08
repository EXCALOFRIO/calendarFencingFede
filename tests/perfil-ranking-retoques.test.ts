import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { componerChunk, proyeccion } from '../scripts/indexado/sincronizar-d1';
import { sentenciasLista } from '@/lib/ingest/rankings-internacionales/sql';
import type { ListaInternacional } from '@/lib/ingest/rankings-internacionales/tipos';
import { RelevosPerfilVista } from '@/components/explorar/relevos';
import { InsigniaOlimpica } from '@/components/olimpica/insignia-olimpica';
import { ladoCompacto, ladoNacional } from '@/components/ranking/armar-ficha';
import { FilaLinea } from '@/components/ranking/fila-linea';
import type { AnotacionOlimpica } from '@/lib/ranking/olimpica';
import type { PuestoOficial } from '@/lib/queries/ranking';
import { bloquesRankingPerfil, leerRankingAmbitos, leerRankingEuropeo } from '@/lib/sport/explorar/ranking-ambitos';
import type { RelevosPerfil } from '@/lib/sport/explorar/relevos';
import { fixtureDeportivaD1 } from './helpers/d1-deporte';

const html = (e: React.ReactElement) => renderToStaticMarkup(e);

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';

function base() {
  const local = fixtureDeportivaD1();
  const ejecutar = (cuerpo: string, cargo: number) =>
    local.sqlite.exec(componerChunk(cuerpo, { owner: randomUUID(), medidoBytes: 1, proyectadoBytes: proyeccion(cargo) }));
  ejecutar([P1, P2, P3].map((id, i) =>
    `INSERT INTO sport_person(id,display_name,name_normalized,gender,country_code) VALUES('${id}','TIRADORA ${i}','tiradora ${i}','F','SUI');\n`).join(''), 200_000);
  const cargar = (l: ListaInternacional, filas: { ref: string; personId: string; puesto: number | null }[]) => {
    const { sentencias, cargo } = sentenciasLista(l, filas.map((f) => ({ nombre: null, pais: 'SUI', puntos: null, ...f })), true);
    ejecutar(sentencias.map((s) => `${s};\n`).join(''), cargo);
  };
  return { ...local, cargar };
}

const EFC: ListaInternacional = {
  fuente: 'efc_ranking', temporada: '2024-2025', arma: 'ESPADA', genero: 'F', categoria: 'M17', categoriaRaw: 'cadet',
  publicadoEl: '2025-06-30', baseFecha: 'observed', url: 'https://example.invalid/efc', total: 300, filas: [],
};

describe('pestaña Ranking con sólo el europeo', () => {
  it('el camino crítico sabe que hay europeo sin traer el bloque, y la pestaña sale', async () => {
    const local = base();
    try {
      local.cargar(EFC, [{ ref: 'efc:1', personId: P1, puesto: 12 }, { ref: 'efc:2', personId: P2, puesto: null }]);

      const conPuesto = await leerRankingAmbitos(local.db, [P1], P1);
      expect(conPuesto).toMatchObject({ pais: 'SUI', internacional: null, nacionalFuera: null, europeo: true });
      const bloques = bloquesRankingPerfil({ rankingAmbitos: conPuesto });
      expect(bloques).toMatchObject({ hay: true, europeo: true, internacional: null, mundial: null, nacional: null, nacionalFuera: null });
      expect((await leerRankingEuropeo(local.db, [P1]))?.mejor?.puesto).toBe(12);

      // Una fila sin puesto no abre la pestaña; sin filas, tampoco.
      for (const id of [P2, P3]) {
        const a = await leerRankingAmbitos(local.db, [id], id);
        expect(a.europeo).toBe(false);
        expect(bloquesRankingPerfil({ rankingAmbitos: a }).hay).toBe(false);
      }
    } finally {
      local.close();
    }
  });

  it('sin el dato (lecturas anteriores) la pestaña sigue como estaba', () => {
    expect(bloquesRankingPerfil({ rankingAmbitos: { pais: 'SUI', internacional: null, nacionalFuera: null } }))
      .toMatchObject({ hay: false, europeo: false });
  });
});

describe('/ranking: la tarjeta de los tiradores de la cuenta', () => {
  const puesto: PuestoOficial = {
    athleteId: 'a1', seasonLabel: '2026-2027', weapon: 'FLORETE', gender: 'F', category: 'M17', categoryRaw: 'M17',
    position: 4, totalPoints: 120.5, club: 'FED-M-C', deCuantos: 80, actualizadoEl: new Date('2026-10-01T00:00:00Z'),
    sourceUrl: 'https://example.invalid/rfee',
  };

  it('sólo viaja lo que se pinta: ni licencia ni año de nacimiento', () => {
    const lado = ladoCompacto(ladoNacional([puesto], { licencia: 'LIC-998877', anioNacimiento: 2011 }));
    expect(Object.keys(lado).sort()).toEqual(['etiqueta', 'federacion', 'mejor', 'motivoVacio']);
    expect(lado.mejor).toMatchObject({ puesto: 4 });
    const json = JSON.stringify(lado);
    expect(json).not.toContain('2011');
    expect(json).not.toContain('LIC-998877');
  });

  it('la página no pasa la licencia ni la fecha de nacimiento a la tarjeta', () => {
    // Las lecturas de la página viven en `datos.ts` y el pintado en `vista.tsx`.
    const pagina = ['page.tsx', 'datos.ts', 'vista.tsx']
      .map((f) => readFileSync(path.join(process.cwd(), 'src', 'app', '(app)', 'ranking', f), 'utf8'))
      .join('\n');
    expect(pagina).toMatch(/ladoNacional\(suyos\)/);
    expect(pagina).not.toMatch(/birthDate/);
    expect(pagina).not.toMatch(/rfeeLicense/);
  });
});

describe('insignia olímpica compacta', () => {
  const cerca: AnotacionOlimpica = {
    estado: 'cerca', camino: null, zona: null, contra: null, faltan: 12, margen: null, sobre: null, puestoFuera: 1, motivo: null, sinVeto: null,
  };

  it('por debajo de 360 px deja sólo el laurel y conserva la etiqueta accesible', () => {
    const compacta = html(React.createElement(InsigniaOlimpica, { anotacion: cerca, compacta: true }));
    const normal = html(React.createElement(InsigniaOlimpica, { anotacion: cerca }));
    const etiqueta = /aria-label="([^"]+)"/.exec(normal)?.[1];
    expect(etiqueta).toBeTruthy();
    expect(compacta).toContain(`aria-label="${etiqueta}"`);
    expect(compacta).toMatch(/<span aria-hidden="true" class="max-\[359px\]:hidden">−12<\/span>/);
    expect(normal).not.toContain('max-[359px]:hidden');
  });

  it('la marca no va en la línea del nombre: por debajo de 360 px comparte celda con los puntos', () => {
    const fila = (tras?: React.ReactNode) => html(React.createElement(FilaLinea, { puesto: 1, nombre: 'CHOUPENITCH Alexander', pais: 'CZE', puntos: 218.5, tras }));
    const con = fila(React.createElement('i', { 'data-marca': '' }));
    const nombre = /<span class="flex min-w-0 items-center gap-2">.*?<\/span><span class="col-start-3/.exec(con)?.[0] ?? '';
    expect(nombre).toContain('data-nombre');
    expect(nombre).not.toContain('data-marca');
    expect(con).toContain('<span class="col-start-3 row-start-1 flex items-center justify-self-start"><i data-marca=""></i></span>');
    expect(con).toContain('col-start-3 row-start-1 justify-self-end pl-4 min-[360px]:col-start-5');
    const sin = fila();
    expect(sin).not.toContain('col-start-3');
    expect(sin).not.toContain('min-[360px]:grid-cols');
  });
});

describe('relevos en la pestaña Rivales', () => {
  const datos: RelevosPerfil = {
    relevos: 6, encuentros: 2, dados: 25, recibidos: 20, indice: 5, truncado: false,
    pruebas: [{
      pruebaId: 'p1', edicionId: 'e1', torneo: 'Copa de España', fuente: 'engarde', arma: 'ESPADA', genero: 'F', categoria: 'ABS',
      categoriaRaw: null, temporada: '2023-2024', fecha: '2024-03-10', equipo: 'CE Madrid', encuentros: 2, relevos: 6, dados: 25, recibidos: 20,
    }],
  };

  it('bloque propio con el título al nivel de la pestaña y sin texto de más', () => {
    const pagina = html(React.createElement(RelevosPerfilVista, { datos, personaId: P1 }));
    expect(pagina).toContain('<h2 id="perfil-relevos"');
    expect(pagina).toContain('1 prueba por equipos');
    expect(pagina).not.toContain('Tocados dados y recibidos');
    expect(html(React.createElement(RelevosPerfilVista, { datos, personaId: P1, nivel: 'seccion' }))).toContain('<h3 id="perfil-relevos"');
    expect(html(React.createElement(RelevosPerfilVista, { datos: { ...datos, relevos: 0 }, personaId: P1 }))).toBe('');
  });

  it('la página del perfil ya no la pinta al final, fuera de las pestañas', () => {
    const pagina = readFileSync(path.join(process.cwd(), 'src', 'app', '(app)', 'explorar', '[personaId]', '(perfil)', 'page.tsx'), 'utf8');
    expect(pagina).not.toContain('RelevosPerfil');
    // En el perfil por secciones los relevos son el último bloque de Rivales.
    const seccion = readFileSync(path.join(process.cwd(), 'src', 'components', 'explorar', 'perfil', 'secciones-perfil.tsx'), 'utf8');
    const deSeccion = seccion.slice(seccion.indexOf('export function SeccionRivales'), seccion.indexOf('export function SeccionCuriosidades'));
    expect(deSeccion.indexOf('<RelevosPerfilVista')).toBeGreaterThan(deSeccion.indexOf('<SugeridosPerfil'));
    const ficha = readFileSync(path.join(process.cwd(), 'src', 'components', 'explorar', 'ficha-deportiva.tsx'), 'utf8');
    const rivales = ficha.slice(ficha.indexOf('    rivales: ('), ficha.indexOf('if (conRanking)'));
    expect(rivales).toContain('<RelevosPerfilDiferido');
  });
});
