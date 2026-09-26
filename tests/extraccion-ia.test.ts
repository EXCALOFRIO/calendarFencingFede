import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ConfiguracionIa,
  MODELO_POR_DEFECTO,
  VERSION_ESQUEMA,
  clienteWorkersAi,
  crearClienteModelo,
  esquemaExtraccion,
  extraerContexto,
  extraerDeTexto,
  hashTexto,
  huellaDeExtraccion,
  leerConfiguracionIa,
  normalizarConIndices,
  normalizarParaCotejo,
  olvidarRespuestaCrudaRegistrada,
  pareceContenerDatosPersonales,
  redactarDatosDeContacto,
  resolverEvento,
  respuestaDeWorkersAi,
  resumirRespuestaCruda,
  verificarPropuestas,
  aPropuestas,
} from '@/lib/ai/extract';

/**
 * Lo que se prueba aquí es la parte nueva: el proveedor (Workers AI), la
 * huella que hace posible la idempotencia y el trozo de PDF que ve el revisor.
 *
 * La prueba que más importa de todo el fichero es la última: una cita
 * inventada NO llega a la cola de revisión, por muy bien que suene y por muy
 * convencido que esté el modelo. Sin eso, todo lo demás es un generador de
 * datos falsos con buena presentación.
 *
 * Nada de esto toca red ni base de datos: `fetch` se sustituye.
 */

const DOSSIER = [
  'REAL FEDERACIÓN ESPAÑOLA DE ESGRIMA',
  'CIRCULAR 34/26 — TORNEO NACIONAL DE RANKING ABSOLUTO',
  '',
  'SEDE: Pabellón Municipal de Deportes de Alcobendas.',
  '',
  'El plazo ordinario de inscripción finaliza el 12 de octubre de 2026.',
  'La cuota de inscripción es de 35 euros por tirador y prueba.',
  'La llamada de los tiradores será a las 08:45 horas.',
].join('\n');

const CONFIG_WORKERS: ConfiguracionIa = {
  activa: true,
  proveedor: 'workers_ai',
  apiKey: null,
  modelo: '@cf/zai-org/glm-5.3-flash',
  tierDePago: false,
  cuentaCloudflare: 'cuenta-de-prueba',
  tokenCloudflare: 'token-de-prueba',
};

