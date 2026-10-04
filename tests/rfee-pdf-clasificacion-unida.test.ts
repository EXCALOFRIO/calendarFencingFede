import { describe, expect, it } from 'vitest';
import { leerClasificacion } from '../src/lib/ingest/sources/rfee-pdf/clasificacion';
import { analizarPagina } from '../src/lib/ingest/sources/rfee-pdf/paginas';
import { cabecera, fila, pagina } from './fixtures/rfee-pdf/sintetico';

function lectura(header = 'cl. apellido nombre', body = [
  fila(710, [19, '1 ALFA UNO'], [230, 'CLUB UNO']),
  fila(696, [19, '3 BRAVO DOS'], [230, 'CLUB DOS']),
  fila(682, [19, '3 CHARLIE TRES']),
]) {
  return leerClasificacion([analizarPagina(pagina(1, [
    ...cabecera('ESPADA MASCULINA INDIVIDUAL'),
    fila(740, [14, 'Clasificación general final (orden por lugar - 3 tiradores)']),
    fila(727, [14, header], [230, 'club']), ...body,
  ]))]);
}
describe('Engarde joined rank/name text items', () => {
  it.each(['cl. apellido nombre', 'cl. apellido-nom'])('reads explicit %s without renumbering ties or shifting missing clubs', header => {
    const result = lectura(header);
    expect(result.rechazos).toEqual([]);
    expect(result.publicado).toBe(3);
    expect(result.puestos.map(p => [p.posicion, p.nombre, p.club])).toEqual([
      [1, 'ALFA UNO', 'CLUB UNO'], [3, 'BRAVO DOS', 'CLUB DOS'], [3, 'CHARLIE TRES', null],
    ]);
    expect(result.puestos[0].sourceFactKey).toBe('pdf:p1:y710');
  });
  it('does not split an ambiguous leading number without the explicit joined header', () => {
    const result = lectura('columna desconocida');
    expect(result.puestos).toEqual([]);
    expect(result.rechazos.length).toBeGreaterThan(0);
  });
  it('keeps malformed numeric prefixes rejected rather than inventing a name', () => {
    const result = lectura('cl. apellido nombre', [fila(710, [19, '1 2020'], [230, 'CLUB UNO'])]);
    expect(result.puestos).toEqual([]);
    expect(result.rechazos.length).toBeGreaterThan(0);
  });
});
