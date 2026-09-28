import { describe, expect, it } from 'vitest';
import {
  agruparEnBloques,
  capsulaDeFecha,
  diasSemanaOcupados,
  esEntreSemana,
  huecoEntre,
  itemsDelMes,
  lunesDeLaSemana,
  rangoCorto,
  rangoRealDeEvento,
  textoDeDuracion,
} from '@/lib/calendario/bloques';
import type { CompetitionView, EventView } from '@/lib/queries/calendar';

/**
 * ===========================================================================
 * LOS BLOQUES DE COMPETICIÓN
 * ===========================================================================
 *
 * El calendario dejó de ser una rejilla de días y pasó a ser una lista de
 * bloques. Razonamiento del usuario, literal: *«como son siempre casi siempre
 * en findes las competiciones»*, así que una cuadrícula pinta 31 casillas para
 * enseñar cuatro eventos.
 *
 * Esto NO comprueba que se vea bonito —eso se mira en la captura— sino las
 * cuatro cosas que se pueden romper sin darse cuenta y que además el usuario
 * ya cazó una vez en un boceto:
 *
 *  1. Que el rango de fechas sea **el de las pruebas**, no el del cartel.
 *  2. Que un fin de semana con cinco competiciones sea **un** bloque.
 *  3. Que el texto de un hueco **cuadre al contar los días**.
 *  4. Que un bloque caiga en **un solo mes**, el de su primer día.
 *
 * REGLA QUE CAMBIA RESPECTO A LA REJILLA, y se escribe aquí porque la prueba
 * la fija: la rejilla **partía** una barra entre dos semanas y entre dos meses
 * (un torneo del 30 de octubre al 1 de noviembre se pintaba dos veces, media
 * en cada columna). Un bloque no se parte: sale una vez, en el mes de su
 * primer día, y la fecha entera ya dice que se mete en el siguiente. Media
 * tarjeta no se puede leer.
 */

function prueba(over: Partial<CompetitionView> = {}): CompetitionView {
  return {
    id: `c-${Math.random().toString(36).slice(2)}`,
    weapon: 'FLORETE',
    gender: 'M',
    category: 'ABS',
    categoryRaw: null,
    format: 'INDIVIDUAL',
    competitionDate: null,
    installationOpen: null,
    callTime: null,
    scratchTime: null,
    startTime: null,
    registrationCount: null,
    feeEur: null,
    sourceUrl: null,
    deadlines: [],
    status: {
      state: 'sin_datos',
      label: 'Plazo no publicado',
      next: null,
      daysLeft: null,
      currentSurchargeEur: null,
      nextSurchargeEur: null,
      closed: false,
      hasEstimates: false,
    },
    datosExtraidos: [],
    ...over,
  };
}

function evento(over: Partial<EventView> = {}): EventView {
  return {
    id: `e-${Math.random().toString(36).slice(2)}`,
    source: 'skermo_rfee',
    sourceUrl: null,
    name: 'Torneo de prueba',
    startDate: '2026-10-03',
    endDate: '2026-10-04',
    venue: null,
    venueAddress: null,
    city: null,
    country: null,
    geoLat: null,
    geoLon: null,
    timezone: null,
    officialSite: null,
    imageUrl: null,
    circuit: 'OTRO',
    scope: 'NACIONAL',
    regionalFederation: null,
    notes: null,
    lastSeenAt: new Date(),
    disappearedAt: null,
    competitions: [prueba()],
    documents: [],
    liveLinks: [],
    linkedEvents: [],
    sources: [{ source: 'skermo_rfee', name: 'Torneo de prueba', url: null }],
    imageSource: null,
    circuitFie: null,
    datosExtraidos: [],
    ...over,
  };
}

