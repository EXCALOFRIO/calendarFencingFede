import { describe, expect, it } from 'vitest';
import { leerPdfRfee } from '@/lib/ingest/sources/rfee-pdf/lectura';

/**
 * Lectura pública real (GET en memoria, sin cuenta, sin escritura) de PDFs
 * oficiales de la RFEE 2018-19. Se salta salvo `RFEE_PDF_VIVO=1`:
 *
 *   $env:RFEE_PDF_VIVO='1'; npx.cmd vitest run tests/rfee-pdf-vivo.test.ts
 *
 * Los recuentos son los observados el 2026-10-01 y salen del propio
 * documento; si la RFEE republica un PDF, este test avisa de revisar el
 * fixture. Los PDF no se guardan ni se imprimen nombres.
 */
const URLS = {
  espadaAbsoluta: 'https://app.skermo.org/client/1/8a18f4649d0b77c3c078165715948a7a.pdf',
  floreteEquipos: 'https://app.skermo.org/client/1/9a42156a5fbd077a367990814a72a0ce.pdf',
  criterium: 'https://app.skermo.org/client/1/b8bec4b455d1815831cbd05df5839c71.pdf',
  torneoGrande: 'https://app.skermo.org/client/1/bb2423afd640e96a772b70dc063fbd90.pdf',
};

describe.skipIf(!process.env.RFEE_PDF_VIVO)('lectura real de PDF públicos de la RFEE', () => {
  it('espada absoluta: 28 puestos, 84 asaltos de poule y 15 de cuadro', async () => {
    const l = await leerPdfRfee(URLS.espadaAbsoluta);
    expect(l.estado).toBe('completo');
    const p = l.pruebas[0];
    expect(p.puestos).toHaveLength(28);
    expect(p.asaltos.filter((a) => a.fase === 'POULE')).toHaveLength(84);
    expect(p.asaltos.filter((a) => a.fase === 'TABLEAU')).toHaveLength(15);
    expect(l.perfil?.paginas).toBe(8);
  }, 60_000);

  it('florete por equipos: sólo clasificación', async () => {
    const l = await leerPdfRfee(URLS.floreteEquipos);
    expect(l.pruebas[0]).toMatchObject({ formato: 'EQUIPOS' });
    expect(l.pruebas[0].puestos).toHaveLength(4);
    expect(l.pruebas[0].asaltos).toHaveLength(0);
  }, 60_000);

  it('Criterium: 30 pruebas M-10/M-12 en un PDF, ninguna con asaltos', async () => {
    const l = await leerPdfRfee(URLS.criterium);
    expect(l.pruebas.length).toBeGreaterThanOrEqual(28);
    expect(l.pruebas.every((p) => p.asaltos.length === 0)).toBe(true);
    expect(new Set(l.pruebas.map((p) => p.categoria))).toEqual(new Set(['M10', 'M12', null]));
  }, 60_000);

  it('torneo de 127 tiradoras: puestos, poules y cuadro completos con perfil acotado', async () => {
    const l = await leerPdfRfee(URLS.torneoGrande);
    const p = l.pruebas[0];
    expect(p.puestos).toHaveLength(127);
    expect(p.asaltos.filter((a) => a.fase === 'POULE')).toHaveLength(363);
    expect(p.asaltos.filter((a) => a.fase === 'TABLEAU')).toHaveLength(81);
    expect(l.perfil?.bytes).toBeLessThan(1_000_000);
    expect(l.perfil?.ms).toBeLessThan(20_000);
  }, 60_000);
});