/** Respuesta con la forma exacta que devuelve la REST API de Workers AI. */
function respuestaWorkersAi(contenido: unknown): Response {
  return new Response(
    JSON.stringify({ result: { response: contenido }, success: true, errors: [] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('configuración del proveedor', () => {
  it('por defecto habla con Workers AI y con su modelo, no con el de otro proveedor', () => {
    vi.stubEnv('AI_PROVIDER', '');
    vi.stubEnv('AI_MODEL', '');
    const config = leerConfiguracionIa();
    expect(config.proveedor).toBe('workers_ai');
    expect(config.modelo).toBe(MODELO_POR_DEFECTO.workers_ai);
    expect(config.modelo.startsWith('@cf/')).toBe(true);
  });

  it('cambiar de proveedor es cambiar una variable de entorno', () => {
    vi.stubEnv('AI_PROVIDER', 'openrouter');
    vi.stubEnv('AI_MODEL', '');
    expect(leerConfiguracionIa().proveedor).toBe('openrouter');
    expect(leerConfiguracionIa().modelo).toBe(MODELO_POR_DEFECTO.openrouter);
  });

  it('sin credenciales de ningún tipo no hay cliente, y eso NO es un error', () => {
    const sinNada: ConfiguracionIa = {
      ...CONFIG_WORKERS,
      apiKey: null,
      cuentaCloudflare: null,
      tokenCloudflare: null,
    };
    expect(clienteWorkersAi(sinNada)).toBeNull();
    expect(crearClienteModelo(sinNada)).toBeNull();
  });

  it('rechaza un id de modelo que no tenga forma de id de modelo', () => {
    // Acabaría concatenado en una URL; no se sanea a medias, se rechaza.
    expect(
      clienteWorkersAi({ ...CONFIG_WORKERS, modelo: '../../admin?x=1' }),
    ).toBeNull();
  });
});

describe('cliente de Workers AI', () => {
  it('pide salida estructurada con el esquema JSON y llama a la URL de la cuenta', async () => {
    const llamadas: { url: string; cuerpo: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, opciones: { body: string; headers: Headers }) => {
        llamadas.push({ url: String(url), cuerpo: JSON.parse(opciones.body) });
        return respuestaWorkersAi('{"plazos":[],"horarios":[],"categoriasAdmitidas":[]}');
      }),
    );

    const cliente = clienteWorkersAi(CONFIG_WORKERS);
    expect(cliente).not.toBeNull();
    await cliente?.generarJson({
      sistema: 'sistema',
      usuario: 'usuario',
      esquemaJson: { type: 'object' },
    });

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/cuenta-de-prueba' +
        '/ai/run/@cf/zai-org/glm-5.3-flash',
    );
    expect(llamadas[0].cuerpo.response_format).toEqual({
      type: 'json_schema',
      json_schema: { type: 'object' },
    });
    // Temperatura 0: extraer no es escribir, no queremos variedad.
    expect(llamadas[0].cuerpo.temperature).toBe(0);
    /**
     * Y los parámetros que dependen del modelo, que es de lo que iba el fallo
     * de producción: este modelo llama al tope `max_completion_tokens` y
     * acepta `reasoning_effort`. Mandar `max_tokens` a secas le dejaba sitio
     * para razonar hasta quedarse sin presupuesto.
     */
    expect(llamadas[0].cuerpo.max_completion_tokens).toBeGreaterThan(0);
    expect(llamadas[0].cuerpo.reasoning_effort).toBe('low');
    expect(llamadas[0].cuerpo.max_tokens).toBeUndefined();
  });

  /**
   * LA PRUEBA DE REGRESIÓN DEL FALLO DE PRODUCCIÓN.
   *
   * `@cf/google/gemma-4-26b-a4b-it` devolvió cinco errores de cinco con
   * «Workers AI no devolvió texto en la respuesta». No era que el modelo
   * callara: era que devolvía el sobre de chat-completions de OpenAI y este
   * código solo sabía abrir `{ response: … }`. Comprobado contra el binding de
   * verdad, la respuesta era exactamente la de abajo.
   */
  it('entiende el sobre de chat-completions, que es el que rompió producción', () => {
    const sobreDeGemma = {
      id: '6124d985b7ce449f8aebce3f3d8821c3',
      object: 'chat.completion',
      model: '@cf/google/gemma-4-26b-a4b-it-external',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: '{"plazos":[]}' },
        },
      ],
      usage: { prompt_tokens: 26, completion_tokens: 64 },
    };
    expect(respuestaDeWorkersAi(sobreDeGemma)).toBe('{"plazos":[]}');
  });

  it('sigue entendiendo la forma documentada, la de `response`', () => {
    expect(respuestaDeWorkersAi({ response: '{"plazos":[]}' })).toBe('{"plazos":[]}');
    expect(respuestaDeWorkersAi({ response: { plazos: [] } })).toBe('{"plazos":[]}');
  });

  /**
   * El otro motivo por el que Gemma devolvía vacío, y el que NO se arregla con
   * código: se gasta el presupuesto de salida razonando y deja `content` a "".
   * El error tiene que decir eso con esas palabras, porque el arreglo es
   * cambiar de modelo o bajarle el razonamiento, no tocar el parseo.
   */
  it('dice que el modelo se gastó el tope razonando, en vez de «no devolvió texto»', () => {
    const razonandoSinAcabar = {
      choices: [
        {
          finish_reason: 'length',
          message: {
            role: 'assistant',
            content: '',
            reasoning_content: 'Vamos a ver. El usuario quiere un JSON con…',
          },
        },
      ],
    };
    expect(() => respuestaDeWorkersAi(razonandoSinAcabar)).toThrow(/razonando/i);
    expect(() => respuestaDeWorkersAi(razonandoSinAcabar)).toThrow(/finish_reason: length/);
  });

  /**
   * Y cuando de verdad no se sabe leer la respuesta, el error tiene que traer
   * el sobre recortado: si el id del modelo no existe, se lee escrito ahí en
   * vez de tener que adivinarlo.
   */
  it('cuando no sabe leer la respuesta, la registra recortada en el error', () => {
    olvidarRespuestaCrudaRegistrada();
    const avisos: string[] = [];
    vi.stubGlobal('console', {
      ...console,
      warn: (mensaje: string) => avisos.push(mensaje),
    });

    const desconocido = { errors: [{ message: 'No such model @cf/inventado/no-existe' }] };
    expect(() => respuestaDeWorkersAi(desconocido)).toThrow(/No such model/);
    expect(avisos.join(' ')).toMatch(/no se sabe leer/i);

    // Y no se repite: 25 documentos con el modelo mal configurado no pueden
    // escribir 25 veces lo mismo en los registros del Worker.
    expect(() => respuestaDeWorkersAi(desconocido)).toThrow();
    expect(avisos).toHaveLength(1);
  });

  it('recorta la respuesta cruda para no volcar un PDF entero en el registro', () => {
    const largo = resumirRespuestaCruda({ texto: 'a'.repeat(50_000) });
    expect(largo.length).toBeLessThan(1400);
    expect(largo).toMatch(/recortado, \d+ caracteres en total/);
  });

  it('entiende la respuesta tanto si viene en texto como ya parseada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respuestaWorkersAi({ plazos: [] })),
    );
    const cliente = clienteWorkersAi(CONFIG_WORKERS);
    const crudo = await cliente?.generarJson({
      sistema: 's',
      usuario: 'u',
      esquemaJson: {},
    });
    expect(JSON.parse(crudo ?? '')).toEqual({ plazos: [] });
  });

  it('convierte un "success: false" en un error con el detalle de Cloudflare', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              result: null,
              errors: [{ message: 'Authentication error' }],
            }),
            { status: 200 },
          ),
      ),
    );
    const cliente = clienteWorkersAi(CONFIG_WORKERS);
    await expect(
      cliente?.generarJson({ sistema: 's', usuario: 'u', esquemaJson: {} }),
    ).rejects.toThrow(/Authentication error/);
  });

  it('no finge saber leer un PDF escaneado', async () => {
    const cliente = clienteWorkersAi(CONFIG_WORKERS);
    await expect(cliente?.transcribirPdf(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /no lee PDFs/i,
    );
  });
});

