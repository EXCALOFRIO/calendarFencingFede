import { describe, expect, it } from 'vitest';
import { parsearCuadroEngarde } from '../src/lib/ingest/sources/engarde-cuadro';
import { rutaFww } from '../scripts/indexado/lote12-efc-fww';
import { quitarNacionEnCuadro } from '../scripts/indexado/lote8c-engarde';

describe('lote 12 EFC', () => {
  it('saca la prueba de Fencing Worldwide de la URL de resultados o del nombre del PDF de Ophardt', () => {
    expect(rutaFww('https://www.fencingworldwide.com/en/8029-2024/results/')).toBe('8029-2024');
    expect(rutaFww("https://efc-prod.s3.amazonaws.com/documents/swe/sqi/wvt/documentation-916173-2024-Foil-Womens-Individual-U17.pdf")).toBe('916173-2024');
    expect(rutaFww('https://efc-prod.s3.amazonaws.com/documents/pol/jdk/nql/Cadet%20Women\'s%20Saber.pdf')).toBeNull();
    expect(rutaFww(null)).toBeNull();
  });

  it('el cuadro nuevo de Engarde (nación en columna propia y «nombre NAC» en las rondas) se lee tras limpiar la nación', () => {
    const nac = (n: string) => `<td class="HBD nation quarter1"><div class="country-container"><span translate="no">${n}</span><span class="flagsm flag-${n}"></span></div></td>`;
    const html = `<html><body><table class="tableau" summary="Tableau of 4">
<tr><td> </td><td class="tableTitle">  Tableau of 4</td><td> </td><td class="tableTitle">  Final</td></tr>
<tr><td class="D placeNumber quarter1">1</td><td class="HBD fencer quarter1"> ALFA Uno </td>${nac('ITA')}<td> </td></tr>
<tr><td> </td><td> </td><td class="D"> </td><td class="HBD fencer quarter1"> ALFA Uno ITA </td></tr>
<tr><td class="D placeNumber quarter1">4</td><td class="HBD fencer quarter1"> BETA Dos </td>${nac('ESP')}<td class="score">15/3</td></tr>
<tr><td> </td><td> </td><td> </td><td> </td><td class="HBD fencer quarter1"> GAMMA Tres FRA </td></tr>
<tr><td class="D placeNumber quarter1">3</td><td class="HBD fencer quarter1"> GAMMA Tres </td>${nac('FRA')}<td> </td><td class="D score">15/12</td></tr>
<tr><td> </td><td> </td><td class="D"> </td><td class="HBD fencer quarter1"> GAMMA Tres FRA </td></tr>
<tr><td class="D placeNumber quarter1">2</td><td class="HBD fencer quarter1"> DELTA Cuatro </td>${nac('GER')}<td class="score">15/10</td></tr>
</table></body></html>`;
    expect(parsearCuadroEngarde(html, { individual: true }).importado).toBe(0);
    const c = parsearCuadroEngarde(quitarNacionEnCuadro(html), { individual: true });
    expect(c).toMatchObject({ estado: 'leido', rondas: ['T4', 'F'], publicado: 3, importado: 3, completo: true });
    const final = c.asaltos.find((a) => a.ronda === 'F')!;
    expect([final.nombreA, final.nombreB].sort()).toEqual(['ALFA Uno', 'GAMMA Tres']);
    expect(final.nombreA === 'GAMMA Tres' ? final.puntosA : final.puntosB).toBe(15);
  });
});
