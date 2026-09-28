import { describe, expect, it } from 'vitest';
import {
  analizarTitulo,
  asuntoDe,
  calcularVigencia,
  type DocumentoParaVigencia,
  marcaSobreOtroDocumento,
  marcasDe,
  numeroCircularDe,
  resumirVigencia,
  temporadaDeFecha,
} from '../src/lib/documentos/vigencia';
import {
  arrastreTemporadaAnterior,
  escalonDePuesto,
  esquemaFormulaPuntos,
  puntosRfee,
} from '../src/lib/ranking/formula';

/**
 * Dos cosas se prueban aquí, y las dos son lógica pura a propósito.
 *
 * La familia y la versión de un título no necesitan base de datos ni modelo:
 * son expresiones regulares sobre una cadena. Y la fórmula del ranking es
 * aritmética. Por eso los dos se pueden probar con los casos REALES feos, que
 * es lo único que de verdad demuestra algo.
 *
 * Los títulos de este fichero están copiados tal cual de `official_document`,
 * con sus erratas, sus mayúsculas y su mezcla de guiones y subrayados. No se
 * han limpiado: si se limpiaran, el test dejaría de probar el caso.
 */

// ---------------------------------------------------------------------------
// Tarea 1 · Vigencia de las circulares
// ---------------------------------------------------------------------------

const ENERO = new Date('2026-01-15T10:00:00Z');

describe('número de circular', () => {
  it('lo saca de las cinco formas que usa la RFEE', () => {
    expect(numeroCircularDe('CIRCULAR 12-26 GESTION ADMINISTRATIVA 26-27')).toBe('12-26');
    // Con subrayado en vez de guion.
    expect(numeroCircularDe('CIRCULAR 19 25 GESTION ADMINISTRATIVA')).toBe('19-25');
    // Con espacio, como en los ficheros de 2019.
    expect(numeroCircularDe('CIRCULAR 13 19 CTO ESPANA CADETE')).toBe('13-19');
    // Una sola cifra: «1-22», no «01-22».
    expect(numeroCircularDe('CIRCULAR 1-22 DECISIONES CNTYC')).toBe('1-22');
    // Ceros a la izquierda normalizados.
    expect(numeroCircularDe('CIRCULAR 07-26 CLASIFICADOS')).toBe('7-26');
  });

  it('lee el número aunque lleve «bis» pegado, sin frontera de palabra', () => {
    /**
     * Este es el caso que rompió la primera versión: con `\b` al final,
     * «11-24bis» no casaba, la circular se quedaba sin número y acababa en la
     * familia de la temporada equivocada, marcando como superada a la 14-23.
     */
    expect(numeroCircularDe('CIRCULAR 11-24BIS CLASIFICADOS CTO ESPANA SENIOR 24')).toBe(
      '11-24',
    );
    expect(numeroCircularDe('CIRCULAR 09-24BIS CTO ESPANA M15')).toBe('9-24');
  });

  it('no inventa un número cuando el título no lo trae', () => {
    expect(numeroCircularDe('NORMATIVA PARA RANKINGS NACIONALES 23-24')).toBeNull();
    expect(numeroCircularDe('CIRCULAR 24 CLASIFICADOS CTO ESPANA JUNIOR')).toBeNull();
    // La errata de la federación: «CIRCULA R23bis 23». No hay arreglo
    // determinista, así que se queda sin número en vez de adivinarlo.
    expect(numeroCircularDe('CIRCULA R23BIS 23 EXAMEN ARBITRAJE')).toBeNull();
  });
});