describe('huella de la extracción (idempotencia)', () => {
  it('el hash de un texto es estable y tiene forma de SHA-256', async () => {
    const uno = await hashTexto('circular 12/26');
    const otro = await hashTexto('circular 12/26');
    expect(uno).toBe(otro);
    expect(uno).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashTexto('circular 13/26')).not.toBe(uno);
  });

  it('la huella del prompt no cambia entre ejecuciones', async () => {
    expect(await huellaDeExtraccion()).toBe(await huellaDeExtraccion());
    expect(await huellaDeExtraccion()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('la versión del esquema es un número que se puede subir a mano', () => {
    expect(Number.isInteger(VERSION_ESQUEMA)).toBe(true);
    expect(VERSION_ESQUEMA).toBeGreaterThan(0);
  });
});

describe('trozo del PDF que ve quien revisa', () => {
  it('devuelve el texto ORIGINAL, con sus acentos y sus mayúsculas', () => {
    const contexto = extraerContexto(
      'la cuota de inscripcion es de 35 euros',
      DOSSIER,
      40,
    );
    expect(contexto).toContain('La cuota de inscripción es de 35 euros');
  });

  it('no inventa contexto para una cita que no está', () => {
    expect(extraerContexto('La cuota es de 15 euros por tirador', DOSSIER)).toBeNull();
  });

  it('el mapa de índices apunta al carácter de verdad', () => {
    const texto = 'Sede:  Pabellón   Municipal';
    const { normalizado, indices } = normalizarConIndices(texto);
    expect(normalizado).toBe('sede: pabellon municipal');
    // El primer carácter de "pabellon" en el normalizado tiene que caer sobre
    // la "P" mayúscula del original.
    expect(texto[indices[normalizado.indexOf('pabellon')]]).toBe('P');
    expect(normalizado).toBe(normalizarParaCotejo(texto));
  });
});

describe('privacidad: tachar lo de contacto, bloquear lo nominal', () => {
  const PIE_DE_CIRCULAR = [
    'Real Federación Española de Esgrima',
    'Calle Ferraz nº16 – 6º. Madrid 28008. Tlfno: (34) 91 559 74 00',
    'Correo electrónico: rfee@esgrima.es – Página web: www.esgrima.es',
    'Las inscripciones fuera de plazo se comunican a pilar.alegre@esgrima.es',
  ].join('\n');

  it('tacha los correos y los teléfonos antes de enviar nada', () => {
    const { texto, correos } = redactarDatosDeContacto(PIE_DE_CIRCULAR);
    expect(texto).not.toContain('@esgrima.es');
    expect(texto).toContain('[correo oculto]');
    expect(correos).toBe(2);
  });

  it('el texto que sale hacia el modelo no lleva correos', async () => {
    let enviado = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, opciones: { body: string }) => {
        enviado = JSON.parse(opciones.body).messages[1].content;
        return respuestaWorkersAi('{"plazos":[],"horarios":[],"categoriasAdmitidas":[]}');
      }),
    );

    await extraerDeTexto({
      documentUrl: 'https://esgrima.es/circular.pdf',
      documentHash: 'hash',
      texto: `${DOSSIER}\n${PIE_DE_CIRCULAR}`,
      config: CONFIG_WORKERS,
    });

    expect(enviado).not.toContain('pilar.alegre@esgrima.es');
    expect(enviado).toContain('[correo oculto]');
  });

  /**
   * Esto es exactamente lo que pasaba con las circulares de verdad: los
   * títulos de apartado en mayúsculas de una normativa se contaban como
   * nombres de personas y el documento entero se bloqueaba.
   */
  it('los títulos de apartado de una normativa NO son un listado de personas', () => {
    const normativa = [
      'VENCEDOR LIGA',
      'VENCEDOR DIVISIÓN',
      'REGLAS ESPECIALES',
      'CLASIFICACION FINAL',
      'SISTEMA DE CLASIFICACIÓN',
      'MODIFICACIÓN DE DIVISIONES',
      'COMPETICIONES COEFICIENTE DE PUNTUACIÓN',
      'TEMPORADA ANTERIOR',
    ].join('\n');
    expect(pareceContenerDatosPersonales(normativa).contieneDatosPersonales).toBe(false);
  });

  it('una relación nominal de convocados sí se bloquea', () => {
    const lista = [
      'CONVOCATORIA DE LA SELECCIÓN M17',
      'García Pérez, Lucía',
      'Fernández Gómez, Marcos',
      'Ruiz Sanz, Elena',
      'Molina Díaz, Pablo',
      'Navarro Ortega, Claudia',
      'Serrano Vidal, Hugo',
    ].join('\n');
    const deteccion = pareceContenerDatosPersonales(lista);
    expect(deteccion.contieneDatosPersonales).toBe(true);
    expect(deteccion.motivos.join(' ')).toMatch(/listado de personas|relación nominal/i);
  });

  it('no se envía nada de un documento con licencias y fechas de nacimiento', async () => {
    const cliente = vi.fn();
    vi.stubGlobal('fetch', cliente);
    const resultado = await extraerDeTexto({
      documentUrl: 'https://esgrima.es/convocatoria.pdf',
      documentHash: 'hash',
      texto: 'CONVOCATORIA M15\nLicencia SGL00510 · fecha de nacimiento: 11/04/2011',
      config: CONFIG_WORKERS,
    });
    expect(resultado.estado).toBe('bloqueado_por_datos_personales');
    expect(cliente).not.toHaveBeenCalled();
  });
});

