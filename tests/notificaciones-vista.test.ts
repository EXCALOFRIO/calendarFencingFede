import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { describe, expect, it } from 'vitest';
import { AjustesNotificaciones, nombreDispositivo, type AccionesAjustes } from '@/components/notificaciones/ajustes';
import { AccionesNotificaciones, BandejaNotificaciones } from '@/components/notificaciones/bandeja';
import { cabeceraDeRuta } from '@/components/navegacion-app';
import { CampanaCliente, etiquetaCampana } from '@/components/notificaciones/campana-cliente';
import { agruparBandeja, type FilaBandeja } from '@/lib/notificaciones/bandeja';
import { PREFERENCIAS_POR_DEFECTO } from '@/lib/notificaciones/tipos';

const ROUTER = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
function html(el: React.ReactElement, ruta = '/'): string {
  return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: ROUTER as never },
    React.createElement(PathnameContext.Provider, { value: ruta }, el)));
}

const AHORA = new Date('2026-03-08T19:00:00Z');
const fila = (id: string, grupo: string, horas: number, extra: Partial<FilaBandeja> = {}): FilaBandeja => ({
  id: `00000000-0000-4000-8000-${id.padStart(12, '0')}`, tipo: 'perfil', grupo, titulo: `Aviso ${id}`, cuerpo: 'Copa de España',
  url: '/explorar', datos: null, leida: false,
  creadaEn: AHORA.getTime() - horas * 3_600_000, actualizadaEn: AHORA.getTime() - horas * 3_600_000, ...extra,
});

const ACCIONES: AccionesAjustes = {
  guardarPreferencia: async () => ({ ok: true, mensaje: '' }),
  suscribir: async () => ({ ok: true, mensaje: '' }),
  desuscribir: async () => ({ ok: true, mensaje: '' }),
  probar: async () => ({ ok: true, mensaje: '' }),
};

describe('campana', () => {
  it('sin avisos no hay punto; con avisos, un punto rojo sin número y la cifra en la etiqueta accesible', () => {
    const sin = html(React.createElement(CampanaCliente, { inicial: 0 }));
    expect(sin).not.toContain('data-punto');
    const con = html(React.createElement(CampanaCliente, { inicial: 12 }));
    expect(con).toContain('href="/notificaciones"');
    expect(con).toContain('aria-label="Notificaciones, 12 sin leer"');
    expect(con).toContain('data-punto');
    expect(con).not.toMatch(/>\d+\+?</);
    // Se ve de 36 px y la caja del enlace mide 44 (la que mide la matriz de dispositivos).
    expect(con).toContain('size-[36px]');
    expect(con).toMatch(/<a [^>]*class="[^"]*h-\[44px\][^"]*min-w-\[44px\]/);
    expect(etiquetaCampana(0)).toBe('Notificaciones');
  });

  it('en /notificaciones se marca como la página actual', () => {
    expect(html(React.createElement(CampanaCliente, { inicial: 1 }), '/notificaciones')).toContain('aria-current="page"');
  });
});

describe('bandeja', () => {
  it('una fila por competición, los anteriores solo contados y un punto en lo no leído', () => {
    const filas = [
      fila('1', 'competicion:a', 1, { tipo: 'inscripciones', datos: { lineas: [
        { nombre: 'Lucía García', puesto: 3, motivo: 'perfil' }, { nombre: 'Marta García', puesto: 12, motivo: 'perfil' },
      ] } }),
      fila('2', 'competicion:a', 5, { leida: true, titulo: 'Anterior' }),
      fila('3', 'evento:b', 30, { tipo: 'calendario', leida: true }),
    ];
    const secciones = agruparBandeja(filas, AHORA, new Date('2026-03-08T00:00:00Z').getTime());
    const salida = html(React.createElement(BandejaNotificaciones, { secciones, ahora: AHORA.getTime(), abrir: '/abrir' }));
    expect(salida.match(/<button type="submit"/g)).toHaveLength(2);
    expect(salida).toMatch(/>hace 1 h<\/time> · 2 avisos</);
    expect(salida).not.toContain('Anterior');
    expect(salida).not.toContain('<details');
    // Escala del sistema: 14 / 13 / 12 px, nada por debajo.
    expect(salida).not.toMatch(/text-\[(?:[0-9]|1[01])px\]|text-xs|text-\[10px\]/);
    expect(salida).not.toMatch(/(?:bg|text|divide|border)-[a-z-]+\/\d+/);
    expect(salida).toContain('Lucía García');
    expect(salida).toContain('3.º');
    expect(salida.match(/Sin leer/g)).toHaveLength(1);
    expect(salida).toContain('>Hoy<');
    expect(salida).toContain('>Esta semana<');
  });

  it('vacía, explica qué llegará y lleva a los ajustes', () => {
    const salida = html(React.createElement(BandejaNotificaciones, { secciones: [], ahora: AHORA.getTime(), abrir: '/abrir' }));
    expect(salida).toContain('Sin avisos');
    expect(salida).toContain('Elegir avisos');
    expect(salida).toContain('href="/ajustes/notificaciones"');
  });

  it('«Marcar todo leído» solo si hay algo sin leer, con caja de toque de 44 y pastilla de 32; sin <h1> propio', () => {
    const con = html(React.createElement(AccionesNotificaciones, { hayNoLeidas: true, marcarTodas: '/x' }));
    expect(con).toContain('Marcar todo leído');
    expect(con).toMatch(/<button type="submit" class="[^"]*h-\[44px\]/);
    expect(con).toContain('h-[32px]');
    expect(con).toContain('aria-label="Ajustes de notificaciones"');
    expect(con).not.toContain('<h1');
    expect(html(React.createElement(AccionesNotificaciones, { hayNoLeidas: false, marcarTodas: '/x' }))).not.toContain('Marcar todo leído');
  });

  it('el título de las dos pantallas lo pone la cabecera compacta', () => {
    expect(cabeceraDeRuta('/notificaciones', false)).toMatchObject({ variante: 'subpantalla', titulo: 'Notificaciones' });
    expect(cabeceraDeRuta('/ajustes/notificaciones', false)).toMatchObject({ variante: 'subpantalla', titulo: 'Ajustes', volverA: '/notificaciones' });
    for (const f of ['src/app/(app)/notificaciones/page.tsx', 'src/app/(app)/ajustes/notificaciones/page.tsx']) {
      expect(readFileSync(f, 'utf8')).not.toContain('<h1');
    }
  });
});

