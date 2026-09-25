import { describe, expect, it, vi } from 'vitest';
import {
  CONFIGURACION_ENVIO,
  type ConfiguracionEnvioSkermo,
  type DatosInscripcion,
  type RegistroEnvio,
  type RepositorioEnvios,
  construirPeticionInscripcion,
  leerCamposDeAcceso,
  leerTokenCsrf,
  sanearParaRegistro,
  submitEntry,
} from '@/lib/skermo/client';
import {
  cifrarCredencial,
  descifrarCredencial,
  hayClaveDeCifrado,
  redactar,
} from '@/lib/skermo/credentials';

/**
 * Lo que se prueba aquí es lo que impide un accidente con datos reales: que el
 * modo simulación no toque la red, que sin endpoint configurado el envío real
 * se niegue, que nadie pueda enviar sin decir quién lo aprueba, y que ninguna
 * contraseña acabe en el snapshot ni en la base de datos.
 */

const CLAVE_DE_PRUEBA = Buffer.alloc(32, 7).toString('base64');

const DATOS: DatosInscripcion = {
  competicionSkermoId: '10249',
  licencia: 'SGL00510',
  nombre: 'SILVIA',
  apellidos: 'GÓMEZ LÓPEZ',
  fechaNacimiento: '2007-04-11',
  clubCodigo: 'CELC-M',
};

/** Configuración de mentira, como la tendrá alguien tras hacer el F12. */
const CONFIG_COMPLETA: ConfiguracionEnvioSkermo = {
  configurado: true,
  rutaFormulario: '/inscripciones/nueva',
  rutaEnvio: '/inscripciones',
  rutaListado: '/inscripciones/{competicion}',
  campos: {
    competicion: 'competition_id',
    licencia: 'license',
    nombre: 'first_name',
    apellidos: 'last_name',
    fechaNacimiento: 'birth_date',
    club: 'club_code',
  },
  camposFijos: { action: 'add' },
};

/** Repositorio en memoria: los tests no necesitan base de datos. */
function repositorioFalso(): RepositorioEnvios & { registros: RegistroEnvio[] } {
  const registros: RegistroEnvio[] = [];
  return {
    registros,
    async registrar(registro) {
      registros.push(registro);
    },
    async yaEnviada(entryId) {
      return registros.some(
        (r) => r.entryId === entryId && (r.status === 'sent' || r.status === 'verified'),
      );
    },
  };
}

describe('configuración del endpoint', () => {
  it('sale de fábrica SIN configurar y sin ninguna URL inventada', () => {
    // Si algún día esto se pone a true sin haber hecho el F12, el test avisa.
    expect(CONFIGURACION_ENVIO.configurado).toBe(false);
    expect(CONFIGURACION_ENVIO.rutaEnvio).toBeNull();
    expect(CONFIGURACION_ENVIO.rutaFormulario).toBeNull();
    expect(CONFIGURACION_ENVIO.rutaListado).toBeNull();
    expect(Object.values(CONFIGURACION_ENVIO.campos).every((v) => v === null)).toBe(true);
  });

  it('la petición construida dice qué falta por saber', () => {
    const peticion = construirPeticionInscripcion(DATOS, {
      config: CONFIGURACION_ENVIO,
    });
    expect(peticion.url).toBeNull();
    expect(peticion.incompleto.length).toBeGreaterThan(0);
    expect(peticion.incompleto.join(' ')).toMatch(/rutaEnvio/);
  });
});

describe('lectura del formulario de acceso (Laravel + AdminLTE)', () => {
  const HTML_ACCESO = `
    <html><body class="hold-transition login-page">
      <form method="post" action="/login">
        <input type="hidden" name="_token" value="TOKEN-CSRF-123">
        <input type="email" name="email" class="form-control">
        <input type="password" name="password" class="form-control">
        <button type="submit">Acceder</button>
      </form>
    </body></html>`;

  it('extrae el token CSRF oculto', () => {
    expect(leerTokenCsrf(HTML_ACCESO)).toBe('TOKEN-CSRF-123');
  });

  it('acepta también el token en el meta de la página', () => {
    expect(leerTokenCsrf('<meta name="csrf-token" content="ABC">')).toBe('ABC');
  });

  it('devuelve null cuando el formulario ya no trae token (fallo visible)', () => {
    expect(leerTokenCsrf('<form><input name="email"></form>')).toBeNull();
  });

  it('lee del propio formulario cómo se llaman los campos, sin adivinar', () => {
    expect(leerCamposDeAcceso(HTML_ACCESO)).toEqual({
      usuario: 'email',
      password: 'password',
    });
  });
});