/**
 * A qué torneo va el dato. Es la otra mitad del problema y la que más daño
 * hace si se falla: un horario correcto en la ficha del torneo equivocado no
 * se detecta mirando la ficha.
 *
 * Aquí solo se prueban los caminos que NO tocan la base de datos, que son
 * justo los que dicen «no lo sé». Que esos funcionen es lo importante: la
 * heurística puede afinarse, pero la negativa tiene que ser fiable.
 */
describe('a qué evento pertenece el documento', () => {
  it('un dossier que cuelga del torneo se liga con certeza, sin deducir nada', async () => {
    const resultado = await resolverEvento({ eventoConocido: 'evento-1' });
    expect(resultado).toEqual({
      eventoId: 'evento-1',
      certeza: 'seguro',
      motivo: expect.stringContaining('cuelga de este evento'),
    });
  });

  it('una normativa que no nombra competiciones se queda en «no se sabe»', async () => {
    const resultado = await resolverEvento({ competiciones: [] });
    expect(resultado.eventoId).toBeNull();
    expect(resultado.certeza).toBe('desconocido');
    expect(resultado.motivo).toMatch(/no nombra ninguna competición/i);
  });

  it('una competición sin fecha tampoco se liga: no se distingue la edición', async () => {
    const resultado = await resolverEvento({
      competiciones: [
        {
          nombre: 'Torneo Nacional de Ranking Absoluto',
          cita: 'Torneo Nacional de Ranking Absoluto',
        },
      ],
    });
    expect(resultado.eventoId).toBeNull();
    expect(resultado.certeza).toBe('desconocido');
    expect(resultado.motivo).toMatch(/sin fecha/i);
  });
});