describe('marcas del título', () => {
  it('reconoce «bis» pegado, con guion y suelto', () => {
    expect(marcasDe('CIRCULAR 02-24 CTO EUROPA CAD JUN 24BIS').bis).toBe(true);
    expect(marcasDe('CIRCULAR 02-24 CTO EUROPA CAD JUN 24-BIS').bis).toBe(true);
    expect(marcasDe('CIRCULAR 12-21BIS CLASIFICADOS CTO ESPANA JUNIOR').bis).toBe(true);
    expect(marcasDe('CIRCULAR 5BIS II COPA ESPANA ESGRIMA ANTIGUA').bis).toBe(true);
  });

  it('reconoce las versiones numeradas', () => {
    expect(marcasDe('NORMATIVA COMPETICIONES EQUIPOS 2026-2027 V3').version).toBe(3);
    expect(marcasDe('NORMATIVA PARA RANKINGS NACIONALES 2021-2022 V6').version).toBe(6);
    expect(marcasDe('NORMATIVA PARA RANKINGS NACIONALES 23-24').version).toBeNull();
  });

  it('reconoce «actualizada» en las tres formas reales', () => {
    // Sin separador y con el mes pegado.
    expect(marcasDe('NORMATIVA COMPETICION EQUIPOS ACTUALIZADASEPT25').actualizada).toBe(
      true,
    );
    // En masculino, que también aparece.
    expect(
      marcasDe('NORMATIVA PARA RANKINGS NACIONALES 2018-19 ACTUALIZADO MARZO 19')
        .actualizada,
    ).toBe(true);
    expect(
      marcasDe('NORMATIVA PARA RANKINGS NACIONALES ACTUALIZADA SEPT 2025').actualizada,
    ).toBe(true);
  });

  it('distingue cancelación, modificación y subsanación', () => {
    expect(marcasDe('CIRCULAR 01-26 CANCELACION PROTOCOLO EQUIPAJE').cancelacion).toBe(true);
    expect(marcasDe('CIRCULAR 21-23 MODIFICACION RANKING INTERNO').modificacion).toBe(true);
    expect(marcasDe('CIRCULAR 03-26 SUBSANACION CLASIFICADOS').subsanacion).toBe(true);
  });

  it('separa las marcas que hablan de OTRO documento de las que hablan de sí mismas', () => {
    /**
     * Es la distinción de la que depende que no se apaguen normas válidas.
     * «MODIFICACIÓN», «SUBSANACIÓN» y «CANCELACIÓN» nombran el acto de tocar
     * otra circular; «_V3», «bis», «actualizada», «COMPLETA» y `_signed` solo
     * dicen «soy otra versión de mí mismo».
     */
    const sobreOtro = (t: string) => marcaSobreOtroDocumento(marcasDe(t));

    expect(sobreOtro('CIRCULAR 03-26 SUBSANACION CLASIFICADOS')).toBe(true);
    expect(sobreOtro('CIRCULAR 21-23 MODIFICACION RANKING INTERNO')).toBe(true);
    expect(sobreOtro('CIRCULAR 01-26 CANCELACION PROTOCOLO')).toBe(true);

    expect(sobreOtro('NORMATIVA COMPETICIONES EQUIPOS 2026-2027 V3')).toBe(false);
    expect(sobreOtro('CIRCULAR 09-24BIS CTO ESPANA M15')).toBe(false);
    expect(sobreOtro('CIRCULAR 21-24 ELECCIONES 2024-3 SIGNED')).toBe(false);
    expect(sobreOtro('CIRCULAR 04-23 CTO ESPANA JUNIOR SUB23 COMPLETA')).toBe(false);
    expect(sobreOtro('NORMATIVA COMPETICION EQUIPOS ACTUALIZADASEPT25')).toBe(false);
  });
});

