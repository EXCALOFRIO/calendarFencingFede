import { describe, expect, it } from 'vitest';
import { esCampoExtraidoVigente, etiquetaDeCampo } from '@/lib/ai/campos';
import {
  aPropuestas,
  esDatoDeAlojamiento,
  esquemaExtraccion,
  pareceAlojamiento,
  pareceContenerDatosPersonales,
  rangoDeAlojamiento,
  verificarPropuestas,
} from '@/lib/ai/extract';
import { urlDeInvitacion } from '@/lib/ingest/sources/fie';

/**
 * ===========================================================================
 * LO QUE TRAE EL DOSSIER DE LA FIE, Y LO QUE NO SE QUIERE DE ÉL
 * ===========================================================================
 *
 * Hasta ahora la extracción se había probado con circulares de la RFEE: un
 * pabellón, una cuota, un plazo y cuatro horas. El dossier de la FIE es otra
 * cosa —catorce páginas, horario día por día, cuotas por categoría, cupos,
 * árbitros con multa— y trae además un apartado que el usuario ha pedido
 * expresamente que NO se extraiga: los hoteles recomendados.
 *
 * QUÉ SE PRUEBA AQUÍ, Y POR QUÉ ESTAS TRES COSAS
 * ----------------------------------------------
 *  1. EL FILTRO DE ALOJAMIENTO, que es el que tiene que ser de código y no una
 *     frase en el prompt. La prueba que importa es la del «check-in: 3:00 PM»:
 *     una hora bien formada, con una cita CIERTA del documento, que sin el
 *     filtro acabaría pintada en la línea del día como si el pabellón abriera
 *     a las tres de la tarde. La verificación de citas no puede tumbarla,
 *     porque la frase existe de verdad.
 *  2. EL REPARTO DEL HORARIO POR DÍA. Un dossier de cuatro días repite «7:30
 *     Venue Open» cuatro veces. Si las cuatro acabaran en la misma clave,
 *     sobreviviría una y los otros tres días se perderían en silencio, que es
 *     el peor fallo posible: no se ve mirando la ficha.
 *  3. QUE LAS CUOTAS POR CATEGORÍA NO SE PISEN. «Cadet individual: 30 EUR» y
 *     «Junior individual: 40 EUR» son las dos `tipo: individual`. Antes las dos
 *     iban a la clave `fee_eur` y la júnior se caía.
 *
 * POR QUÉ EL DOCUMENTO DE PRUEBA NO ES EL PDF DE LA FIE
 * ----------------------------------------------------
 * Los términos de la FIE prohíben almacenar su contenido sin permiso escrito,
 * y este proyecto se lo toma en serio: de la FIE se guarda la URL y se enlaza,
 * nunca el fichero (ver la cabecera de `src/lib/ingest/sources/fie.ts`). Meter
 * las 8.685 caracteres de su invitación en un fixture del repositorio sería
 * justo lo contrario. Así que el documento de abajo está ESCRITO para este
 * test, con la misma forma, el mismo idioma y las mismas trampas que el real
 * —el horario en tabla, el «Entrance to the Venue» separado de la sede, el
 * bloque de hoteles con sus tarifas y su check-in—, pero es nuestro.
 *
 * La comprobación contra el PDF de verdad se hace aparte y con red, con
 * `tests/extraccion-real.mts`, que es la herramienta que ya existe para eso.
 */

const DOSSIER_FIE = [
  'Cadet and Junior Foil World Cup Someplace 2026',
  'From October 8 to 11',
  '',
  'Organizers:',
  'Someplace Fencing Federation',
  'Avenue of the Air - Gate 3 - NOC',
  '',
  'Competition Venue:',
  'VELODROME - SPORTS PARK (GATE 7)',
  'Entrance to the Venue: Main Street N 1308, Someplace',
  '',
  'Schedule of the Competition:',
  'Wednesday 7 October 16:00 - 20:00 Registration / Weapon Control',
  'Thursday 8 October 7:30 Venue Open',
  "9:00 Men's and Women's Pools Cadet",
  '17:00 Semi Final and Final',
  'Friday 9 October 7:30 Venue Open',
  '8:00 Weapon Control Start',
  "9:00 Men's Pools Junior",
  'Sunday 11 October 9:00 Start of the Team Event',
  '',
  'Entry Fee',
  'Cadet individual event: 30 EUR',
  'Junior individual event: 40 EUR',
  'Team event: 150 EUR',
  'The fee must be paid in cash during the registration process before the start of the Event.',
  '',
  'Participation',
  'Each national federation may enter a maximum of 12 fencers. For Individual',
  'World Cup competitions outside Europe, the organizing country may enter up to 30 fencers.',
  '',
  'Entry',
  'Open to all fencers with valid 2026-2027 FIE License.',
  '',
  'Referee Obligation:',
  'Delegations not respecting the quota must pay a fine of EUR 1,000 per referee.',
  '1-4 fencers No referee required',
  '5-9 fencers 1 referee',
  '10 or more 2 referees',
  '',
  'Accommodation:',
  'GRAND HOTEL SOMEPLACE',
  'Adress: Seaside Avenue 1140, Someplace',
  'Category Simple Double',
  'Standard 90 USD 105 USD',
  'Rates are expressed in U.S. dollars per room, per night.',
  'Check-in: 3:00 PM | Check-out: 12:00 PM.',
  'Buffet breakfast served at the restaurant.',
].join('\n');