describe('modo simulación', () => {
  it('NO hace ninguna petición de red y registra estado dry_run', async () => {
    const red = vi.fn<typeof fetch>();
    const repositorio = repositorioFalso();

    const resultado = await submitEntry({
      entryId: '11111111-1111-1111-1111-111111111111',
      triggeredByProfileId: '22222222-2222-2222-2222-222222222222',
      datos: DATOS,
      credenciales: { usuario: 'club@ejemplo.test', password: 'supersecreta' },
      config: CONFIG_COMPLETA,
      repositorio,
      fetchImpl: red,
      modo: { activo: true, simulacion: true },
      baseUrl: 'https://app.skermo.org',
    });

    // Lo esencial: cero red. Ni login, ni POST, ni verificación.
    expect(red).not.toHaveBeenCalled();
    expect(resultado.estado).toBe('dry_run');
    expect(repositorio.registros).toHaveLength(1);
    expect(repositorio.registros[0].status).toBe('dry_run');
  });

  it('construye la petición con los nombres de campo reales del formulario', async () => {
    const repositorio = repositorioFalso();
    const resultado = await submitEntry({
      entryId: '11111111-1111-1111-1111-111111111111',
      triggeredByProfileId: '22222222-2222-2222-2222-222222222222',
      datos: DATOS,
      config: CONFIG_COMPLETA,
      repositorio,
      fetchImpl: vi.fn<typeof fetch>(),
      modo: { activo: true, simulacion: true },
      baseUrl: 'https://app.skermo.org',
    });

    expect(resultado.estado).toBe('dry_run');
    if (resultado.estado !== 'dry_run') return;
    expect(resultado.peticion.url).toBe('https://app.skermo.org/inscripciones');
    expect(resultado.peticion.campos).toMatchObject({
      action: 'add',
      competition_id: '10249',
      license: 'SGL00510',
      first_name: 'SILVIA',
      last_name: 'GÓMEZ LÓPEZ',
      club_code: 'CELC-M',
    });
    expect(resultado.peticion.incompleto).toEqual([]);
  });
});

describe('barreras contra el envío accidental', () => {
  it('exige saber quién aprueba: sin triggeredByProfileId, lanza', async () => {
    await expect(
      submitEntry({
        entryId: '11111111-1111-1111-1111-111111111111',
        triggeredByProfileId: '   ',
        datos: DATOS,
        config: CONFIG_COMPLETA,
        repositorio: repositorioFalso(),
        fetchImpl: vi.fn<typeof fetch>(),
        modo: { activo: true, simulacion: true },
      }),
    ).rejects.toThrow(/triggeredByProfileId/);
  });

  it('con el interruptor apagado no hace nada', async () => {
    const red = vi.fn<typeof fetch>();
    const repositorio = repositorioFalso();
    const resultado = await submitEntry({
      entryId: '11111111-1111-1111-1111-111111111111',
      triggeredByProfileId: '22222222-2222-2222-2222-222222222222',
      datos: DATOS,
      config: CONFIG_COMPLETA,
      repositorio,
      fetchImpl: red,
      modo: { activo: false, simulacion: true },
    });
    expect(resultado.estado).toBe('desactivado');
    expect(red).not.toHaveBeenCalled();
    expect(repositorio.registros).toHaveLength(0);
  });

  it('se NIEGA a enviar de verdad mientras el endpoint esté sin configurar', async () => {
    const red = vi.fn<typeof fetch>();
    const repositorio = repositorioFalso();

    const resultado = await submitEntry({
      entryId: '11111111-1111-1111-1111-111111111111',
      triggeredByProfileId: '22222222-2222-2222-2222-222222222222',
      datos: DATOS,
      credenciales: { usuario: 'club@ejemplo.test', password: 'supersecreta' },
      // La de fábrica: sin endpoint.
      config: CONFIGURACION_ENVIO,
      repositorio,
      fetchImpl: red,
      modo: { activo: true, simulacion: false },
    });

    expect(resultado.estado).toBe('failed');
    expect(red).not.toHaveBeenCalled();
    // El fallo es VISIBLE: queda registrado con su motivo.
    expect(repositorio.registros[0].status).toBe('failed');
    expect(repositorio.registros[0].lastError).toMatch(/no está configurado/i);
  });

  it('no envía dos veces la misma inscripción', async () => {
    const repositorio = repositorioFalso();
    repositorio.registros.push({
      entryId: '11111111-1111-1111-1111-111111111111',
      status: 'verified',
      requestSnapshot: {},
      triggeredByProfileId: '22222222-2222-2222-2222-222222222222',
    });

    const red = vi.fn<typeof fetch>();
    const resultado = await submitEntry({
      entryId: '11111111-1111-1111-1111-111111111111',
      triggeredByProfileId: '22222222-2222-2222-2222-222222222222',
      datos: DATOS,
      config: CONFIG_COMPLETA,
      repositorio,
      fetchImpl: red,
      modo: { activo: true, simulacion: false },
    });

    expect(resultado.estado).toBe('ya_enviada');
    expect(red).not.toHaveBeenCalled();
  });
});