describe('la extracción completa con Workers AI detrás', () => {
  it('encola lo verificable y DESCARTA la cita inventada', async () => {
    /**
     * El modelo devuelve tres campos. Dos citan frases que están en el
     * documento; el tercero cita una frase que suena perfecta y no existe.
     * Ese tercero no puede llegar a la cola de revisión: si llegara, alguien
     * acabaría aprobándolo por inercia y tendríamos una cuota falsa publicada
     * como oficial.
     */
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respuestaWorkersAi(
          JSON.stringify({
            plazos: [
              {
                tipo: 'L1',
                fechaLimite: '2026-10-12',
                cita: 'El plazo ordinario de inscripción finaliza el 12 de octubre de 2026.',
              },
            ],
            cuotas: [
              {
                tipo: 'individual',
                importeEur: 15,
                cita: 'La cuota de inscripción es de 15 euros para los clubes federados.',
              },
            ],
            horarios: [
              {
                etiqueta: 'llamada',
                hora: '08:45',
                cita: 'La llamada de los tiradores será a las 08:45 horas.',
              },
            ],
            categoriasAdmitidas: [],
          }),
        ),
      ),
    );

    const resultado = await extraerDeTexto({
      documentUrl: 'https://esgrima.es/circular-34-26.pdf',
      documentHash: 'hash-de-prueba',
      texto: DOSSIER,
      config: CONFIG_WORKERS,
    });

    expect(resultado.estado).toBe('ok');
    if (resultado.estado !== 'ok') return;

    expect(resultado.propuestas.map((p) => p.field).sort()).toEqual([
      'call_time',
      'deadline.L1',
    ]);
    expect(resultado.descartadas.map((p) => p.field)).toEqual(['fee_eur']);
    expect(resultado.descartadas[0].motivoDescarte).toMatch(/no aparece en el texto/i);

    // Y lo que sí pasa el filtro llega con su trozo de PDF al lado.
    const plazo = resultado.propuestas.find((p) => p.field === 'deadline.L1');
    expect(plazo?.contexto).toContain('plazo ordinario de inscripción');
    expect(plazo?.quoteVerified).toBe(true);
  });

  it('saca el pabellón, los horarios por día y prueba, los importes y los enlaces', () => {
    /**
     * Esto es un trozo de una convocatoria REAL (la del TNR Absoluto y la I
     * Liga Nacional de Sabadell), con la forma en la que de verdad vienen los
     * horarios: las mismas horas repetidas por día y por arma. Sin el sufijo
     * de fecha y de prueba, las cuatro «Apertura del pabellón» serían el mismo
     * campo y solo sobreviviría una, que es como perder el domingo.
     */
    const datos = esquemaExtraccion.parse({
      sede: {
        nombre: "Pista Coberta d'Atletisme de Catalunya",
        direccion: 'Camí de Can Quadres, 190, 08203 Sabadell',
        localidad: 'Sabadell',
        cita: "Pista Coberta d'Atletisme de Catalunya",
      },
      horarios: [
        {
          etiqueta: 'apertura_instalacion',
          hora: '07:30',
          fecha: '2026-10-03',
          cita: '07:30h: Apertura del pabellón.',
        },
        {
          etiqueta: 'inicio',
          hora: '09:00',
          fecha: '2026-10-03',
          prueba: 'florete masculino',
          cita: 'Inicio de la competición florete masculino',
        },
        {
          etiqueta: 'inicio',
          hora: '11:30',
          fecha: '2026-10-03',
          prueba: 'florete femenino',
          cita: 'Inicio de la competición florete femenino',
        },
      ],
      cuotas: [
        {
          tipo: 'extranjeros',
          importeEur: 200,
          cita: 'el coste de su inscripción será de 200 euros',
        },
      ],
      enlaces: [
        {
          tipo: 'alojamiento',
          url: 'https://hotel-san-roque.marketinghotelero.top',
          cita: 'https://hotel-san-roque.marketinghotelero.top',
        },
      ],
    });

    const campos = aPropuestas(datos).map((p) => p.field);

    // El pabellón con su dirección y su localidad, que es lo que hoy falta en
    // 246 de los 274 eventos.
    expect(campos).toContain('venue');
    expect(campos).toContain('venue_address');
    expect(campos).toContain('venue_city');

    // Los dos inicios sobreviven porque llevan el día y la prueba en la clave.
    expect(campos).toContain('installation_open.2026-10-03');
    expect(campos).toContain('start_time.2026-10-03.florete-masculino');
    expect(campos).toContain('start_time.2026-10-03.florete-femenino');

    // El importe de los extranjeros NO se hace pasar por la cuota del tirador.
    expect(campos).toContain('fee_eur.extranjeros');
    expect(campos).not.toContain('fee_eur');

    expect(campos).toContain('link.alojamiento');
  });

  /**
   * Los enlaces llevan verificación DOBLE: la cita y la URL. Un enlace
   * retocado es peor que un dato retocado, porque se puede pulsar.
   */
  it('descarta un enlace cuya URL no está escrita tal cual en el PDF', () => {
    const pdf = [
      'INSCRIPCIONES',
      'Toda la información en esgrima.es/circulares y en la app.',
    ].join('\n');

    const datos = esquemaExtraccion.parse({
      enlaces: [
        {
          tipo: 'web',
          // El modelo le ha añadido el esquema y la barra final: la cita es
          // verdadera pero la URL no aparece así en ningún sitio.
          url: 'https://esgrima.es/circulares/',
          cita: 'Toda la información en esgrima.es/circulares y en la app.',
        },
      ],
    });

    const { verificadas, descartadas } = verificarPropuestas(aPropuestas(datos), pdf);
    expect(verificadas).toHaveLength(0);
    expect(descartadas[0].field).toBe('link.web');
    expect(descartadas[0].motivoDescarte).toMatch(/no aparece escrito|retocado/i);
  });

  /**
   * Medido con cinco modelos sobre documentos reales: cuatro de los cinco
   * perdían un dossier ENTERO porque devolvían `sede: { nombre: "", cita: "" }`
   * cuando el documento no publicaba el pabellón, o escribían la hora del
   * plazo como «12:00 horas». Un detalle así no puede tirar trece campos
   * buenos.
   */
  it('un elemento mal formado se cae solo, sin llevarse el documento entero', () => {
    const datos = esquemaExtraccion.parse({
      // Cortesía mal entendida del modelo: la sede vacía se queda en null.
      sede: { nombre: '', cita: '' },
      plazos: [
        {
          tipo: 'L1',
          fechaLimite: '2026-10-09',
          hora: '12:00 horas',
          cita: 'antes del viernes de la semana anterior a las 12:00 horas',
        },
        // Sin fecha válida: este plazo se cae, y solo este.
        { tipo: 'L2', fechaLimite: 'la semana anterior', cita: 'una cita bien larga' },
      ],
      // Tipo de enlace que no existe en el esquema: se cae el enlace, no el
      // documento.
      enlaces: [{ tipo: 'inventado', url: 'https://x.es/a', cita: 'una cita bien larga' }],
    });

    expect(datos.sede).toBeNull();
    expect(datos.plazos).toHaveLength(1);
    expect(datos.plazos[0].hora).toBe('12:00');
    expect(datos.enlaces).toHaveLength(0);
  });

  /**
   * Tres cosas que un modelo hace de verdad y que la verificación de citas NO
   * tumba, porque las citas son verdaderas. Las tres salieron de pasar las
   * circulares reales por GLM-5.3.
   */
  it('«No se indica pabellón» no es el nombre de un pabellón', () => {
    const datos = esquemaExtraccion.parse({
      sede: {
        // Cita REAL de la «NORMATIVA PARA RANKINGS NACIONALES 26-27», valor
        // inventado por el modelo para no dejar el hueco.
        nombre: 'No se indica pabellón ni dirección',
        cita: 'El acceso a la zona de competición y que esté habilitada',
      },
    });
    expect(aPropuestas(datos)).toHaveLength(0);
  });

  it('un recargo de 0 € no se publica: es un hueco, no un importe', () => {
    const datos = esquemaExtraccion.parse({
      plazos: [
        {
          tipo: 'L1',
          fechaLimite: '2026-09-02',
          recargoEur: 0,
          cita: 'el plazo de inscripción finaliza el viernes de la semana anterior',
        },
      ],
    });
    const campos = aPropuestas(datos).map((p) => p.field);
    expect(campos).toEqual(['deadline.L1']);
    expect(campos).not.toContain('deadline.L1.surcharge_eur');
  });

  it('una categoría cuya cita no la menciona no la respalda', () => {
    const pdf = 'LIGA NACIONAL DE CLUBES POR EQUIPOS\nSe disputará en dos jornadas.';
    const datos = esquemaExtraccion.parse({
      categoriasAdmitidas: [
        // La frase SÍ está en el documento; lo que no dice es nada de SENIOR.
        { codigo: 'SENIOR', cita: 'LIGA NACIONAL DE CLUBES POR EQUIPOS' },
      ],
    });
    const { verificadas, descartadas } = verificarPropuestas(aPropuestas(datos), pdf);
    expect(verificadas).toHaveLength(0);
    expect(descartadas[0].motivoDescarte).toMatch(/no menciona el valor/i);
  });

  it('una cuota citada a medias tampoco cuela', () => {
    // El modelo copia media frase y le cambia la cifra: la cadena completa ya
    // no aparece en el documento y el campo se cae solo.
    const datos = esquemaExtraccion.parse({
      cuotas: [
        {
          tipo: 'individual',
          importeEur: 350,
          cita: 'La cuota de inscripción es de 350 euros por tirador y prueba.',
        },
      ],
    });
    const { verificadas, descartadas } = verificarPropuestas(aPropuestas(datos), DOSSIER);
    expect(verificadas).toHaveLength(0);
    expect(descartadas.map((p) => p.field)).toEqual(['fee_eur']);
  });
});