// ---------------------------------------------------------------------------
// 1. El alojamiento no se extrae, y lo decide un `if`
// ---------------------------------------------------------------------------

describe('el alojamiento se descarta en código, no confiando en el prompt', () => {
  it('reconoce las frases del bloque de hoteles', () => {
    const frases = [
      'GRAND HOTEL SOMEPLACE',
      'Rates are expressed in U.S. dollars per room, per night.',
      'Buffet breakfast served at the restaurant.',
      'Accommodation:',
      'El hotel oficial del torneo ofrece media pensión',
      'precio por habitación doble en régimen de alojamiento y desayuno',
      'NOVOTEL LIMA',
    ];
    for (const frase of frases) {
      expect(pareceAlojamiento(frase, ''), frase).toBe(true);
    }
  });

  it('«check in» NO es palabra de hotel: en esgrima es la llamada', () => {
    /**
     * Estuvo en la lista y hubo que sacarla. La invitación del Satélite de
     * Dublín 2026 publica su horario como «Saturday 5th September Check in
     * closes Event starts / Men's Épée 0900 0930»: ahí «check in» es la
     * confirmación de tiradores, y el filtro se llevaba por delante la hora de
     * inicio de las dos pruebas del torneo.
     */
    const horario = "Saturday 5th September Check in closes Event starts Men's Épée 0900 0930";
    expect(pareceAlojamiento(horario, '09:30')).toBe(false);
    expect(esDatoDeAlojamiento(horario, '09:30', DOSSIER_FIE)).toBe(false);

    // Y el check-in del hotel se sigue descartando, pero por el apartado del
    // que sale, no por sus palabras.
    const hotel = 'Check-in: 3:00 PM | Check-out: 12:00 PM.';
    expect(pareceAlojamiento(hotel, '15:00')).toBe(false);
    expect(esDatoDeAlojamiento(hotel, '15:00', DOSSIER_FIE)).toBe(true);
  });

  it('un encabezado en plural cierra el apartado de alojamiento', () => {
    /**
     * «Referees» no casaba con «referee» y el apartado no se cerraba nunca:
     * la multa de 1.000 € y el horario que venían detrás se descartaban como
     * si fueran del hotel. Pasó con el PDF real de Dublín.
     */
    const conPlural = [
      'Accommodation',
      'Nearby hotels',
      'Carlton Hotel Blanchardstown',
      'Referees',
      'the delegation must pay a fine of EUR 1,000 per missing referee',
    ].join('\n');
    const rango = rangoDeAlojamiento(conPlural);
    expect(rango).not.toBeNull();
    expect(conPlural.slice(rango?.desde, rango?.hasta)).not.toContain('fine of EUR 1,000');
    expect(
      esDatoDeAlojamiento(
        'the delegation must pay a fine of EUR 1,000 per missing referee',
        '1000.00',
        conPlural,
      ),
    ).toBe(false);
  });

  it('NO confunde con alojamiento lo que es competición', () => {
    const frases = [
      'VELODROME - SPORTS PARK (GATE 7)',
      'Entrance to the Venue: Main Street N 1308, Someplace',
      'Cadet individual event: 30 EUR',
      'Thursday 8 October 7:30 Venue Open',
      'Each national federation may enter a maximum of 12 fencers',
      // La trampa del `includes`: «ibis» vive dentro de «Ibiza». Con frontera
      // de palabra, un torneo en Ibiza no se queda sin sede.
      'Pabellón Es Raspallar, Ibiza',
      'Trofeo Ciudad de Ibiza',
    ];
    for (const frase of frases) {
      expect(pareceAlojamiento(frase, ''), frase).toBe(false);
    }
  });

  it('el «check-in: 3:00 PM» NO llega a la cola, aunque su cita sea cierta', () => {
    /**
     * Este es el caso que justifica todo el filtro. La cita está en el
     * documento palabra por palabra, así que `verificarCita` la da por buena;
     * lo único que lo distingue de la apertura del pabellón es de qué apartado
     * sale.
     *
     * Y el hotel va PRIMERO a propósito: las dos horas son del día 8, así que
     * las dos quieren la clave `installation_open.2026-10-08`. Si la del hotel
     * se la quedara, la apertura de verdad se caería por repetida sin dejar
     * rastro. Por eso `aPropuestas` recibe el texto del documento, que es lo
     * que hace en producción (`extraerDeTexto`).
     */
    const propuestas = aPropuestas(
      esquemaExtraccion.parse({
        competiciones: [],
        plazos: [],
        cuotas: [],
        horarios: [
          {
            etiqueta: 'apertura_instalacion',
            hora: '15:00',
            fecha: '2026-10-08',
            cita: 'Check-in: 3:00 PM | Check-out: 12:00 PM.',
          },
          {
            etiqueta: 'apertura_instalacion',
            hora: '07:30',
            fecha: '2026-10-08',
            cita: 'Thursday 8 October 7:30 Venue Open',
          },
        ],
        categoriasAdmitidas: [],
        enlaces: [],
      }),
      DOSSIER_FIE,
    );
    expect(propuestas).toHaveLength(2);

    const { verificadas, descartadas } = verificarPropuestas(propuestas, DOSSIER_FIE);

    expect(verificadas).toHaveLength(1);
    expect(verificadas[0].proposedValue).toBe('07:30');
    expect(descartadas).toHaveLength(1);
    expect(descartadas[0].proposedValue).toBe('15:00');
    expect(descartadas[0].motivoDescarte).toMatch(/alojamiento/i);
  });

  it('tira la tarifa del hotel y la dirección del hotel, con su motivo', () => {
    /**
     * La tarifa del hotel se etiqueta de 'acompanante', y no es un capricho del
     * test: desde la versión 4 del esquema NO EXISTE el tipo 'otro' (ver
     * `TIPOS_CUOTA`), así que un modelo que quiera colar una tarifa de hotel
     * tiene que ponerle uno de los cinco tipos que quedan. Este test comprueba
     * justo eso: que cuando lo hace, el filtro de alojamiento la tumba
     * igualmente. Si en su lugar pusiera 'otro', el elemento no validaría y la
     * segunda barrera no se estaría probando.
     */
    const datos = esquemaExtraccion.parse({
      competiciones: [],
      plazos: [],
      cuotas: [
        {
          tipo: 'acompanante',
          importeEur: 105,
          concepto: 'Standard Double',
          cita: 'Standard 90 USD 105 USD',
        },
        { tipo: 'individual', importeEur: 30, categoria: 'cadete', cita: 'Cadet individual event: 30 EUR' },
      ],
      sede: { nombre: 'GRAND HOTEL SOMEPLACE', cita: 'GRAND HOTEL SOMEPLACE' },
      horarios: [],
      categoriasAdmitidas: [],
      enlaces: [],
    });
    const { verificadas, descartadas } = verificarPropuestas(aPropuestas(datos), DOSSIER_FIE);

    expect(verificadas.map((p) => p.field)).toEqual(['fee_eur.m17']);
    expect(descartadas.map((p) => p.field).sort()).toEqual([
      'fee_concept.acompanante',
      'fee_eur.acompanante',
      'venue',
    ]);
    for (const p of descartadas) expect(p.motivoDescarte).toMatch(/alojamiento/i);
  });

  it('el ÍNDICE del documento no abre el apartado de alojamiento', () => {
    /**
     * Lo descubrió el primer dossier en Word que se leyó, el de Orán, y sin
     * arreglarlo el filtro de alojamiento se quedaba en nada en cualquier
     * documento con índice. Word genera índices, así que no es un caso raro.
     *
     * El documento empieza con «ACCOMMODATION & TRANSPORT 5» en el índice, y
     * `rangoDeAlojamiento` se queda con el PRIMER encabezado que abre. Medido
     * contra el `.docx` real: el apartado se abría en el carácter 224 y se
     * cerraba 28 caracteres después, en la siguiente línea del índice. El
     * apartado de verdad, que está en el 5.569, se quedaba sin cubrir.
     */
    const conIndice = [
      'Table of Contents',
      'ENTRY FEES 4',
      'ACCOMMODATION & TRANSPORT 5',
      'VISA SUPPORT 6',
      '',
      'ENTRY FEES',
      'Individual: 80 EUR',
      '',
      'ACCOMMODATION & TRANSPORT',
      'Double room 109 EUR per night',
      '',
      'VISA SUPPORT',
      'All visa requests must be initiated through the platform.',
    ].join('\n');

    const rango = rangoDeAlojamiento(conIndice);
    expect(rango).not.toBeNull();
    const apartado = conIndice.slice(rango?.desde ?? 0, rango?.hasta ?? 0);
    // El apartado que se coge es el DE VERDAD, no el del índice.
    expect(apartado).toContain('Double room 109 EUR per night');
    expect(apartado).not.toContain('Individual: 80 EUR');

    // Y por tanto la tarifa cae y la cuota buena no.
    expect(esDatoDeAlojamiento('Double room 109 EUR per night', '109.00', conIndice)).toBe(
      true,
    );
    expect(esDatoDeAlojamiento('Individual: 80 EUR', '80.00', conIndice)).toBe(false);
  });

  it('un año al final de un encabezado no lo convierte en línea de índice', () => {
    // Se exigen de una a tres cifras para tomarlo por número de página: un año
    // tiene cuatro y «TRANSPORTE 2026» sigue siendo un encabezado.
    const texto = ['ACCOMMODATION', 'Room 90 EUR', 'TRANSPORTE 2026', 'Bus al pabellón'].join(
      '\n',
    );
    const rango = rangoDeAlojamiento(texto);
    expect(texto.slice(rango?.desde ?? 0, rango?.hasta ?? 0)).not.toContain('Bus al pabellón');
  });

  it('una tarifa de hotel SIN palabras de hotel también cae, por el apartado del que sale', () => {
    /**
     * «Standard 90 USD 105 USD» no lleva ni «hotel» ni «habitación» ni
     * «noche»: el filtro de vocabulario no la ve. Lo que la delata es DÓNDE
     * está, dentro del apartado «Accommodation». Sin esta segunda mitad del
     * filtro, esa cifra acabó de verdad como importe en la primera pasada.
     */
    expect(pareceAlojamiento('Standard 90 USD 105 USD', '105.00')).toBe(false);
    expect(esDatoDeAlojamiento('Standard 90 USD 105 USD', '105.00', DOSSIER_FIE)).toBe(true);

    const rango = rangoDeAlojamiento(DOSSIER_FIE);
    expect(rango).not.toBeNull();
    expect(DOSSIER_FIE.slice(rango?.desde ?? 0)).toContain('GRAND HOTEL SOMEPLACE');
    // Y lo de antes del apartado sigue fuera de él.
    expect(esDatoDeAlojamiento('Cadet individual event: 30 EUR', '30.00', DOSSIER_FIE)).toBe(
      false,
    );
  });

  it('el hotel NO le roba la clave al dato bueno, aunque venga primero', () => {
    /**
     * El caso que se vio con el PDF de Lima de verdad: `aPropuestas` se queda
     * con el primer dato de cada clave, así que una tarifa de hotel colocada
     * antes que la cuota real se llevaba `fee_eur.otro`, se descartaba después
     * por alojamiento, y la buena había desaparecido EN SILENCIO por
     * repetida. Por eso `aPropuestas` recibe el texto del documento.
     */
    const datos = esquemaExtraccion.parse({
      competiciones: [],
      plazos: [],
      cuotas: [
        // Primero la del hotel, que es el orden malo.
        {
          tipo: 'acompanante',
          importeEur: 105,
          concepto: 'Standard Double',
          cita: 'Standard 90 USD 105 USD',
        },
        {
          tipo: 'acompanante',
          importeEur: 40,
          concepto: 'Recargo',
          cita: 'Junior individual event: 40 EUR',
        },
      ],
      horarios: [],
      categoriasAdmitidas: [],
      enlaces: [],
    });

    const { verificadas } = verificarPropuestas(aPropuestas(datos, DOSSIER_FIE), DOSSIER_FIE);
    expect(verificadas.find((p) => p.field === 'fee_eur.acompanante')?.proposedValue).toBe(
      '40.00',
    );
  });

  it('el esquema ya no admite «alojamiento» ni «otro» como tipo de cuota', () => {
    /**
     * Primera de las dos barreras: el elemento con ese tipo ni valida, así que
     * `listaTolerante` lo tira antes de que nadie mire la cita. La segunda es
     * `pareceAlojamiento`, para cuando el modelo lo etiquete de otra cosa.
     *
     * 'otro' se retiró en la versión 4 por lo mismo que 'alojamiento' en la 3:
     * porque en la cola de revisión TODO lo que produjo era basura (una tasa
     * turística de 0,99 € por persona y noche, un suplemento de habitación
     * individual, el precio de una entrada al público). Era un cajón donde el
     * modelo metía cualquier cifra con un € al lado.
     *
     * Ojo: el 'otro' de las FORMAS DE PAGO y el de los ENLACES siguen vivos y
     * significan algo. Lo que se retira es el tipo de CUOTA.
     */
    const datos = esquemaExtraccion.parse({
      competiciones: [],
      plazos: [],
      cuotas: [
        { tipo: 'alojamiento', importeEur: 90, cita: 'Standard 90 USD 105 USD' },
        { tipo: 'otro', importeEur: 0.99, cita: 'Tasa turística no incluida: 0,99 euros' },
        { tipo: 'individual', importeEur: 80, cita: 'Individual: 80 EUR' },
      ],
      horarios: [],
      categoriasAdmitidas: [],
      enlaces: [
        { tipo: 'alojamiento', url: 'https://hotel.example/reservas', cita: 'reservas en hotel.example' },
        { tipo: 'inscripcion', url: 'https://fie.org', cita: 'Entries can only be made at the FIE website' },
      ],
    });
    // Solo sobrevive la individual: las otras dos ni validan.
    expect(datos.cuotas.map((c) => c.tipo)).toEqual(['individual']);
    expect(datos.enlaces.map((e) => e.tipo)).toEqual(['inscripcion']);
  });

  it('los campos que el extractor ya no genera no llegan a ninguna ficha', () => {
    /**
     * La tercera barrera, y la única que sirve para lo que YA está escrito en
     * la base. Los dos importes que el usuario vio en la ficha —«109 € ·
     * alojamiento», que es el precio de una habitación doble de uso individual,
     * y «0,99 € · otro», que es una tasa turística— son filas de la versión 2
     * del esquema. El filtro de extracción no puede tocarlas porque actúa al
     * leer el documento, y esas filas ya estaban leídas.
     *
     * `esCampoExtraidoVigente` es lo que las quita de la ficha, y se consulta
     * en `cargarDatosExtraidos`.
     */
    expect(esCampoExtraidoVigente('fee_eur.alojamiento')).toBe(false);
    expect(esCampoExtraidoVigente('fee_concept.alojamiento')).toBe(false);
    expect(esCampoExtraidoVigente('link.alojamiento')).toBe(false);
    expect(esCampoExtraidoVigente('link.alojamiento.hotel-example')).toBe(false);
    expect(esCampoExtraidoVigente('fee_eur.otro')).toBe(false);
    expect(esCampoExtraidoVigente('fee_concept.otro')).toBe(false);

    // Y lo que sí sigue vivo no se lleva por delante.
    for (const campo of [
      'fee_eur',
      'fee_eur.equipos',
      'fee_eur.m17',
      'fee_eur.acompanante',
      'fee_concept',
      'payment_method',
      'payment_method.otro',
      'link.otro',
      'link.inscripcion',
      'venue',
      'venue_plus_code',
      'min_age',
    ]) {
      expect(esCampoExtraidoVigente(campo)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. El horario, día por día
// ---------------------------------------------------------------------------

describe('el horario se reparte por día y por hito', () => {
  const datos = esquemaExtraccion.parse({
    competiciones: [],
    plazos: [],
    cuotas: [],
    horarios: [
      { etiqueta: 'acreditacion', hora: '16:00', fecha: '2026-10-07', cita: 'Wednesday 7 October 16:00 - 20:00 Registration / Weapon Control' },
      { etiqueta: 'apertura_instalacion', hora: '07:30', fecha: '2026-10-08', cita: 'Thursday 8 October 7:30 Venue Open' },
      { etiqueta: 'poules', hora: '09:00', fecha: '2026-10-08', prueba: 'florete cadete', cita: "9:00 Men's and Women's Pools Cadet" },
      { etiqueta: 'final', hora: '17:00', fecha: '2026-10-08', cita: '17:00 Semi Final and Final' },
      { etiqueta: 'apertura_instalacion', hora: '07:30', fecha: '2026-10-09', cita: 'Friday 9 October 7:30 Venue Open' },
      { etiqueta: 'control_de_armas', hora: '08:00', fecha: '2026-10-09', cita: '8:00 Weapon Control Start' },
      { etiqueta: 'poules', hora: '09:00', fecha: '2026-10-09', prueba: 'florete junior', cita: "9:00 Men's Pools Junior" },
      { etiqueta: 'equipos', hora: '09:00', fecha: '2026-10-11', cita: '9:00 Start of the Team Event' },
    ],
    categoriasAdmitidas: [],
    enlaces: [],
  });

  it('las dos aperturas de días distintos son dos campos, no uno', () => {
    const { verificadas } = verificarPropuestas(aPropuestas(datos), DOSSIER_FIE);
    const aperturas = verificadas.filter((p) => p.field.startsWith('installation_open'));
    expect(aperturas.map((p) => p.field)).toEqual([
      'installation_open.2026-10-08',
      'installation_open.2026-10-09',
    ]);
    // Y con esto la ficha puede agrupar por jornada sin partir la clave.
    expect(aperturas.map((p) => p.fecha)).toEqual(['2026-10-08', '2026-10-09']);
  });

  it('los seis hitos nuevos tienen su propia clave y su nombre en castellano', () => {
    const { verificadas } = verificarPropuestas(aPropuestas(datos), DOSSIER_FIE);
    const porCampo = new Map(verificadas.map((p) => [p.field, p]));

    expect([...porCampo.keys()].sort()).toEqual(
      [
        'accreditation.2026-10-07',
        'final_start.2026-10-08',
        'installation_open.2026-10-08',
        'installation_open.2026-10-09',
        'pools_start.2026-10-08.florete-cadete',
        'pools_start.2026-10-09.florete-junior',
        'teams_start.2026-10-11',
        'weapon_control.2026-10-09',
      ].sort(),
    );

    expect(etiquetaDeCampo('accreditation.2026-10-07')).toBe('Acreditación · 2026-10-07');
    expect(etiquetaDeCampo('weapon_control.2026-10-09')).toBe('Control de armas · 2026-10-09');
    expect(etiquetaDeCampo('pools_start.2026-10-08.florete-cadete')).toBe(
      'Poules · 2026-10-08 florete cadete',
    );
    expect(etiquetaDeCampo('final_start.2026-10-08')).toBe('Final · 2026-10-08');
    expect(etiquetaDeCampo('teams_start.2026-10-11')).toBe('Prueba por equipos · 2026-10-11');
    expect(etiquetaDeCampo('semifinals_start')).toBe('Semifinales');
  });

  it('la fecha ISO no se despedaza en la etiqueta', () => {
    // Antes esto decía «Inicio · 2026 10 04 florete masculino»: la fecha
    // partida en tres números por el guion.
    expect(etiquetaDeCampo('start_time.2026-10-04.florete-masculino')).toBe(
      'Inicio · 2026-10-04 florete masculino',
    );
  });

  it('la hora sigue conservando la prueba tal como la nombra el documento', () => {
    const { verificadas } = verificarPropuestas(aPropuestas(datos), DOSSIER_FIE);
    const poules = verificadas.find((p) => p.field.startsWith('pools_start.2026-10-09'));
    expect(poules?.prueba).toBe('florete junior');
  });
});

// ---------------------------------------------------------------------------
// 3. Los campos nuevos: cuota por categoría, acceso, cupo, árbitros
// ---------------------------------------------------------------------------

describe('los campos que solo trae el dossier de la FIE', () => {
  const datos = esquemaExtraccion.parse({
    competiciones: [],
    plazos: [],
    cuotas: [
      { tipo: 'individual', importeEur: 30, categoria: 'Cadet', cita: 'Cadet individual event: 30 EUR' },
      { tipo: 'individual', importeEur: 40, categoria: 'Junior', cita: 'Junior individual event: 40 EUR' },
      { tipo: 'equipos', importeEur: 150, cita: 'Team event: 150 EUR' },
    ],
    formasDePago: [
      {
        metodo: 'efectivo',
        cita: 'The fee must be paid in cash during the registration process before the start of the Event.',
      },
    ],
    sede: {
      nombre: 'VELODROME - SPORTS PARK (GATE 7)',
      cita: 'VELODROME - SPORTS PARK (GATE 7)',
    },
    acceso: {
      descripcion: 'Main Street N 1308, Someplace',
      cita: 'Entrance to the Venue: Main Street N 1308, Someplace',
    },
    organizador: {
      nombre: 'Someplace Fencing Federation',
      direccion: 'Avenue of the Air - Gate 3 - NOC',
      cita: 'Someplace Fencing Federation',
    },
    cupos: [
      { ambito: 'federacion', maximo: 12, cita: 'Each national federation may enter a maximum of 12 fencers.' },
      { ambito: 'anfitrion', maximo: 30, cita: 'the organizing country may enter up to 30 fencers' },
    ],
    requisitos: [
      { texto: 'Licencia FIE 2026-2027 en vigor', cita: 'Open to all fencers with valid 2026-2027 FIE License.' },
    ],
    arbitros: [
      { tiradoresDesde: 1, tiradoresHasta: 4, arbitros: 0, cita: '1-4 fencers No referee required' },
      { tiradoresDesde: 5, tiradoresHasta: 9, arbitros: 1, cita: '5-9 fencers 1 referee' },
      { tiradoresDesde: 10, tiradoresHasta: null, arbitros: 2, cita: '10 or more 2 referees' },
    ],
    multaArbitro: {
      importeEur: 1000,
      cita: 'Delegations not respecting the quota must pay a fine of EUR 1,000 per referee.',
    },
    horarios: [],
    categoriasAdmitidas: [],
    enlaces: [],
  });

  const { verificadas, descartadas } = verificarPropuestas(aPropuestas(datos), DOSSIER_FIE);
  const valor = (campo: string) => verificadas.find((p) => p.field === campo)?.proposedValue;

  it('no se descarta nada: todas las citas están en el documento', () => {
    expect(descartadas).toEqual([]);
  });

  it('la cuota cadete y la júnior conviven en vez de pisarse', () => {
    expect(valor('fee_eur.m17')).toBe('30.00');
    expect(valor('fee_eur.m20')).toBe('40.00');
    expect(valor('fee_eur.equipos')).toBe('150.00');
    expect(etiquetaDeCampo('fee_eur.m17')).toBe('Cuota · cadete');
    expect(etiquetaDeCampo('fee_eur.m20')).toBe('Cuota · júnior');
    expect(etiquetaDeCampo('fee_eur.equipos')).toBe('Cuota por equipos');
  });

  it('la categoría viaja como «prueba» para que el dato llegue a su prueba', () => {
    // `repartirDatosExtraidos` en `src/lib/queries/calendar.ts` usa este texto
    // para decidir a qué prueba del evento va la cuota.
    expect(verificadas.find((p) => p.field === 'fee_eur.m17')?.prueba).toBe('Cadet');
    expect(verificadas.find((p) => p.field === 'fee_eur.m20')?.prueba).toBe('Junior');
  });

  it('el acceso es un campo aparte de la sede y de la dirección', () => {
    expect(valor('venue')).toBe('VELODROME - SPORTS PARK (GATE 7)');
    expect(valor('venue_access')).toBe('Main Street N 1308, Someplace');
    expect(etiquetaDeCampo('venue_access')).toBe('Acceso al pabellón');
  });

  it('el cupo por federación y el del anfitrión no son el mismo dato', () => {
    expect(valor('entry_quota')).toBe('12');
    expect(valor('entry_quota.anfitrion')).toBe('30');
    expect(etiquetaDeCampo('entry_quota')).toBe('Cupo por federación');
    expect(etiquetaDeCampo('entry_quota.anfitrion')).toBe('Cupo del país anfitrión');
  });

  it('la obligación de árbitros conserva los tramos y se lee en castellano', () => {
    expect(valor('referee_quota.1-4')).toBe('0');
    expect(valor('referee_quota.5-9')).toBe('1');
    expect(valor('referee_quota.10-mas')).toBe('2');
    expect(valor('referee_fine_eur')).toBe('1000.00');
    expect(etiquetaDeCampo('referee_quota.1-4')).toBe('Árbitros obligatorios · de 1 a 4');
    expect(etiquetaDeCampo('referee_quota.10-mas')).toBe('Árbitros obligatorios · 10 o más');
    expect(etiquetaDeCampo('referee_fine_eur')).toBe('Multa por árbitro que falte');
  });

  it('«0 árbitros» se publica: de 1 a 4 tiradores NO hace falta ninguno', () => {
    // Un cero aquí es una respuesta, no un hueco relleno por el modelo, así
    // que `valorDiceAlgo` no lo puede tumbar. Es justo lo contrario del
    // recargo de 0 € que sí se descarta en los plazos.
    expect(verificadas.some((p) => p.field === 'referee_quota.1-4')).toBe(true);
  });

  it('la forma de pago se dice en castellano y el detalle queda en la cita', () => {
    expect(valor('payment_method')).toBe('En efectivo');
    expect(etiquetaDeCampo('payment_method')).toBe('Forma de pago');
    expect(
      verificadas.find((p) => p.field === 'payment_method')?.quote,
    ).toContain('in cash during the registration process');
  });

  it('DOS formas de pago conviven: Orán admite efectivo O transferencia', () => {
    /**
     * El caso real, y el motivo de que `formasDePago` sea una lista. La
     * invitación de Orán dice:
     *
     *   «Entry Fees may be paid in cash at registration on the first day of the
     *    competition before the start of the event OR by bank transfer»
     *
     * Con un solo `metodo` había que elegir una de las dos y callarse la otra,
     * y las dos mitades son media verdad: quien se fiara de «En efectivo» podía
     * llegar a Argelia con 80 € encima sin saber que podía haber transferido.
     */
    const cita =
      'Entry Fees may be paid in cash at registration on the first day of the ' +
      'competition before the start of the event OR by bank transfer';
    const dos = esquemaExtraccion.parse({
      competiciones: [],
      plazos: [],
      cuotas: [],
      formasDePago: [
        { metodo: 'efectivo', cita },
        { metodo: 'transferencia', cita },
      ],
      horarios: [],
      categoriasAdmitidas: [],
      enlaces: [],
    });
    const propuestas = aPropuestas(dos, cita);

    expect(propuestas.map((p) => p.field)).toEqual([
      'payment_method',
      'payment_method.transferencia',
    ]);
    expect(propuestas.map((p) => p.proposedValue)).toEqual([
      'En efectivo',
      'Por transferencia',
    ]);
    // Las dos se rotulan igual: el método ya está dentro del valor.
    expect(etiquetaDeCampo('payment_method.transferencia')).toBe('Forma de pago');
    // Y las dos llevan su cita, que es lo que permite verificarlas.
    const { verificadas: dosOk, descartadas: nada } = verificarPropuestas(propuestas, cita);
    expect(nada).toEqual([]);
    expect(dosOk).toHaveLength(2);
  });

  it('una forma de pago repetida no entra dos veces', () => {
    const cita = 'The fee must be paid in cash during the registration process';
    const repetida = esquemaExtraccion.parse({
      competiciones: [],
      plazos: [],
      cuotas: [],
      formasDePago: [
        { metodo: 'efectivo', cita },
        { metodo: 'efectivo', cita },
      ],
      horarios: [],
      categoriasAdmitidas: [],
      enlaces: [],
    });
    expect(aPropuestas(repetida, cita).map((p) => p.field)).toEqual(['payment_method']);
  });

  it('el organizador llega con su dirección y SIN correo', () => {
    expect(valor('organizer')).toBe('Someplace Fencing Federation');
    expect(valor('organizer_address')).toBe('Avenue of the Air - Gate 3 - NOC');
    // El correo no está porque `redactarDatosDeContacto` lo tacha antes de que
    // el texto salga de aquí: el esquema no tiene dónde ponerlo, a propósito.
    expect(verificadas.some((p) => p.field.includes('email'))).toBe(false);
  });

  it('el requisito se pinta «Requisito», sin repetir su propio texto', () => {
    const requisito = verificadas.find((p) => p.field.startsWith('entry_requirement'));
    expect(requisito?.proposedValue).toBe('Licencia FIE 2026-2027 en vigor');
    expect(etiquetaDeCampo(requisito?.field ?? '')).toBe('Requisito');
  });
});

// ---------------------------------------------------------------------------
// 4. El cortafuegos de privacidad sigue cerrado
// ---------------------------------------------------------------------------

describe('el cortafuegos de datos personales no se ha aflojado', () => {
  it('un dossier con lista nominal de convocados sigue bloqueado', () => {
    const conNombres = [
      'CIRCULAR 41/26 - CONVOCATORIA COPA DEL MUNDO CADETE',
      'La Real Federación Española de Esgrima ha seleccionado para participar a los siguientes deportistas:',
      'Garcia Perez Lucia',
      'Martinez Ruiz Elena',
      'Fernandez Lopez Marta',
      'Sanchez Gomez Alba',
      'Rodriguez Diaz Carla',
      'Gonzalez Moreno Sara',
    ].join('\n');
    const deteccion = pareceContenerDatosPersonales(conNombres);
    expect(deteccion.contieneDatosPersonales).toBe(true);
  });

  it('el dossier de un torneo internacional sí se puede leer', () => {
    // Si el cortafuegos bloqueara también esto, la funcionalidad entera
    // sobraría: son los documentos que de verdad interesan.
    const deteccion = pareceContenerDatosPersonales(DOSSIER_FIE);
    expect(deteccion.contieneDatosPersonales).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. La URL del PDF de la FIE
// ---------------------------------------------------------------------------

describe('la invitación de la FIE se enlaza, nunca se copia', () => {
  it('codifica los espacios que la FIE sirve sin codificar', () => {
    expect(
      urlDeInvitacion(
        'https://static.fie.org/uploads/41/205601-Invitation Cadet and Junior Foil Worldcup Lima 2026_updated.pdf',
      ),
    ).toBe(
      'https://static.fie.org/uploads/41/205601-Invitation%20Cadet%20and%20Junior%20Foil%20Worldcup%20Lima%202026_updated.pdf',
    );
  });

  it('no vuelve a escapar lo que ya viene codificado', () => {
    // `encodeURI` sobre una URL con `%20` daría `%2520`, que es un 404.
    const ya = 'https://static.fie.org/uploads/41/205601-Invitation%20Cadet.pdf';
    expect(urlDeInvitacion(ya)).toBe(ya);
  });

  it('solo acepta documentos servidos por HTTPS', () => {
    expect(urlDeInvitacion('https://fie.org/tournaments/2027/111')).toBeNull();
    expect(urlDeInvitacion('http://static.fie.org/x.pdf')).toBeNull();
    expect(urlDeInvitacion('no es una url.pdf')).toBeNull();
    expect(urlDeInvitacion('')).toBeNull();
    expect(urlDeInvitacion(null)).toBeNull();
    // Ni imágenes ni páginas: `event_document` es para documentos.
    expect(urlDeInvitacion('https://static.fie.org/uploads/40/202159-oran.jpg')).toBeNull();
    expect(urlDeInvitacion('https://novasoft.dz/aaf')).toBeNull();
  });

  it('acepta el PDF aunque lleve parámetros detrás', () => {
    expect(urlDeInvitacion('https://static.fie.org/a/b.pdf?v=2')).toBe(
      'https://static.fie.org/a/b.pdf?v=2',
    );
  });

  it('acepta el WORD de Orán, que es el caso que se perdía', () => {
    /**
     * La URL de verdad, tal como la devuelve
     * `/api/fie/competition/2027/1410`. Con el filtro anterior —«solo `.pdf`»—
     * esta invitación no llegaba ni a guardarse, y la ficha de Orán decía «esta
     * fuente no publica convocatoria ni dossier para este torneo». Medido: 22
     * de las 96 invitaciones de los próximos 60 días son `.docx`.
     */
    const oran =
      'https://static.fie.org/uploads/41/205065-260827%20-%20ORAN%20Invitation%20Letter.docx';
    expect(urlDeInvitacion(oran)).toBe(oran);
  });

  it('acepta los demás formatos de documento, aunque no se sepan leer todavía', () => {
    // El enlace vale igual: una persona puede abrirlo. Que el extractor sepa o
    // no leer el formato se decide en `src/lib/ai/documento.ts`, no aquí.
    for (const ext of ['.pdf', '.docx', '.doc', '.odt', '.rtf', '.txt']) {
      expect(urlDeInvitacion(`https://static.fie.org/a/b${ext}`)).toBe(
        `https://static.fie.org/a/b${ext}`,
      );
    }
    // Y la extensión en mayúsculas también, que es como la sirven a veces.
    expect(urlDeInvitacion('https://static.fie.org/a/B.DOCX')).toBe(
      'https://static.fie.org/a/B.DOCX',
    );
  });
});