describe('el snapshot no lleva credenciales', () => {
  it('sanearParaRegistro tacha cualquier clave sospechosa, en profundidad', () => {
    const saneado = sanearParaRegistro({
      url: 'https://app.skermo.org/inscripciones',
      campos: { license: 'SGL00510', password: 'supersecreta', _token: 'TOK' },
      cabeceras: { Cookie: 'laravel_session=abc', Accept: 'text/html' },
    });
    const texto = JSON.stringify(saneado);
    expect(texto).not.toContain('supersecreta');
    expect(texto).not.toContain('laravel_session');
    expect(texto).not.toContain('TOK');
    // Lo que no es secreto sí se conserva: el snapshot tiene que servir.
    expect(texto).toContain('SGL00510');
  });

  it('el snapshot guardado en submission no contiene la contraseña', async () => {
    const repositorio = repositorioFalso();
    await submitEntry({
      entryId: '11111111-1111-1111-1111-111111111111',
      triggeredByProfileId: '22222222-2222-2222-2222-222222222222',
      datos: DATOS,
      credenciales: { usuario: 'club@ejemplo.test', password: 'supersecreta' },
      config: CONFIG_COMPLETA,
      repositorio,
      fetchImpl: vi.fn<typeof fetch>(),
      modo: { activo: true, simulacion: true },
    });

    const serializado = JSON.stringify(repositorio.registros[0]);
    expect(serializado).not.toContain('supersecreta');
    expect(serializado).not.toContain('club@ejemplo.test');
  });

  it('redactar nunca deja ver una pista del secreto', () => {
    expect(redactar('supersecreta')).toBe('[omitido]');
  });
});

describe('cifrado de credenciales (AES-256-GCM)', () => {
  it('sin CREDENTIAL_ENCRYPTION_KEY no se puede recordar nada', () => {
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', '');
    expect(hayClaveDeCifrado()).toBe(false);
    expect(() => cifrarCredencial('lo que sea')).toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
    vi.unstubAllEnvs();
  });

  it('rechaza una clave que no mida 32 bytes', () => {
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', Buffer.alloc(16, 1).toString('base64'));
    expect(() => cifrarCredencial('lo que sea')).toThrow(/32 bytes/);
    vi.unstubAllEnvs();
  });

  it('cifra y descifra de ida y vuelta', () => {
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', CLAVE_DE_PRUEBA);
    const original = 'contraseña con acentos y símbolos ñ€!';
    const cifrada = cifrarCredencial(original);
    expect(cifrada).not.toContain(original);
    expect(cifrada.startsWith('gcm1.')).toBe(true);
    expect(descifrarCredencial(cifrada)).toBe(original);
    vi.unstubAllEnvs();
  });

  it('usa un IV distinto cada vez: el mismo texto da cifrados distintos', () => {
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', CLAVE_DE_PRUEBA);
    expect(cifrarCredencial('igual')).not.toBe(cifrarCredencial('igual'));
    vi.unstubAllEnvs();
  });

  it('falla si el texto cifrado se ha manipulado (autenticación GCM)', () => {
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', CLAVE_DE_PRUEBA);
    const cifrada = cifrarCredencial('contraseña');
    const partes = cifrada.split('.');
    // Se cambia un byte del texto cifrado.
    const manipulado = Buffer.from(partes[3], 'base64url');
    manipulado[0] ^= 0xff;
    partes[3] = manipulado.toString('base64url');
    expect(() => descifrarCredencial(partes.join('.'))).toThrow(/No se pudo descifrar/);
    vi.unstubAllEnvs();
  });

  it('el AAD ata la credencial a un club: no vale copiarla a otro', () => {
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', CLAVE_DE_PRUEBA);
    const cifrada = cifrarCredencial('contraseña', 'club-a');
    expect(descifrarCredencial(cifrada, 'club-a')).toBe('contraseña');
    expect(() => descifrarCredencial(cifrada, 'club-b')).toThrow(/No se pudo descifrar/);
    vi.unstubAllEnvs();
  });

  it('rechaza un formato desconocido en vez de intentar adivinarlo', () => {
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', CLAVE_DE_PRUEBA);
    expect(() => descifrarCredencial('contraseña-en-claro')).toThrow(/formato esperado/);
    vi.unstubAllEnvs();
  });
});
