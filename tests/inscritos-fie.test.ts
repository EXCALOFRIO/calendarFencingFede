import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DIAS_ENTRE_LECTURAS,
  DIAS_VENTANA_INSCRITOS,
  DIAS_ZONA_CALIENTE,
  fieEntriesUrl,
  huellaDeInscritos,
  inscritosEspanolesDeLaFie,
  pruebaFieDeSourceId,
  tocaLeerInscritos,
  type InscritoFie,
} from '@/lib/ingest/sources/fie';

/**
 * LAS LISTAS DE INSCRITOS DE LA FIE.
 *
 * Este fichero existe por una frase del usuario que es una regla del proyecto:
 * *«un modelo se salta una instrucción, un `if` no»*. La decisión —**solo
 * españoles, sin datos de menores**— está escrita en un comentario y en una
 * migración, y eso no basta: aquí se le da al adaptador una respuesta con una
 * MENOR de otra federación, con su fecha de nacimiento, su edad, su altura y
 * su foto, y se comprueba que de todo eso no sale absolutamente nada.
 *
 * Si alguien relaja el filtro para conseguir un campo, esta prueba se pone
 * roja. Es exactamente para eso.
 */

const respuesta = JSON.parse(
  readFileSync(new URL('./fixtures/fie-inscritos.json', import.meta.url), 'utf8'),
) as unknown;

/** Todo el texto que sale del adaptador, aplanado, para poder buscar en él. */
function todoElTexto(inscritos: InscritoFie[]): string {
  return JSON.stringify(inscritos);
}