describe('asunto normalizado', () => {
  it('iguala los títulos que solo se diferencian en la puntuación', () => {
    // Guiones, subrayados y tildes: el mismo documento escrito de dos maneras.
    expect(asuntoDe('CIRCULAR 07-26 CLASIFICADOS CTO ESPAÑA M17')).toBe(
      asuntoDe('CIRCULAR_07-26_CLASIFICADOS_CTO_ESPAÑA_M17'),
    );
    expect(asuntoDe('CIRCULAR 12-23 CTO ESPAÑA CADETE')).toBe(
      asuntoDe('CIRCULAR 12-23 CTO ESPANA CADETE'),
    );
  });

  it('el caso feo de verdad: «actualizadaSept25» no deja basura en el asunto', () => {
    /**
     * Literal de la base: «CIRCULAR 21-25 NORMATIVA COMPETICION EQUIPOS
     * actualizadaSept25». Si el «25» de «Sept25» se quedara dentro, este
     * documento caería en una familia propia y no se emparejaría con la
     * normativa de equipos de su temporada.
     */
    expect(asuntoDe('CIRCULAR 21-25 NORMATIVA COMPETICION EQUIPOS actualizadaSept25')).toBe(
      'NORMATIVA COMPETICION EQUIPOS',
    );
    expect(asuntoDe('NORMATIVA COMPETICIONES EQUIPOS actualizadaSept25')).toBe(
      'NORMATIVA COMPETICION EQUIPOS',
    );
  });

  it('iguala singular y plural, y «CTO» con «CAMPEONATO»', () => {
    expect(asuntoDe('NORMATIVA COMPETICIONES EQUIPOS 2026-2027_V1')).toBe(
      asuntoDe('NORMATIVA COMPETICIÓN DE EQUIPOS 21-22'),
    );
    expect(asuntoDe('CIRCULAR 06-26 CAMPEONATO MUNDO CADETE-JUNIOR')).toContain(
      'CAMPEONATO MUNDO',
    );
  });

  it('quita el año abreviado que dejan las marcas, pero no las categorías', () => {
    // «24-bis» deja un 24 suelto que no es asunto.
    expect(asuntoDe('CIRCULAR 02-24 CTO EUROPA CAD-JUN 24-bis')).toBe(
      asuntoDe('CIRCULAR 02-24 CTO EUROPA CAD-JUN 24'),
    );
    // Pero M17, M20 y U23 van pegados a su letra y tienen que sobrevivir.
    expect(asuntoDe('CIRCULAR 02-26 CLASIFICADOS CTO ESPAÑA M20-U23')).toContain('M20');
    expect(asuntoDe('CIRCULAR 02-26 CLASIFICADOS CTO ESPAÑA M20-U23')).toContain('U23');
    expect(asuntoDe('CIRCULAR 07-26 CLASIFICADOS CTO ESPAÑA M17')).toContain('M17');
  });
});

describe('temporada', () => {
  it('la deduce de la fecha con el corte de septiembre', () => {
    expect(temporadaDeFecha(new Date('2026-09-18T10:00:00Z'))).toBe('2026-2027');
    expect(temporadaDeFecha(new Date('2026-08-31T10:00:00Z'))).toBe('2025-2026');
    expect(temporadaDeFecha(new Date('2026-03-01T10:00:00Z'))).toBe('2025-2026');
  });

  it('el título manda sobre la fecha, y el número de circular sobre la fecha', () => {
    const conTitulo = analizarTitulo('NORMATIVA COMPETICIONES EQUIPOS 2026-2027_V3', ENERO);
    expect(conTitulo.temporada).toBe('2026-2027');
    expect(conTitulo.temporadaInferida).toBe(false);

    // Sin temporada en el título, pero «12-26» dice que es la doce de la 26.
    const conNumero = analizarTitulo('CIRCULAR 12-26 MATERIAL DE ESGRIMA', ENERO);
    expect(conNumero.temporada).toBe('2026-2027');
    expect(conNumero.temporadaInferida).toBe(false);

    // Sin ninguna de las dos: se deduce y se marca como deducida.
    const inferida = analizarTitulo('Convocatoria Delegacion Cantabra de Esgrima', ENERO);
    expect(inferida.temporadaInferida).toBe(true);
  });

  it('no confunde «CAD-JUN» ni «BRONCE-4» con una temporada', () => {
    // Dos cifras separadas por guion que NO son años consecutivos.
    const a = analizarTitulo('CIRCULAR 04-26 MODIFICACIÓN NORMATIVA LIGA CLUBES BRONCE-4', ENERO);
    expect(a.temporada).toBe('2026-2027');
  });
});

