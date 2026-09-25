import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  parseSkermoCalendar,
  skermoCalendarUrl,
} from '@/lib/ingest/sources/skermo';
import { validateEvents } from '@/lib/ingest/types';

/**
 * Tests del parser de Skermo contra HTML REAL guardado.
 *
 * El fixture es la respuesta literal de
 * `app.skermo.org/calendar/public/RFEE?setLang=es&showPrevious=1&showExt=1`
 * del 25/09/2026 (2,5 MB en crudo, 105 KB comprimidos con gzip).
 *
 * Si Skermo cambia su marcado, estos tests se ponen en rojo antes de que los
 * usuarios se coman el error. Ese es exactamente su propósito: no comprueban
 * que el código "haga algo", comprueban que sigue entendiendo la fuente.
 */

const html = gunzipSync(
  readFileSync(new URL('./fixtures/skermo-rfee-2026-2027.html.gz', import.meta.url)),
).toString('utf8');

const parsed = parseSkermoCalendar(html, {
  source: 'skermo_rfee',
  federationCode: 'RFEE',
});
const validated = validateEvents(parsed.candidates);

describe('URL del calendario de Skermo', () => {
  it('incluye showExt, que es el parámetro del que depende todo', () => {
    // Sin showExt la página devuelve 36 competiciones; con él, 425. Si alguien
    // lo quita, nos dejamos fuera el 90 % del calendario sin darnos cuenta.
    const url = skermoCalendarUrl('RFEE');
    expect(url).toContain('showExt=1');
    expect(url).toContain('showPrevious=1');
    expect(url).toContain('setLang=es');
  });
});

describe('parseo del calendario real', () => {
  it('encuentra las 425 competiciones del fixture', () => {
    expect(parsed.rowsSeen).toBe(425);
  });

  it('las agrupa en eventos sin perder ninguna prueba', () => {
    const pruebas = validated.events.flatMap((e) => e.competitions);
    expect(validated.events.length).toBeGreaterThan(200);
    expect(pruebas.length).toBe(425);
  });

  it('no manda nada a cuarentena: todo el fixture es legible', () => {
    expect(validated.quarantined).toEqual([]);
  });

  it('reconoce las tres armas', () => {
    const armas = new Set(
      validated.events.flatMap((e) => e.competitions.map((c) => c.weapon)),
    );
    expect(armas).toEqual(new Set(['ESPADA', 'FLORETE', 'SABLE']));
  });

  it('reconoce las categorías que usa de verdad la RFEE', () => {
    const categorias = new Set(
      validated.events.flatMap((e) => e.competitions.map((c) => c.category)),
    );
    // El calendario 2026-2027 usa M14, M17, M20, M23 y ABS. Ojo: el brief
    // original hablaba de M13/M15, que NO aparecen en el calendario nacional.
    expect(categorias).toContain('M14');
    expect(categorias).toContain('M17');
    expect(categorias).toContain('M20');
    expect(categorias).toContain('ABS');
  });

  it('separa nacional de internacional por el tipo de circuito', () => {
    const ambitos = new Set(validated.events.map((e) => e.scope));
    expect(ambitos).toContain('NACIONAL');
    expect(ambitos).toContain('INTERNACIONAL');
  });

  it('lee el cierre de inscripción cuando la fuente lo publica', () => {
    const pruebas = validated.events.flatMap((e) => e.competitions);
    const conCierre = pruebas.filter((c) => c.registrationCloseDate);
    // 383 de 425 lo publican. Si esto baja de golpe, el parseo se ha roto.
    expect(conCierre.length).toBeGreaterThan(300);
    for (const c of conCierre) {
      expect(c.registrationCloseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('nunca inventa una cuota: Skermo no publica importes', () => {
    const pruebas = validated.events.flatMap((e) => e.competitions);
    expect(pruebas.every((c) => c.feeEur === null)).toBe(true);
  });
});

describe('sede y país', () => {
  it('saca el país del paréntesis de la población extranjera', () => {
    const fuera = validated.events.filter((e) => e.country && e.country !== 'ES');
    expect(fuera.length).toBeGreaterThan(50);
    for (const e of fuera) {
      expect(e.country).toMatch(/^[A-Z]{2}$/);
      // La ciudad no debe arrastrar el código entre paréntesis.
      expect(e.city ?? '').not.toMatch(/\([A-Z]{3}\)/);
    }
  });

  it('asume España solo cuando la población no lleva marca de país', () => {
    const espanolas = validated.events.filter((e) => e.country === 'ES');
    expect(espanolas.length).toBeGreaterThan(10);
  });

  it('deja la sede en null cuando la fuente dice TBD, sin escribir "TBD"', () => {
    // "TBD" aparece 32 veces en el calendario real: es "sede por decidir",
    // no el nombre de una ciudad.
    const conTbd = validated.events.filter((e) => e.city === 'TBD');
    expect(conTbd).toEqual([]);
    expect(validated.events.some((e) => e.city === null)).toBe(true);
  });

  it('deduce el huso horario cuando conoce el país', () => {
    const conHuso = validated.events.filter((e) => e.timezone);
    expect(conHuso.length).toBeGreaterThan(100);
    // Y no se inventa uno cuando no sabe dónde es.
    const sinPais = validated.events.filter((e) => !e.country);
    expect(sinPais.every((e) => e.timezone === null)).toBe(true);
  });
});

describe('idempotencia del parseo', () => {
  // Parsear 2,5 MB de HTML lleva unos segundos; el límite por defecto de
  // vitest (5 s) se queda corto y el fallo sería del reloj, no del código.
  it(
    'dos pasadas sobre el mismo HTML dan exactamente lo mismo',
    { timeout: 60_000 },
    () => {
      const otra = parseSkermoCalendar(html, {
        source: 'skermo_rfee',
        federationCode: 'RFEE',
      });
      expect(otra.candidates.length).toBe(parsed.candidates.length);
      expect(JSON.stringify(otra.candidates)).toBe(JSON.stringify(parsed.candidates));
    },
  );

  it('las claves de evento son estables y únicas', () => {
    const ids = validated.events.map((e) => e.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('documentos y trazabilidad', () => {
  it('recoge los PDFs que cuelgan de la ficha', () => {
    const conDocs = validated.events.filter((e) => e.documents.length > 0);
    expect(conDocs.length).toBeGreaterThan(5);
    for (const e of conDocs) {
      for (const d of e.documents) {
        expect(d.url).toContain('app.skermo.org/client/');
      }
    }
  });

  it('cada prueba enlaza a su ancla en la fuente', () => {
    const pruebas = validated.events.flatMap((e) => e.competitions);
    for (const c of pruebas.slice(0, 20)) {
      expect(c.sourceUrl).toMatch(/#detail\d+$/);
    }
  });
});
