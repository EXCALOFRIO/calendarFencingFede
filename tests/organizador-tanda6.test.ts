import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { ORGANIZADORES, organizadorDe, sqlOrganizador, sqlTipoPorNombre } from '@/lib/sport/explorar/organizador';
import { clasificarCompeticion, FRASES_TIPO, tipoPorNombre } from '@/lib/sport/explorar/tipo-competicion';

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => { throw new Error('El test no puede acceder a Cloudflare'); },
}));

const cierres: (() => void)[] = [];
afterEach(() => cierres.splice(0).forEach((cerrar) => cerrar()));

/** [nombre, fuente, país] — los cuatro de la revisión y los casos de frontera. */
const EDICIONES: [string, string, string | null][] = [
  ['Circuito Europeo Cadete - Sable - Barcelona', 'engarde', 'ESP'],
  ['EFC CADET CIRCUIT "CIUDAD DE SEGOVIA" 2026', 'engarde', 'ESP'],
  ['U23 European Circuit Epee', 'engarde', null],
  ['TNR and EFC U23 Foil Open Sabadell', 'engarde', null],
  ['Trofeo Circuito Europeo M-14', 'engarde', null],
  ['Open (EFC) Cadet', 'engarde', 'FRA'],
  ['Kneipp Cup', 'efc', 'AUT'],
  ["Championnats d'Europe Cadets", 'fie', 'TUR'],
  ['Coupe du Monde', 'fie', 'FRA'],
  ['Tournoi Satellite', 'fie', 'ISL'],
  ['TNR ABS (3/3)', 'skermo_rfee', 'ESP'],
  ['Campeonato de España Absoluto', 'rfee_pdf', null],
  ['Liga de Oro', 'skermo_rfee', 'ESP'],
  ['Campeonato de Madrid M-15', 'engarde', 'ESP'],
  ['Copa Comunidad', 'skermo_regional', 'ESP'],
  ['Torneo Ciudad de Lyon', 'engarde', 'FRA'],
  ['Torneo Ciudad de Lugo', 'engarde', null],
  ['Copa del Mundo – Satélite europeo', 'engarde', 'ESP'],
  ['Trofeo Effective', 'engarde', 'ESP'],
];

describe('organizador: la insignia y el filtro siguen la misma regla', () => {
  it('cada frase del SQL da, sola, el tipo de su regla', () => {
    for (const [tipo, frases] of FRASES_TIPO) {
      for (const f of frases) expect(tipoPorNombre(f.replace('%', 'ionnats')), f).toBe(tipo);
    }
  });

  it('los nombres de Engarde del circuito europeo son de la EFC, también el TNR abierto de la EFC', () => {
    for (const [nombre, fuente, pais] of EDICIONES.slice(0, 5)) {
      expect(organizadorDe(clasificarCompeticion({ nombre, fuente, pais }), fuente), nombre).toBe('EFC');
    }
  });

  it('el filtro devuelve exactamente las ediciones de cada insignia', async () => {
    const local = localD1();
    cierres.push(local.close);
    const insertar = local.sqlite.prepare(
      `INSERT INTO sport_edition (id, source, season, tournament_key, name, country_code) VALUES (?, ?, '2026', ?, ?, ?)`,
    );
    EDICIONES.forEach(([nombre, fuente, pais], i) => insertar.run(`e${i}`, fuente, `t${i}`, nombre, pais));
    const db = createD1Database(local.binding);

    const tipos = await db.all<{ id: string; tipo: string | null }>(
      sql`SELECT e.id, ${sqlTipoPorNombre(sql`e.name`)} AS tipo FROM sport_edition e ORDER BY e.rowid`,
    );
    expect(tipos.map((t) => t.tipo)).toEqual(EDICIONES.map(([nombre]) => tipoPorNombre(nombre)));

    for (const organizador of ORGANIZADORES) {
      const filas = await db.all<{ id: string }>(
        sql`SELECT e.id FROM sport_edition e WHERE ${sqlOrganizador(organizador)} ORDER BY e.rowid`,
      );
      const esperadas = EDICIONES.flatMap(([nombre, fuente, pais], i) =>
        organizadorDe(clasificarCompeticion({ nombre, fuente, pais }), fuente) === organizador ? [`e${i}`] : [],
      );
      expect(filas.map((f) => f.id), organizador).toEqual(esperadas);
    }
  });
});