describe('el rango honesto de un torneo', () => {
  /**
   * El fallo que el usuario marcó en el boceto: una Copa del Mundo salía como
   * «09 - 15 · LUN - DOM» cuando lo que se tira es el sábado y el domingo.
   * Decirle a un tirador «lunes a domingo» le hace pensar que compite siete
   * días y que tiene que pedir la semana entera en el trabajo.
   */
  it('manda la fecha de las pruebas, no el rango del cartel', () => {
    const e = evento({
      startDate: '2026-11-09',
      endDate: '2026-11-15',
      competitions: [
        prueba({ competitionDate: '2026-11-14' }),
        prueba({ competitionDate: '2026-11-15' }),
      ],
    });
    expect(rangoRealDeEvento(e)).toEqual({ desde: '2026-11-14', hasta: '2026-11-15' });
    expect(capsulaDeFecha(rangoRealDeEvento(e))).toEqual({
      dias: '14 - 15',
      mes: 'NOV',
      semana: 'SÁB - DOM',
    });
  });

  /**
   * Y si de verdad son siete días —un campeonato del mundo completo— entonces
   * sí se dicen siete. La regla no es «acortar», es «decir lo que hay».
   */
  it('un campeonato de siete días sigue durando siete días', () => {
    const e = evento({
      startDate: '2026-07-20',
      endDate: '2026-07-26',
      competitions: Array.from({ length: 7 }, (_, i) =>
        prueba({ competitionDate: `2026-07-${20 + i}` }),
      ),
    });
    expect(rangoRealDeEvento(e)).toEqual({ desde: '2026-07-20', hasta: '2026-07-26' });
  });

  /**
   * Sin fecha de prueba se cae al rango del evento. NO se inventa nada: es la
   * regla número uno del proyecto, y esto pasa de verdad —la fuente no siempre
   * publica la fecha de cada prueba—.
   */
  it('sin fecha de prueba usa el rango del evento y no se inventa una', () => {
    const e = evento({
      startDate: '2026-10-03',
      endDate: '2026-10-04',
      competitions: [prueba({ competitionDate: null })],
    });
    expect(rangoRealDeEvento(e)).toEqual({ desde: '2026-10-03', hasta: '2026-10-04' });
  });

  /**
   * Una fecha de prueba fuera del cartel no estira la cápsula cincuenta años.
   * Ha pasado con datos de la FIE mal normalizados y el resultado era una
   * tarjeta que decía «03 - 01 ENE».
   */
  it('acota al rango del evento una fecha de prueba absurda', () => {
    const e = evento({
      startDate: '2026-10-03',
      endDate: '2026-10-04',
      competitions: [prueba({ competitionDate: '1970-01-01' })],
    });
    expect(rangoRealDeEvento(e)).toEqual({ desde: '2026-10-03', hasta: '2026-10-04' });
  });
});

