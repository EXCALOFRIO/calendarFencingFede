import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormularioAcceso, type AccionAcceso } from '@/components/acceso/formulario-acceso';
import { limpiarCodigo } from '@/components/acceso/codigo';
import { ErrorAcceso } from '@/lib/auth/errores';
import EntrarPage from '@/app/entrar/page';

// La prueba DOM/CSS real vive en acceso-hidratado.mts, sin la configuración
// PostCSS de Next (que Vite no interpreta).
vi.mock('@/components/acceso/formulario-acceso.module.css', () => ({ default: {} }));

const h = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  set: vi.fn(), remove: vi.fn(), send: vi.fn(), verify: vi.fn(),
  headers: new Headers({ origin: 'https://example.test' }),
}));
vi.mock('next/headers', () => ({
  headers: async () => h.headers,
  cookies: async () => ({
    has: (key: string) => h.cookies.has(key),
    get: (key: string) => h.cookies.has(key) ? { value: h.cookies.get(key) } : undefined,
    set: h.set, delete: h.remove,
  }),
}));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock('@/lib/auth/server', () => ({ getAuth: () => ({ api: { sendVerificationOTP: h.send, signInEmailOTP: h.verify } }) }));
vi.mock('@/lib/auth/session', () => ({ getSessionProfile: async () => null }));
vi.mock('@/lib/auth/preview-token', () => ({ COOKIE_VISTA_PREVIA: 'preview-test' }));
vi.mock('@/lib/auth/qa-token', () => ({ COOKIE_ACCESO_QA: 'qa-test' }));

function buscarFormulario(node: React.ReactNode): React.ComponentProps<typeof FormularioAcceso> | undefined {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return;
  if (node.type === FormularioAcceso) return node.props as React.ComponentProps<typeof FormularioAcceso>;
  for (const child of React.Children.toArray(node.props.children)) {
    const props = buscarFormulario(child);
    if (props) return props;
  }
}
async function acciones(codigo = true) {
  const page = await EntrarPage({ searchParams: Promise.resolve(codigo ? { paso: 'codigo' } : {}) });
  return buscarFormulario(page)!;
}
const datos = (nombre: string, valor: string) => {
  const form = new FormData();
  form.set(nombre, valor);
  return form;
};
// Sintético y generado solo durante la prueba; jamás snapshot ni logging del código.
const codigoSintetico = () => [0, ...Array.from({ length: 5 }, (_, i) => i + 1)].join('');

beforeEach(() => {
  vi.clearAllMocks();
  h.cookies.clear();
  h.cookies.set('entrar_correo', 'persona@example.test');
  h.send.mockResolvedValue({ success: true });
  h.verify.mockRejectedValue(new ErrorAcceso(400));
});

describe('entrada accesible', () => {
  it('normaliza espacios de paste/autofill sin perder ceros iniciales', () => {
    const codigo = codigoSintetico();
    expect(limpiarCodigo(` ${codigo.slice(0, 3)}\u00a0${codigo.slice(3)}\n`) === codigo).toBe(true);
    expect(limpiarCodigo(`x${codigo}extra`).length).toBe(6);
  });
  it('convierte cifras de ancho completo en vez de borrarlas', () => {
    const ancho = codigoSintetico().replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d)));
    expect(limpiarCodigo(ancho) === codigoSintetico()).toBe(true);
    expect(limpiarCodigo(`${ancho}９`).length).toBe(6);
  });
  it('renderiza un único input real con etiqueta, ayuda y error asociados', () => {
    const accion: AccionAcceso = async () => ({});
    const html = renderToStaticMarkup(React.createElement(FormularioAcceso, {
      pasoCodigo: true, accion, reenviar: accion, cambiarCorreo: async () => {}, errorInicial: 'Revisa el código.',
    }));
    expect((html.match(/<input /g) ?? []).length).toBe(1);
    expect(html).toContain('type="text"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="acceso-ayuda acceso-mensaje"');
    // El foco lo pone el cliente al montar el paso del código, no un atributo SSR.
    expect(html).not.toContain('autofocus');
    // Pegar/soltar se limpian antes de este tope: no trunca «123 456».
    expect(html).toContain('maxLength="6"');
    expect(html).toContain('minLength="6"');
    expect(html).not.toContain('href="/entrar"');
    expect(html).toContain('Cambiar correo');
  });
});