/** Atajo para montar documentos de prueba sin repetir la forma. */
function doc(
  id: string,
  title: string,
  fecha: string,
  extra: { fileHash?: string | null; wpMediaId?: number } = {},
): DocumentoParaVigencia {
  return {
    id,
    title,
    publishedAt: new Date(`${fecha}T10:00:00Z`),
    fileHash: extra.fileHash ?? null,
    wpMediaId: extra.wpMediaId ?? (Number.parseInt(id.replace(/\D/g, ''), 10) || 1),
  };
}

describe('vigencia · lo que el usuario señaló', () => {
  it('la V1 de la normativa de equipos queda superada por la V3', () => {
    const v = calcularVigencia([
      doc('1', 'NORMATIVA COMPETICIONES EQUIPOS 2026-2027_V1', '2026-07-17'),
      doc('3', 'NORMATIVA COMPETICIONES EQUIPOS 2026-2027_V3', '2026-09-18'),
    ]);
    const v1 = v.find((x) => x.documentoId === '1');
    const v3 = v.find((x) => x.documentoId === '3');

    expect(v3?.estado).toBe('vigente');
    expect(v1?.estado).toBe('superada');
    expect(v1?.sustituidaPorId).toBe('3');
    expect(v1?.motivo).toContain('V3');
  });

  it('la circular de CANCELACIÓN deroga el protocolo, aunque sea de otra temporada', () => {
    /**
     * El caso literal: «CIRCULAR 01-26 CANCELACIÓN PROTOCOLO EQUIPAJE
     * RFEE-ADIF» (temporada 26) cancela «CIRCULAR 04-25 PROTOCOLO EQUIPAJE
     * RFEE-ADIF» (temporada 25). Son números y temporadas distintos, así que
     * la cancelación tiene que cruzar la frontera de temporada.
     */
    const v = calcularVigencia([
      doc('4', 'CIRCULAR 04-25 PROTOCOLO EQUIPAJE RFEE-ADIF', '2025-02-03'),
      doc('1', 'CIRCULAR 01-26 CANCELACION PROTOCOLO EQUIPAJE RFEE-ADIF', '2026-01-07'),
    ]);

    const cancelada = v.find((x) => x.documentoId === '4');
    expect(cancelada?.estado).toBe('cancelada');
    expect(cancelada?.sustituidaPorId).toBe('1');
    expect(cancelada?.motivo).toContain('Cancelada por');
    expect(v.find((x) => x.documentoId === '1')?.estado).toBe('vigente');
  });

  it('una circular no cancela el futuro', () => {
    // El protocolo se vuelve a publicar DESPUÉS de la cancelación: el nuevo
    // manda y la cancelación no lo toca.
    const v = calcularVigencia([
      doc('1', 'CIRCULAR 01-26 CANCELACION PROTOCOLO EQUIPAJE RFEE-ADIF', '2026-01-07'),
      doc('9', 'CIRCULAR 09-26 PROTOCOLO EQUIPAJE RFEE-ADIF', '2026-05-01'),
    ]);
    expect(v.find((x) => x.documentoId === '9')?.estado).toBe('vigente');
  });

  it('la SUBSANACIÓN supera la circular anterior del mismo asunto', () => {
    const v = calcularVigencia([
      doc('2', 'CIRCULAR 02-26 CLASIFICADOS CTO ESPAÑA M20-U23', '2026-01-27'),
      doc('3', 'CIRCULAR 03-26 SUBSANACION CLASIFICADOS CTO ESPAÑA M20-U23', '2026-02-04'),
    ]);
    expect(v.find((x) => x.documentoId === '3')?.estado).toBe('vigente');
    expect(v.find((x) => x.documentoId === '2')?.estado).toBe('superada');
  });

  it('«bis» supera la circular del mismo número', () => {
    const v = calcularVigencia([
      doc('90', 'CIRCULAR 09-24 CTO ESPAÑA M15', '2024-05-15'),
      doc('91', 'CIRCULAR 09-24bis CTO ESPAÑA M15', '2024-05-20'),
    ]);
    expect(v.find((x) => x.documentoId === '91')?.estado).toBe('vigente');
    expect(v.find((x) => x.documentoId === '90')?.estado).toBe('superada');
  });

  it('las cinco copias de la normativa de rankings 2021-2022 dejan una sola vigente', () => {
    const v = calcularVigencia([
      doc('a', 'NORMATIVA PARA RANKINGS NACIONALES 2021-2022', '2021-08-06'),
      doc('b', 'NORMATIVA PARA RANKINGS NACIONALES 2021-2022', '2021-09-15'),
      doc('c', 'NORMATIVA PARA RANKINGS NACIONALES 2021-2022', '2021-10-21'),
      doc('d', 'NORMATIVA PARA RANKINGS NACIONALES 2021-2022_V4', '2021-09-15'),
      doc('e', 'NORMATIVA PARA RANKINGS NACIONALES 2021-2022_V6', '2022-05-25'),
    ]);

    expect(v.filter((x) => x.estado === 'vigente')).toHaveLength(1);
    expect(v.find((x) => x.estado === 'vigente')?.documentoId).toBe('e');
    // Y todas están en la MISMA familia, que es lo que permite colapsarlas.
    expect(new Set(v.map((x) => x.familia)).size).toBe(1);
    expect(v[0].versionesEnFamilia).toBe(5);
  });

  it('las cuatro copias de «CIRCULAR 03-23 CTO MUNDO CAD-JUN» con la MISMA fecha se ordenan igual siempre', () => {
    /**
     * Las cuatro tienen la misma fecha, así que sin un último desempate el
     * orden dependería del orden en que Postgres devolviera las filas y la
     * pantalla cambiaría de un refresco a otro. Desempata `wp_media_id`, que
     * sube con cada subida.
     */
    const filas = [
      doc('p1', 'CIRCULAR 03-23 CTO MUNDO CAD-JUN', '2023-02-28', { wpMediaId: 10 }),
      doc('p2', 'CIRCULAR 03-23 CTO MUNDO CAD-JUN', '2023-02-28', { wpMediaId: 20 }),
      doc('p3', 'CIRCULAR 03-23 CTO MUNDO CAD-JUN', '2023-02-28', { wpMediaId: 30 }),
      doc('p4', 'CIRCULAR 03-23 CTO MUNDO CAD-JUN', '2023-02-28', { wpMediaId: 40 }),
    ];

    const directo = calcularVigencia(filas);
    const alReves = calcularVigencia([...filas].reverse());

    const vigenteDe = (r: ReturnType<typeof calcularVigencia>) =>
      r.find((x) => x.estado === 'vigente')?.documentoId;

    expect(vigenteDe(directo)).toBe('p4');
    expect(vigenteDe(alReves)).toBe('p4');
    expect(directo.filter((x) => x.estado === 'superada')).toHaveLength(3);
  });

  it('los duplicados exactos por hash se colapsan en una sola entrada', () => {
    const v = calcularVigencia([
      doc('u1', 'CIRCULAR 06-26 CAMPEONATO MUNDO CADETE-JUNIOR', '2026-03-09', {
        fileHash: 'abc123',
        wpMediaId: 100,
      }),
      doc('u2', 'CIRCULAR 06-26 CAMPEONATO MUNDO CADETE-JUNIOR', '2026-03-09', {
        fileHash: 'abc123',
        wpMediaId: 200,
      }),
    ]);

    const dup = v.find((x) => x.estado === 'duplicada');
    expect(dup?.documentoId).toBe('u1');
    expect(dup?.duplicadoDeId).toBe('u2');
    expect(dup?.motivo).toContain('mismo fichero');
    expect(v.find((x) => x.documentoId === 'u2')?.estado).toBe('vigente');
  });
});