describe('los días de la semana', () => {
  it('el 3 y 4 de octubre de 2026 son sábado y domingo', () => {
    const ocupa = diasSemanaOcupados({ desde: '2026-10-03', hasta: '2026-10-04' });
    expect(ocupa).toEqual([false, false, false, false, false, true, true]);
    expect(esEntreSemana({ desde: '2026-10-03', hasta: '2026-10-04' })).toBe(false);
  });

  /**
   * El badge «Entre semana» tiene consecuencia práctica: un tirador tiene que
   * pedir permiso en el trabajo o faltar al instituto. Solo se marca cuando de
   * verdad no cae ni en sábado ni en domingo.
   */
  it('marca «entre semana» solo si no toca sábado ni domingo', () => {
    // Miércoles 14 de octubre de 2026.
    expect(esEntreSemana({ desde: '2026-10-14', hasta: '2026-10-14' })).toBe(true);
    // Viernes a domingo: hay fin de semana, no se marca.
    expect(esEntreSemana({ desde: '2026-10-16', hasta: '2026-10-18' })).toBe(false);
  });

  it('un rango de más de una semana ocupa los siete días', () => {
    expect(diasSemanaOcupados({ desde: '2026-10-05', hasta: '2026-10-20' })).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it('la semana empieza en lunes, no en domingo', () => {
    // Domingo 4 de octubre de 2026 pertenece a la semana del lunes 28 de sept.
    expect(lunesDeLaSemana('2026-10-04')).toBe('2026-09-28');
    expect(lunesDeLaSemana('2026-09-28')).toBe('2026-09-28');
  });
});

describe('un fin de semana con cinco competiciones es UN bloque', () => {
  /**
   * El caso real que el usuario señaló: el 3 y 4 de octubre de 2026 coinciden
   * Eurofence League, Liga Iberdrola, Liga de Oro, Liga de Plata y el TNR
   * absoluto. En la rejilla eran cinco barras en la misma casilla que
   * descuadraban el mes entero.
   */
  it('funde los cinco torneos del 3-4 de octubre', () => {
    const eventos = [
      evento({ name: 'Eurofence League', circuit: 'EFC_LEAGUE', scope: 'INTERNACIONAL' }),
      evento({ name: 'Liga Nacional Iberdrola 1ª Jornada', circuit: 'LIGA_ORO' }),
      evento({ name: 'Liga Nacional de Oro 1ª Jornada', circuit: 'LIGA_ORO' }),
      evento({
        name: 'Liga Nacional de Plata 1ª Jornada',
        circuit: 'LIGA_PLATA',
        startDate: '2026-10-04',
        endDate: '2026-10-04',
      }),
      evento({ name: 'TNR Absoluto', circuit: 'TNR' }),
    ];

    const bloques = agruparEnBloques(eventos);
    expect(bloques).toHaveLength(1);
    expect(bloques[0].eventos).toHaveLength(5);
    expect(bloques[0].rango).toEqual({ desde: '2026-10-03', hasta: '2026-10-04' });
    // Primero el internacional: es lo que decide un viaje y un billete.
    expect(bloques[0].eventos[0].name).toBe('Eurofence League');
  });

  /**
   * Y lo que NO se funde, que es la mitad importante de la regla: dos torneos
   * que no comparten ni un día son dos bloques. Fundirlos sería mentir.
   */
  it('no funde dos fines de semana distintos', () => {
    const bloques = agruparEnBloques([
      evento({ startDate: '2026-10-03', endDate: '2026-10-04' }),
      evento({ startDate: '2026-10-17', endDate: '2026-10-18' }),
    ]);
    expect(bloques).toHaveLength(2);
  });

  /**
   * Ni se funde un torneo largo con lo de la semana siguiente, aunque se
   * solapen. Si no, un campeonato del mundo de nueve días se tragaría los
   * torneos de las dos semanas que toca y la tarjeta diría «competición
   * múltiple» de cosas sin relación.
   */
  it('no se traga lo de la semana siguiente aunque se solape', () => {
    const bloques = agruparEnBloques([
      // Lunes 5 a martes 13 de octubre.
      evento({ name: 'Mundial', startDate: '2026-10-05', endDate: '2026-10-13' }),
      // Sábado 10: se solapa, pero es otra semana ISO.
      evento({ name: 'Liga de Oro', startDate: '2026-10-10', endDate: '2026-10-11' }),
    ]);
    expect(bloques).toHaveLength(2);
  });
});

describe('el hueco entre dos bloques', () => {
  /**
   * EL FALLO DEL BOCETO. En el boceto del usuario salía «1 semana libre (15
   * oct - 27 oct)» dos veces seguidas y en sitios donde no tocaba. Ni el
   * número ni las fechas cuadraban con nada porque el texto era fijo. Aquí el
   * hueco es, literalmente, del día siguiente al fin del bloque anterior al
   * día anterior al inicio del siguiente.
   */
  it('el rango sale de las fechas, no de un texto fijo', () => {
    const h = huecoEntre('2026-10-04', '2026-10-24');
    expect(h).not.toBeNull();
    expect(h!.desde).toBe('2026-10-05');
    expect(h!.hasta).toBe('2026-10-23');
    expect(h!.dias).toBe(19);
  });

  /**
   * «1 semana» para nueve días es mentira y se nota: quien cuenta los días en
   * el calendario ve que no cuadra y deja de creerse el resto de la pantalla.
   */
  it('nunca dice un número de semanas que no cuadre al contar', () => {
    expect(textoDeDuracion(7)).toBe('1 semana');
    expect(textoDeDuracion(8)).toBe('1 semana');
    expect(textoDeDuracion(9)).toBe('9 días');
    expect(textoDeDuracion(12)).toBe('12 días');
    expect(textoDeDuracion(13)).toBe('2 semanas');
    expect(textoDeDuracion(14)).toBe('2 semanas');
    expect(textoDeDuracion(15)).toBe('2 semanas');
    expect(textoDeDuracion(19)).toBe('19 días');
    expect(textoDeDuracion(21)).toBe('3 semanas');
  });

  /** Un parón de cuatro días no es un parón: un divisor ahí es ruido. */
  it('por debajo de una semana no pinta divisor', () => {
    expect(huecoEntre('2026-10-04', '2026-10-10')).toBeNull();
    expect(huecoEntre('2026-10-04', '2026-10-05')).toBeNull();
    // Dos bloques pegados: no hay hueco en absoluto.
    expect(huecoEntre('2026-10-04', '2026-10-04')).toBeNull();
  });

  it('el rango se escribe con el mes una sola vez cuando es el mismo', () => {
    expect(rangoCorto({ desde: '2026-10-15', hasta: '2026-10-27' })).toBe('15 – 27 oct');
    expect(rangoCorto({ desde: '2026-10-28', hasta: '2026-11-03' })).toBe(
      '28 oct – 3 nov',
    );
  });
});

describe('el reparto por meses', () => {
  /**
   * Un bloque cae en el mes de su primer día y solo ahí. Es lo contrario de lo
   * que hacía la rejilla, que partía la barra en dos columnas, y es a
   * propósito: media tarjeta no se puede leer.
   */
  it('un bloque a caballo entre dos meses sale una sola vez', () => {
    const bloques = agruparEnBloques([
      evento({ startDate: '2026-10-30', endDate: '2026-11-01' }),
    ]);
    expect(itemsDelMes(bloques, 2026, 9).filter((i) => i.tipo === 'bloque')).toHaveLength(
      1,
    );
    expect(itemsDelMes(bloques, 2026, 10)).toHaveLength(0);
  });

  /**
   * Y los divisores van **entre** bloques del mismo mes, uno por hueco y ni
   * uno más. El usuario marcó que en su boceto faltaba el de noviembre y que
   * otros salían repetidos; con esto las dos cosas quedan fijadas.
   */
  it('mete un divisor en cada hueco y ninguno de más', () => {
    const bloques = agruparEnBloques([
      evento({ startDate: '2026-10-03', endDate: '2026-10-04' }),
      // 19 días de hueco: divisor.
      evento({ startDate: '2026-10-24', endDate: '2026-10-25' }),
      // Al fin de semana siguiente: 5 días, sin divisor.
      evento({ startDate: '2026-10-31', endDate: '2026-10-31' }),
    ]);
    const items = itemsDelMes(bloques, 2026, 9);
    expect(items.map((i) => i.tipo)).toEqual(['bloque', 'hueco', 'bloque', 'bloque']);
    expect(items.filter((i) => i.tipo === 'hueco')).toHaveLength(1);
  });

  it('un mes sin competiciones no devuelve nada, ni un hueco suelto', () => {
    const bloques = agruparEnBloques([
      evento({ startDate: '2026-10-03', endDate: '2026-10-04' }),
    ]);
    // Septiembre de 2026 está vacío de verdad en el calendario real.
    expect(itemsDelMes(bloques, 2026, 8)).toEqual([]);
  });
});