describe('el filtro de la lista de inscritos de la FIE', () => {
  it('no deja pasar a nadie que no sea español', () => {
    const salida = inscritosEspanolesDeLaFie(respuesta);

    // La respuesta trae 6 filas: 4 españolas y 2 francesas.
    expect(salida).toHaveLength(4);
    expect(salida.map((i) => i.nombre).sort()).toEqual([
      'CASAUS PIELAGO Jorge',
      'FERNANDEZ BLANCO Oscar',
      'FLOREZ Carlos',
      'LLAVADOR Carlos',
    ]);
  });

  it('de la menor francesa no sale NI UN dato: ni nombre, ni fecha, ni foto', () => {
    const texto = todoElTexto(inscritosEspanolesDeLaFie(respuesta));

    // Ella, por su nombre y por su identificador.
    expect(texto).not.toContain('PETIT');
    expect(texto).not.toContain('Lea');
    expect(texto).not.toContain('61234');
    // Su fecha de nacimiento, en los dos formatos en que aparece.
    expect(texto).not.toContain('2011-05-14');
    expect(texto).not.toContain('14052011007');
    // Su edad, su altura y su foto.
    expect(texto).not.toContain('162');
    expect(texto).not.toContain('999999-PETIT');
    expect(texto).not.toContain('FRA');
  });

  it('del otro menor extranjero, el de la prueba por equipos, tampoco', () => {
    const texto = todoElTexto(inscritosEspanolesDeLaFie(respuesta));
    expect(texto).not.toContain('MOREAU');
    expect(texto).not.toContain('Enzo');
    expect(texto).not.toContain('2012-01-30');
    expect(texto).not.toContain('888888');
    expect(texto).not.toContain('France');
  });

  it('de los españoles guarda TRES campos y descarta el resto', () => {
    const salida = inscritosEspanolesDeLaFie(respuesta);
    const casaus = salida.find((i) => i.nombre.startsWith('CASAUS'));

    expect(casaus).toEqual({
      nombre: 'CASAUS PIELAGO Jorge',
      equipo: '',
      licencia: '09122006000',
      inscritoEl: '2026-09-08',
      fieId: 54066,
    });

    /**
     * Y lo que NO está. `fieId` es el único campo que sobra de los tres
     * acordados, y está a propósito: sirve para emparejar contra `fie_fencer`
     * y **no se persiste** (ver `upsertListasDeInscritos`). Todo lo demás no
     * llega ni a existir.
     */
    for (const i of salida) {
      expect(Object.keys(i).sort()).toEqual([
        'equipo',
        'fieId',
        'inscritoEl',
        'licencia',
        'nombre',
      ]);
    }
  });

  it('no sale ninguna fecha de nacimiento ni ninguna foto de NADIE, español incluido', () => {
    const texto = todoElTexto(inscritosEspanolesDeLaFie(respuesta));

    // Fechas de nacimiento de los españoles del fichero.
    expect(texto).not.toContain('2006-12-09');
    expect(texto).not.toContain('1998-03-26');
    expect(texto).not.toContain('1992-04-26');
    // Ninguna URL, así que ninguna foto.
    expect(texto).not.toMatch(/https?:\/\//);
    // Ni alturas ni puntos ni puestos.
    expect(texto).not.toContain('183');
    expect(texto).not.toContain('24.750');
    expect(texto).not.toContain('overallRanking');
  });

  it('en las pruebas por equipos el nombre es el del tirador y el equipo va aparte', () => {
    const salida = inscritosEspanolesDeLaFie(respuesta);
    const llavador = salida.find((i) => i.nombre.startsWith('LLAVADOR'));

    /**
     * Esto es el fallo que habría metido cuatro filas llamadas "Spain": en las
     * pruebas por equipos `fencer.name` es el nombre del EQUIPO y el tirador
     * está en `lastName`/`firstName`.
     */
    expect(llavador?.nombre).toBe('LLAVADOR Carlos');
    expect(llavador?.equipo).toBe('Spain');
  });

  it('en las individuales el equipo es cadena vacía, no null', () => {
    const salida = inscritosEspanolesDeLaFie(respuesta);
    const casaus = salida.find((i) => i.nombre.startsWith('CASAUS'));
    /**
     * Cadena vacía y no null porque `source_team` forma parte de la clave
     * única y en Postgres dos NULL no chocan: con null entrarían duplicados.
     */
    expect(casaus?.equipo).toBe('');
  });

  it('un español sin licencia entra igual, con la licencia a null', () => {
    const salida = inscritosEspanolesDeLaFie(respuesta);
    const florez = salida.find((i) => i.nombre === 'FLOREZ Carlos');
    expect(florez?.licencia).toBeNull();
    /** Pero se le puede emparejar por identificador, que es mejor. */
    expect(florez?.fieId).toBe(45875);
  });

  it('una respuesta con otra forma devuelve lista vacía en vez de lanzar', () => {
    expect(inscritosEspanolesDeLaFie(null)).toEqual([]);
    expect(inscritosEspanolesDeLaFie({})).toEqual([]);
    expect(inscritosEspanolesDeLaFie({ items: 'nada' })).toEqual([]);
    expect(inscritosEspanolesDeLaFie({ items: [null, 3, { fencer: null }] })).toEqual([]);
    expect(inscritosEspanolesDeLaFie({ items: [{ fencer: { countryCode: 'ESP' } }] })).toEqual(
      [],
    );
  });

  it('una fecha de inscripción que no sea una fecha se descarta', () => {
    const salida = inscritosEspanolesDeLaFie({
      items: [
        {
          registeredAt: 'pronto',
          fencer: { id: 1, lastName: 'GARCIA', firstName: 'Ana', countryCode: 'ESP' },
        },
      ],
    });
    expect(salida[0].inscritoEl).toBeNull();
  });
});

describe('la URL de la lista', () => {
  it('se construye con competitionId, no con el id del índice de torneos', () => {
    /**
     * Con el `id` (16776) la API da 404 y la página pública da **200 con la
     * lista vacía**, que es peor. Con `competitionId` (1410) sale la lista de
     * verdad. Comprobado en vivo el 27/09/2026.
     */
    expect(fieEntriesUrl(2027, 1410)).toBe('https://fie.org/competition/2027/1410/entries');
  });

  it('el competitionId se saca de la clave del evento', () => {
    expect(pruebaFieDeSourceId('fie-2027-1410')).toEqual({ season: 2027, competitionId: 1410 });
    expect(pruebaFieDeSourceId('fie-2027-33')).toEqual({ season: 2027, competitionId: 33 });
  });

  it('una clave que no encaja devuelve null, y así no se piden URLs inventadas', () => {
    expect(pruebaFieDeSourceId('skermo-rfee-12')).toBeNull();
    expect(pruebaFieDeSourceId('fie-2027-')).toBeNull();
    expect(pruebaFieDeSourceId('fie-27-1410')).toBeNull();
    expect(pruebaFieDeSourceId(null)).toBeNull();
    expect(pruebaFieDeSourceId(undefined)).toBeNull();
  });
});

describe('cuándo toca pedir la lista de inscritos', () => {
  const ahora = new Date('2026-09-27T03:00:00Z');
  const dia = (n: number) =>
    new Date(ahora.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  const haceDias = (n: number) => new Date(ahora.getTime() - n * 86_400_000);

  it('una prueba ya disputada no se vuelve a pedir nunca', () => {
    const r = tocaLeerInscritos(ahora, dia(-1), haceDias(10));
    expect(r.leer).toBe(false);
  });

  it('fuera de la ventana no se pide: no hay ni un español más allá de 30 días', () => {
    expect(tocaLeerInscritos(ahora, dia(DIAS_VENTANA_INSCRITOS + 1), null).leer).toBe(false);
    expect(tocaLeerInscritos(ahora, dia(60), null).leer).toBe(false);
  });

  it('el último día de la ventana sí entra', () => {
    const r = tocaLeerInscritos(ahora, dia(DIAS_VENTANA_INSCRITOS), null);
    expect(r.leer).toBe(true);
  });

  it('si no se ha leído nunca, se lee', () => {
    const r = tocaLeerInscritos(ahora, dia(20), null);
    expect(r.leer).toBe(true);
    if (r.leer) expect(r.motivo).toBe('primera_vez');
  });

  it('con el cierre encima se lee todos los días', () => {
    const r = tocaLeerInscritos(ahora, dia(DIAS_ZONA_CALIENTE), haceDias(1));
    expect(r.leer).toBe(true);
    if (r.leer) expect(r.motivo).toBe('cierre_cerca');
  });

  it('la prueba de hoy sigue mirándose: alguien se puede caer esta mañana', () => {
    const r = tocaLeerInscritos(ahora, dia(0), haceDias(1));
    expect(r.leer).toBe(true);
  });

  it('LA CIFRA QUE IMPORTA: una segunda pasada el mismo día cuesta 0 peticiones', () => {
    /**
     * Es la disciplina del resto del proyecto —la ingestión de circulares hace
     * la segunda pasada en 0 peticiones— y aquí se consigue con
     * `registrations_checked_at`: si la lista se leyó hace menos de un día, no
     * se vuelve a pedir, ni en la zona caliente ni lejos del cierre.
     */
    const haceUnaHora = new Date(ahora.getTime() - 3_600_000);
    expect(tocaLeerInscritos(ahora, dia(2), haceUnaHora).leer).toBe(false);
    expect(tocaLeerInscritos(ahora, dia(9), haceUnaHora).leer).toBe(false);
    expect(tocaLeerInscritos(ahora, dia(25), haceUnaHora).leer).toBe(false);
  });

  it('lejos del cierre se mira cada tres días, no cada día', () => {
    const lejos = dia(DIAS_ZONA_CALIENTE + 5);
    expect(tocaLeerInscritos(ahora, lejos, haceDias(1)).leer).toBe(false);
    expect(tocaLeerInscritos(ahora, lejos, haceDias(DIAS_ENTRE_LECTURAS - 1)).leer).toBe(false);
    const r = tocaLeerInscritos(ahora, lejos, haceDias(DIAS_ENTRE_LECTURAS));
    expect(r.leer).toBe(true);
    if (r.leer) expect(r.motivo).toBe('revision');
  });

  it('una prueba sin día publicado no se pide', () => {
    expect(tocaLeerInscritos(ahora, null, null).leer).toBe(false);
  });
});

describe('la huella de la lista', () => {
  const uno: InscritoFie = {
    nombre: 'CASAUS PIELAGO Jorge',
    equipo: '',
    licencia: '09122006000',
    inscritoEl: '2026-09-08',
    fieId: 54066,
  };
  const dos: InscritoFie = {
    nombre: 'FLOREZ Carlos',
    equipo: '',
    licencia: null,
    inscritoEl: '2026-09-08',
    fieId: 45875,
  };

  it('no cambia si la FIE devuelve la misma lista en otro orden', async () => {
    expect(await huellaDeInscritos([uno, dos], 'p1')).toBe(
      await huellaDeInscritos([dos, uno], 'p1'),
    );
  });

  it('cambia si cambia un dato que se guarda', async () => {
    expect(await huellaDeInscritos([uno], 'p1')).not.toBe(
      await huellaDeInscritos([{ ...uno, inscritoEl: '2026-09-09' }], 'p1'),
    );
  });

  it('NO cambia por el identificador, que no se guarda', async () => {
    expect(await huellaDeInscritos([uno], 'p1')).toBe(
      await huellaDeInscritos([{ ...uno, fieId: 99999 }], 'p1'),
    );
  });

  it('cambia si cambia la prueba en la que se escribe', async () => {
    /**
     * Sin esto, el día en que hay que mover la lista de sitio —porque el
     * torneo español empieza a publicar la suya y la nuestra se retira— la
     * huella coincidiría, no se escribiría nada y la lista se quedaría sin
     * sitio. El fallo sería invisible.
     */
    expect(await huellaDeInscritos([uno], 'p1')).not.toBe(
      await huellaDeInscritos([uno], 'p2'),
    );
  });

  it('una lista vacía tiene huella, y distinta de la que tiene a alguien', async () => {
    expect(await huellaDeInscritos([], 'p1')).not.toBe(await huellaDeInscritos([uno], 'p1'));
  });
});