describe('vigencia · lo que NO se debe marcar (la regla conservadora)', () => {
  it('las circulares de elecciones son anuncios distintos, no versiones', () => {
    /**
     * EL caso que hay que no romper. Son quince circulares reales con el mismo
     * asunto y la misma temporada, con números DISTINTOS, y no se sustituyen
     * unas a otras. Una versión anterior de este módulo marcaba trece como
     * superadas porque una de ellas llevaba el sufijo `_signed`: trece normas
     * válidas apagadas por una marca que solo hablaba de sí misma.
     */
    const v = calcularVigencia([
      doc('e18', 'CIRCULAR 18-24 ELECCIONES 2024', '2024-07-19'),
      doc('e19', 'CIRCULAR 19-24 ELECCIONES 2024-2', '2024-07-25'),
      doc('e21', 'CIRCULAR_21-24_ELECCIONES_2024-3_signed', '2024-07-25'),
      doc('e22', 'CIRCULAR 22-24 ELECCIONES 2024-4', '2024-07-26'),
      doc('e27', 'CIRCULAR 27-24 ELECCIONES 2024', '2024-09-18'),
      doc('e34', 'CIRCULAR 34-24 ELECCIONES 2024', '2024-10-18'),
    ]);

    expect(v.every((x) => x.estado === 'vigente')).toBe(true);
  });

  it('pero sí colapsa las copias del MISMO número de circular', () => {
    // Las tres «30-24» son la misma circular subida tres veces.
    const v = calcularVigencia([
      doc('a', 'CIRCULAR 30-24 ELECCIONES 2024', '2024-09-23', { wpMediaId: 1 }),
      doc('b', 'CIRCULAR 30-24 ELECCIONES 2024', '2024-09-23', { wpMediaId: 2 }),
      doc('c', 'CIRCULAR 30-24 ELECCIONES 2024', '2024-09-23', { wpMediaId: 3 }),
      doc('z', 'CIRCULAR 29-24 ELECCIONES 2024', '2024-09-23', { wpMediaId: 4 }),
    ]);

    expect(v.filter((x) => x.estado === 'superada')).toHaveLength(2);
    // La 29-24 es otra circular y se queda como está.
    expect(v.find((x) => x.documentoId === 'z')?.estado).toBe('vigente');
  });

  it('una «COMPLETA» anterior no supera las circulares posteriores', () => {
    /**
     * «CIRCULAR_04-23_CTO_ESPANA_JUNIOR-SUB23_COMPLETA» es del 27 de marzo y
     * las 05-23 y 06-23 son del 5 y el 10 de abril. Si el orden de versión
     * pesara más que la fecha, la COMPLETA mandaría sobre dos circulares
     * posteriores. No puede.
     */
    const v = calcularVigencia([
      doc('c4', 'CIRCULAR_04-23_CTO_ESPANA_JUNIOR-SUB23_COMPLETA', '2023-03-27'),
      doc('c5', 'CIRCULAR 05-23 CTO ESPAÑA JUNIOR-SUB23', '2023-04-05'),
      doc('c6', 'CIRCULAR 06-23 CTO ESPANA JUNIOR-SUB23', '2023-04-10'),
    ]);

    expect(v.find((x) => x.documentoId === 'c5')?.estado).toBe('vigente');
    expect(v.find((x) => x.documentoId === 'c6')?.estado).toBe('vigente');
  });

  it('circulares del mismo asunto en temporadas distintas no se superan', () => {
    const v = calcularVigencia([
      doc('v19', 'CIRCULAR_13-19_CTO_ESPAÑA_CADETE', '2019-04-16'),
      doc('v23', 'CIRCULAR 12-23 CTO ESPAÑA CADETE', '2023-05-22'),
    ]);
    expect(v.every((x) => x.estado === 'vigente')).toBe(true);
    expect(new Set(v.map((x) => x.familia)).size).toBe(2);
  });

  it('el resumen cuenta lo que hay', () => {
    const r = resumirVigencia(
      calcularVigencia([
        doc('1', 'NORMATIVA COMPETICIONES EQUIPOS 2026-2027_V1', '2026-07-17'),
        doc('3', 'NORMATIVA COMPETICIONES EQUIPOS 2026-2027_V3', '2026-09-18'),
        doc('9', 'CIRCULAR 09-26 CRITERIUM NACIONAL M9-M11', '2026-05-06'),
      ]),
    );
    expect(r.total).toBe(3);
    expect(r.vigentes).toBe(2);
    expect(r.superadas).toBe(1);
    expect(r.familias).toBe(2);
    expect(r.familiasConVarias).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tarea 2 · La fórmula del ranking nacional
// ---------------------------------------------------------------------------

/**
 * Los escalones y los parámetros, tal como quedan guardados en `ranking_rule`.
 * Se escriben aquí porque son la ENTRADA del test, no porque el código los
 * conozca: el módulo no tiene ni un número de la normativa dentro.
 */
const ESCALONES = {
  '1': 1414,
  '2': 1212,
  '3-4': 1010,
  '5-8': 808,
  '9-16': 606,
  '17-32': 404,
  '33-64': 202,
  '65-128': 101,
};

const FORMULA = esquemaFormulaPuntos.parse({
  tipo: 'rfee_log10',
  escala: 1000,
  techo: 1.01,
});

describe('escalón por puesto', () => {
  it('lee los cortes de la normativa desde la tabla de tramos', () => {
    expect(escalonDePuesto(ESCALONES, 1)).toBe(1414);
    expect(escalonDePuesto(ESCALONES, 2)).toBe(1212);
    // «SI(L5<5;1010;0)» = puestos 3 y 4.
    expect(escalonDePuesto(ESCALONES, 3)).toBe(1010);
    expect(escalonDePuesto(ESCALONES, 4)).toBe(1010);
    // «SI(L5<9;808;0)» = 5 a 8.
    expect(escalonDePuesto(ESCALONES, 5)).toBe(808);
    expect(escalonDePuesto(ESCALONES, 8)).toBe(808);
    expect(escalonDePuesto(ESCALONES, 9)).toBe(606);
    expect(escalonDePuesto(ESCALONES, 16)).toBe(606);
    expect(escalonDePuesto(ESCALONES, 17)).toBe(404);
    expect(escalonDePuesto(ESCALONES, 32)).toBe(404);
    expect(escalonDePuesto(ESCALONES, 33)).toBe(202);
    expect(escalonDePuesto(ESCALONES, 64)).toBe(202);
    expect(escalonDePuesto(ESCALONES, 65)).toBe(101);
    expect(escalonDePuesto(ESCALONES, 128)).toBe(101);
  });

  it('del 129 en adelante el escalón es cero, que es lo que dice el MAX()', () => {
    expect(escalonDePuesto(ESCALONES, 129)).toBe(0);
    expect(escalonDePuesto(ESCALONES, 300)).toBe(0);
  });
});

describe('fórmula de puntos · contra los puntos OFICIALES de la base', () => {
  /**
   * Los pares (puesto, puntos) están copiados de `result.official_points` del
   * TNR M20 de espada femenina del 20/09/2026, que es la única prueba de la
   * base con puntos publicados por la fuente. El cuadro tuvo 84 clasificados.
   *
   * Es LA comprobación de esta tarea: si estos números no salieran, la lectura
   * de la fórmula sería mía y no de la RFEE.
   */
  const PARTICIPANTES = 84;
  const OFICIALES: [number, number][] = [
    [2, 2065.56],
    [3, 1772.05],
    [6, 1413.61],
    [7, 1378.82],
    [8, 1348.69],
    [9, 1120.1],
    [16, 990.25],
    [17, 774.57],
    [24, 696.74],
    [32, 631.81],
    [33, 422.87],
    [48, 338.3],
    [64, 273.37],
    [65, 168.87],
    [80, 122.01],
    [84, 111.0],
  ];

  it.each(OFICIALES)('puesto %i da %f puntos, al céntimo', (puesto, esperados) => {
    const d = puntosRfee({
      puesto,
      participantes: PARTICIPANTES,
      coeficiente: 1,
      escalones: ESCALONES,
      formula: FORMULA,
    });
    expect(d).not.toBeNull();
    expect(d?.puntos).toBe(esperados);
  });

  it('con otro número de participantes NO cuadra, así que no es un encaje casual', () => {
    /**
     * Esto es lo que convierte la comprobación en una prueba. Si la fórmula
     * acertara con cualquier base, no demostraría nada. Con 80 participantes
     * —que es lo que dice `registration_count`— el puesto 3 se va a 1769,29
     * en vez de 1772,05.
     */
    const conOchenta = puntosRfee({
      puesto: 3,
      participantes: 80,
      coeficiente: 1,
      escalones: ESCALONES,
      formula: FORMULA,
    });
    expect(conOchenta?.puntos).not.toBe(1772.05);
    expect(conOchenta?.puntos).toBeCloseTo(1769.29, 2);
  });
});

describe('fórmula de puntos · coeficientes y desglose', () => {
  it('el coeficiente multiplica el total, no el escalón', () => {
    const base = puntosRfee({
      puesto: 5,
      participantes: 50,
      coeficiente: 1,
      escalones: ESCALONES,
      formula: FORMULA,
    });
    // 1,25 es el de la categoría inmediatamente superior y el del Campeonato
    // de España de la propia categoría (punto 1.2 de la normativa).
    const superior = puntosRfee({
      puesto: 5,
      participantes: 50,
      coeficiente: 1.25,
      escalones: ESCALONES,
      formula: FORMULA,
    });
    expect(superior?.puntos).toBe(
      Math.round((base as { base: number }).base * 1.25 * 100) / 100,
    );
  });

  it('devuelve el desglose entero, para poder enseñar el cálculo abierto', () => {
    const d = puntosRfee({
      puesto: 1,
      participantes: 84,
      coeficiente: 1,
      escalones: ESCALONES,
      formula: FORMULA,
    });
    // El primero: log10(1) = 0, así que se lleva el techo entero.
    expect(d?.escalon).toBe(1414);
    expect(d?.continuo).toBe(1010);
    expect(d?.puntos).toBe(2424);
  });

  it('no calcula cuando falta el dato, y devuelve null en vez de cero', () => {
    const comun = { coeficiente: 1, escalones: ESCALONES, formula: FORMULA };
    // Un solo participante: log10(1) = 0 y la división sería entre cero.
    expect(puntosRfee({ puesto: 1, participantes: 1, ...comun })).toBeNull();
    expect(puntosRfee({ puesto: 0, participantes: 50, ...comun })).toBeNull();
    // Un puesto por detrás del total de participantes son datos mal leídos.
    expect(puntosRfee({ puesto: 60, participantes: 50, ...comun })).toBeNull();
    expect(puntosRfee({ puesto: Number.NaN, participantes: 50, ...comun })).toBeNull();
  });
});

describe('arrastre de la temporada anterior', () => {
  it('aplica los porcentajes del punto 1.1', () => {
    // Cadete 10 %, júnior 15 %, sénior 20 %.
    expect(arrastreTemporadaAnterior(1000, 0.1)?.puntos).toBe(100);
    expect(arrastreTemporadaAnterior(1000, 0.15)?.puntos).toBe(150);
    expect(arrastreTemporadaAnterior(1000, 0.2)?.puntos).toBe(200);
  });

  it('el 0 % de sub-23 es una decisión, no un hueco', () => {
    const cero = arrastreTemporadaAnterior(1000, 0);
    expect(cero).not.toBeNull();
    expect(cero?.puntos).toBe(0);
    expect(cero?.explicacion).toContain('0');
  });

  it('M13 y M15 no tienen arrastre en la normativa: null, no cero', () => {
    // «La normativa no lo dice» y «la normativa dice cero» son cosas distintas.
    expect(arrastreTemporadaAnterior(1000, null)).toBeNull();
    // Y sin puntos de la temporada anterior no hay nada que arrastrar.
    expect(arrastreTemporadaAnterior(null, 0.2)).toBeNull();
  });

  it('la explicación dice de dónde sale el número', () => {
    const a = arrastreTemporadaAnterior(2000, 0.2);
    expect(a?.explicacion).toContain('20');
    expect(a?.explicacion).toContain('400');
    expect(a?.explicacion).toContain('no es vivo');
  });
});