describe('acciones de acceso, totalmente aisladas del proveedor', () => {
  it('usa exclusivamente la cookie para verificar y conserva un error genérico', async () => {
    const { accion } = await acciones();
    const form = datos('otp', codigoSintetico());
    form.set('email', 'otra@example.test');
    const result = await accion({}, form);
    expect(result).toEqual({ error: 'El código no es válido o ha caducado. Pide uno nuevo.' });
    expect(h.verify.mock.calls[0][0].body.email).toBe('persona@example.test');
    expect(h.verify.mock.calls[0][0].headers).toBe(h.headers);
    expect(h.remove).not.toHaveBeenCalled();
    expect(Object.keys(result)).toEqual(['error']);
  });
  it.each([true, false])('el envío no enumera cuentas (proveedor resuelve: %s)', async (exito) => {
    if (!exito) h.send.mockRejectedValue(new Error('rechazado'));
    const { accion } = await acciones(false);
    await expect(accion({}, datos('email', 'Persona@example.test'))).rejects.toThrow('REDIRECT:/entrar?paso=codigo');
    expect(h.set).toHaveBeenCalledWith('entrar_correo', 'persona@example.test', expect.objectContaining({
      httpOnly: true, sameSite: 'lax', path: '/entrar', maxAge: 900,
    }));
  });
  it.each([true, false])('reenviar devuelve la misma respuesta y usa la cookie (%s)', async (exito) => {
    if (!exito) h.send.mockRejectedValue(new Error('rechazado'));
    const { reenviar } = await acciones();
    expect(await reenviar({}, datos('email', 'otra@example.test'))).toEqual({
      aviso: 'Si el correo está invitado, recibirás otro código.',
    });
    expect(h.send).toHaveBeenCalledWith({
      body: { email: 'persona@example.test', type: 'sign-in' }, headers: h.headers,
    });
  });
  it.each(['preview-test', 'qa-test'])('ninguna acción acepta el modo %s', async (cookie) => {
    const codigo = await acciones();
    const correo = await acciones(false);
    h.cookies.set(cookie, 'presente');
    for (const accion of [codigo.accion, codigo.reenviar, correo.accion]) {
      await expect(accion({}, new FormData())).rejects.toThrow('REDIRECT:/vista-previa');
    }
    expect(h.send).not.toHaveBeenCalled();
    expect(h.verify).not.toHaveBeenCalled();
  });
  it('sin cookie verificar y reenviar fallan cerrados', async () => {
    const { accion, reenviar } = await acciones();
    h.cookies.clear();
    for (const fn of [accion, reenviar]) {
      await expect(fn({}, new FormData())).rejects.toThrow('REDIRECT:/entrar?error=caducado');
    }
    expect(h.send).not.toHaveBeenCalled();
    expect(h.verify).not.toHaveBeenCalled();
  });
  it.each([new ErrorAcceso(503), new ErrorAcceso(500), new Error('red caída')])(
    'una caída del proveedor no se presenta como código erróneo (%s)', async (fallo) => {
      h.verify.mockRejectedValue(fallo);
      const { accion } = await acciones();
      expect(await accion({}, datos('otp', codigoSintetico()))).toEqual({
        error: 'No se pudo comprobar el código. Inténtalo de nuevo.',
      });
      expect(h.remove).not.toHaveBeenCalled();
    },
  );
  it('normaliza cifras de ancho completo antes de verificar', async () => {
    const { accion } = await acciones();
    const ancho = codigoSintetico().replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d)));
    await accion({}, datos('otp', ancho));
    expect(h.verify.mock.calls[0][0].body.otp === codigoSintetico()).toBe(true);
  });
  it('demasiados códigos: aviso claro, sin avanzar ni recordar el correo', async () => {
    h.send.mockRejectedValue(new ErrorAcceso(429));
    const correo = await acciones(false);
    expect(await correo.accion({}, datos('email', 'persona@example.test'))).toEqual({
      error: 'Has pedido demasiados códigos. Prueba en unos minutos.',
    });
    expect(h.set).not.toHaveBeenCalled();
    const { reenviar } = await acciones();
    expect(await reenviar({}, new FormData())).toEqual({
      error: 'Has pedido demasiados códigos. Prueba en unos minutos.',
    });
  });
  it('cambiar de correo borra la cookie del correo en curso', async () => {
    const { cambiarCorreo } = await acciones();
    await expect(cambiarCorreo()).rejects.toThrow('REDIRECT:/entrar');
    expect(h.remove).toHaveBeenCalledWith({ name: 'entrar_correo', path: '/entrar' });
  });
  it('solo un resultado verificado borra la cookie y permite entrar', async () => {
    h.verify.mockResolvedValue({ user: { id: 'sintetico' } });
    const { accion } = await acciones();
    await expect(accion({}, datos('otp', codigoSintetico()))).rejects.toThrow('REDIRECT:/');
    expect(h.remove).toHaveBeenCalledWith({ name: 'entrar_correo', path: '/entrar' });
  });
});