describe('ajustes', () => {
  const ajustes = (extra: Partial<React.ComponentProps<typeof AjustesNotificaciones>> = {}) => html(React.createElement(AjustesNotificaciones, {
    preferencias: { ...PREFERENCIAS_POR_DEFECTO, 'tipo:seguidos': false }, vapidPublica: 'B', soloLectura: false, acciones: ACCIONES, ...extra,
  }));

  it('un interruptor por tipo y por canal, cada uno con su explicación de una línea', () => {
    const salida = ajustes({ estadoInicial: 'apagado' });
    expect(salida.match(/role="switch"/g)).toHaveLength(6);
    for (const nombre of ['Tus inscripciones', 'Siguiendo', 'Tu perfil', 'Tu calendario', 'Campana', 'Móvil']) {
      expect(salida).toContain(nombre);
    }
    expect(salida).toMatch(/id="pref-tipo-seguidos"[^>]*aria-checked="false"|aria-checked="false"[^>]*id="pref-tipo-seguidos"/);
    expect(salida.match(/aria-describedby="pref-/g)).toHaveLength(6);
    expect(salida).toContain('Enviar prueba');
    expect(salida).toContain('>Activar</span></button>');
    expect(salida).toContain('Solo nombre, prueba y puesto');
    // Los interruptores se tocan en una caja real de 44 px, sin alfa en las superficies ni texto de menos de 12 px.
    expect(salida.match(/role="switch"[^>]*class="[^"]*h-\[44px\]/g)).toHaveLength(6);
    expect(salida).not.toMatch(/(?:bg|text|divide|border)-[a-z-]+\/\d+/);
    expect(salida).not.toMatch(/text-\[(?:[0-9]|1[01])px\]|text-xs/);
    // Los pasos de iPhone no están en la página hasta que se piden: nada oculto.
    expect(salida).not.toContain('Añadir a pantalla de inicio');
  });

  it('en iPhone sin instalar abre los pasos de «Añadir a pantalla de inicio»', () => {
    const salida = ajustes({ estadoInicial: 'ios-instalar', ios: true });
    expect(salida).toContain('aria-expanded="true"');
    expect(salida).toContain('Añadir a pantalla de inicio');
    expect(salida).toContain('iOS 16.4');
    expect(salida).not.toContain('>Activar</span></button>');
  });

  it('en solo lectura los interruptores están deshabilitados', () => {
    const salida = ajustes({ soloLectura: true, estadoInicial: 'apagado' });
    expect(salida).toContain('solo lectura');
    expect(salida.match(/role="switch"[^>]*disabled=""|disabled=""[^>]*role="switch"/g)).toHaveLength(6);
  });

  it('el nombre del dispositivo no lleva más que sistema y navegador', () => {
    expect(nombreDispositivo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari');
    expect(nombreDispositivo('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36')).toBe('Android · Chrome');
  });
});

describe('trabajador de servicio', () => {
  const sw = readFileSync('public/sw.js', 'utf8');
  it('maneja push y notificationclick, siempre muestra la notificación y solo abre rutas internas', () => {
    expect(sw).toContain("addEventListener('push'");
    expect(sw).toContain("addEventListener('notificationclick'");
    expect(sw).toContain('showNotification');
    expect(sw).toContain('openWindow');
    // La misma regla que `esRutaInterna`.
    const rutaSegura = new Function(`${/const RUTA_BANDEJA[\s\S]*?function rutaSegura[\s\S]*?\n}/.exec(sw)![0]}; return rutaSegura;`)() as (u: unknown) => string;
    expect(rutaSegura('/explorar/x?y=1')).toBe('/explorar/x?y=1');
    expect(rutaSegura('https://malo.test')).toBe('/notificaciones');
    expect(rutaSegura('//malo.test')).toBe('/notificaciones');
    expect(rutaSegura(undefined)).toBe('/notificaciones');
  });
});
