import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { leerInscritosFie } from '@/lib/entries/inscritos-fie';
import { inscritosDeLaFie, inscritosEspanolesDeLaFie } from '@/lib/ingest/sources/fie';

/**
 * LA LISTA DE LA FIE DE TODOS LOS PAÍSES.
 *
 * La ingestión guarda sólo los españoles (`inscritosEspanolesDeLaFie`), pero
 * la ficha deja ver la lista entera pidiéndola en vivo a `/api/inscritos-fie`.
 * Estas pruebas cierran los dos sitios donde algo podría escaparse:
 *
 *   1. `inscritosDeLaFie` — el parseo multi-país: entran todas las
 *      nacionalidades y NO sale ni la licencia (lleva dentro la fecha de
 *      nacimiento) ni ningún campo sensible, igual que en el filtro de
 *      españoles.
 *   2. `leerInscritosFie` — la lectura: total real aunque recorte, y el 404
 *      de la FIE como «sin lista» y no como error.
 *
 * La ruta se prueba aparte, en `inscritos-fie-route.test.ts`.
 */

const respuesta = JSON.parse(
  readFileSync(new URL('./fixtures/fie-inscritos.json', import.meta.url), 'utf8'),
) as unknown;

describe('inscritosDeLaFie: el parseo de todos los países', () => {
  it('entran todas las nacionalidades, no sólo ESP', () => {
    const salida = inscritosDeLaFie(respuesta);

    // La respuesta trae 6 filas: 4 españolas y 2 francesas. Aquí salen las 6.
    expect(salida).toHaveLength(6);
    expect(salida.map((i) => i.pais)).toEqual(['ESP', 'ESP', 'FRA', 'ESP', 'ESP', 'FRA']);
  });

  it('sólo salen los campos que la ficha enseña: nombre, equipo y país', () => {
    for (const i of inscritosDeLaFie(respuesta)) {
      expect(Object.keys(i).sort()).toEqual(['equipo', 'nombre', 'pais']);
    }
  });

  it('la licencia no sale de NADIE: lleva dentro la fecha de nacimiento', () => {
    const texto = JSON.stringify(inscritosDeLaFie(respuesta));

    /**
     * `licenseNumber` es DDMMAAAA + 3 dígitos. Si una licencia se colara, la
     * fecha de nacimiento se colaría con ella —también la de la menor
     * francesa, que es el caso para el que existe este filtro.
     */
    for (const licencia of [
      '09122006000',
      '26031998003',
      '14052011007',
      '26041992000',
      '30012012001',
    ]) {
      expect(texto).not.toContain(licencia);
    }
    // Y, como en el filtro de españoles, ninguna fecha de nacimiento ni foto.
    expect(texto).not.toContain('2011-05-14');
    expect(texto).not.toContain('2012-01-30');
    expect(texto).not.toMatch(/https?:\/\//);
  });

  it('nombres y equipos se componen igual que en el filtro de españoles', () => {
    const salida = inscritosDeLaFie(respuesta);

    // Individual: equipo es cadena vacía; por equipos, `name` es el equipo.
    expect(salida.find((i) => i.nombre.startsWith('PETIT'))).toEqual({
      nombre: 'PETIT Lea',
      equipo: '',
      pais: 'FRA',
    });
    expect(salida.find((i) => i.nombre.startsWith('MOREAU'))).toEqual({
      nombre: 'MOREAU Enzo',
      equipo: 'France',
      pais: 'FRA',
    });
    expect(salida.find((i) => i.nombre.startsWith('LLAVADOR'))).toEqual({
      nombre: 'LLAVADOR Carlos',
      equipo: 'Spain',
      pais: 'ESP',
    });
  });

  it('el país cae al flag alfa-2 si no hay countryCode, y a null si no hay ni eso', () => {
    const conBandera = inscritosDeLaFie({
      items: [{ fencer: { lastName: 'ROSSI', firstName: 'Ada', flag: 'IT' } }],
    });
    expect(conBandera[0].pais).toBe('IT');

    const sinPais = inscritosDeLaFie({
      items: [{ fencer: { lastName: 'DOE', firstName: 'Jo' } }],
    });
    expect(sinPais[0].pais).toBeNull();
  });

  it('las españolas son las mismas que da el filtro, ni una más ni una menos', () => {
    const deTodos = inscritosDeLaFie(respuesta)
      .filter((i) => i.pais === 'ESP')
      .map((i) => i.nombre)
      .sort();
    const delFiltro = inscritosEspanolesDeLaFie(respuesta)
      .map((i) => i.nombre)
      .sort();
    expect(deTodos).toEqual(delFiltro);
  });

  it('una respuesta con otra forma devuelve lista vacía en vez de lanzar', () => {
    expect(inscritosDeLaFie(null)).toEqual([]);
    expect(inscritosDeLaFie({})).toEqual([]);
    expect(inscritosDeLaFie({ items: [null, 3, { fencer: null }] })).toEqual([]);
  });
});

describe('leerInscritosFie: la petición a la API de la FIE', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function respuestaFie(cuerpo: unknown, status = 200) {
    return vi.fn(async () =>
      new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), { status }),
    );
  }

  it('devuelve la lista entera saneada y el total que publica la FIE', async () => {
    vi.stubGlobal('fetch', respuestaFie(respuesta));
    const r = await leerInscritosFie(2027, 1410);
    expect(r).toEqual({ estado: 'ok', total: 6, inscritos: inscritosDeLaFie(respuesta) });
  });

  it('un 404 de la FIE es «sin lista», no un error de transporte', async () => {
    vi.stubGlobal('fetch', respuestaFie('no encontrado', 404));
    expect(await leerInscritosFie(2027, 1410)).toEqual({ estado: 'sin_lista' });
  });

  it('un 500 de la FIE sí lanza: la ruta lo cuenta como «no disponible»', async () => {
    vi.stubGlobal('fetch', respuestaFie('error', 500));
    await expect(leerInscritosFie(2027, 1410)).rejects.toThrow(/HTTP 500/);
  });

  it('dice el total real de la FIE aunque la lista llegue recortada', async () => {
    const cortada = {
      totalFound: 341,
      items: (respuesta as { items: unknown[] }).items.slice(0, 2),
    };
    vi.stubGlobal('fetch', respuestaFie(cortada));
    const r = await leerInscritosFie(2027, 1410);
    // 341 es lo que la FIE dice que hay, 2 lo que se pudo leer: la ficha lo matiza.
    expect(r).toMatchObject({ estado: 'ok', total: 341 });
    if (r.estado === 'ok') expect(r.inscritos).toHaveLength(2);
  });
});
