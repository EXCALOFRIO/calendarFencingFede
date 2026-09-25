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
  pareceContenerDatosPersonales,
  redactarDatosDeContacto,
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
  modelo: '@cf/google/gemma-4-26b-a4b-it',
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
        '/ai/run/@cf/google/gemma-4-26b-a4b-it',
    );
    expect(llamadas[0].cuerpo.response_format).toEqual({
      type: 'json_schema',
      json_schema: { type: 'object' },
    });
    // Temperatura 0: extraer no es escribir, no queremos variedad.
    expect(llamadas[0].cuerpo.temperature).toBe(0);
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
            cuota: {
              importeEur: 15,
              cita: 'La cuota de inscripción es de 15 euros para los clubes federados.',
            },
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

  it('una cuota citada a medias tampoco cuela', () => {
    // El modelo copia media frase y le cambia la cifra: la cadena completa ya
    // no aparece en el documento y el campo se cae solo.
    const datos = esquemaExtraccion.parse({
      cuota: {
        importeEur: 350,
        cita: 'La cuota de inscripción es de 350 euros por tirador y prueba.',
      },
    });
    const { verificadas, descartadas } = verificarPropuestas(aPropuestas(datos), DOSSIER);
    expect(verificadas).toHaveLength(0);
    expect(descartadas.map((p) => p.field)).toEqual(['fee_eur']);
  });
});
