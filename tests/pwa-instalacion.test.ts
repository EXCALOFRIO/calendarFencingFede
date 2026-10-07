import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  CLAVE_INSTALACION, crearCooldown, DIA, escucharInstalacion,
  estaInstalada, plataformaIOS, solicitarInstalacion, type EventoInstalacion,
} from '@/components/pwa/instalacion';

test('iPhone, iPad de escritorio y navegadores iOS sin prometer prompt nativo', () => {
  assert.equal(plataformaIOS('iPhone Version/18.0 Mobile Safari/605', 5), 'ios-safari');
  assert.equal(plataformaIOS('Macintosh Version/18.0 Safari/605', 5), 'ios-safari');
  assert.equal(plataformaIOS('Macintosh Version/18.0 Safari/605', 0), null);
  assert.equal(plataformaIOS('iPhone CriOS/130 Mobile Safari/605', 5), 'ios-otro');
  assert.equal(plataformaIOS('iPhone FxiOS/130 Mobile', 5), 'ios-otro');
  assert.equal(plataformaIOS('Android Chrome/130 Mobile Safari/537', 5), null);
});

test('standalone de iOS y modos instalados no ofrecen invitación', () => {
  assert.equal(estaInstalada({ standalone: true }, () => false), true);
  for (const modo of ['standalone', 'fullscreen', 'minimal-ui']) {
    assert.equal(estaInstalada({}, (q) => q === `(display-mode: ${modo})`), true);
  }
  assert.equal(estaInstalada({}, () => false), false);
});

test('cooldown versionado: impresión, descarte, aceptación y expiración', () => {
  const datos = new Map<string, string>();
  const storage = { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => { datos.set(k, v); } };
  const cooldown = crearCooldown(() => storage);
  assert.equal(cooldown.activo(100), false);
  for (const dias of [7, 30, 180]) {
    cooldown.guardar(dias, 100);
    assert.equal(datos.get(CLAVE_INSTALACION), String(100 + dias * DIA));
    assert.equal(crearCooldown(() => storage).activo(101), true);
    assert.equal(cooldown.activo(100 + dias * DIA), false);
  }
  datos.set(CLAVE_INSTALACION, 'valor corrupto');
  assert.equal(crearCooldown(() => storage).activo(100), false);
});

test('almacenamiento inaccesible conserva cooldown en memoria sin lanzar', () => {
  const cooldown = crearCooldown(() => { throw new Error('SecurityError'); });
  assert.equal(cooldown.activo(100), false);
  cooldown.guardar(30, 100);
  assert.equal(cooldown.activo(101), true);
  assert.equal(cooldown.activo(100 + 30 * DIA), false);
});

test('beforeinstallprompt se captura sin invocar prompt; limpieza y appinstalled', async () => {
  const destino = new EventTarget();
  let llamadas = 0;
  let instalaciones = 0;
  let recibido: EventoInstalacion | undefined;
  const evento = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: async () => { llamadas++; },
    userChoice: Promise.resolve({ outcome: 'accepted' as const }),
  });
  const limpiar = escucharInstalacion(destino as Window, (e) => { recibido = e; }, () => { instalaciones++; });
  destino.dispatchEvent(evento);
  assert.equal(evento.defaultPrevented, true);
  assert.equal(recibido, evento);
  assert.equal(llamadas, 0);
  assert.equal(await solicitarInstalacion(recibido!), 'accepted');
  assert.equal(llamadas, 1);
  destino.dispatchEvent(new Event('appinstalled'));
  assert.equal(instalaciones, 1);
  limpiar();
  destino.dispatchEvent(new Event('appinstalled'));
  assert.equal(instalaciones, 1);
});

test('cancelación y error de prompt no fallan ni reabren la solicitud', async () => {
  const base = new Event('beforeinstallprompt');
  assert.equal(await solicitarInstalacion(Object.assign(base, {
    prompt: async () => {},
    userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
  })), 'dismissed');
  assert.equal(await solicitarInstalacion(Object.assign(base, {
    prompt: async () => { throw new Error('no disponible'); },
    userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
  })), 'error');
});

test('SW no intercepta datos privados y limpia solo cachés estáticas antiguas', async () => {
  const eventos = new Map<string, (e: unknown) => void>();
  const borradas: string[] = [];
  const notificaciones: unknown[][] = [];
  const mensajes: unknown[] = [];
  let reclamadas = 0;
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    URL,
    self: {
      addEventListener: (tipo: string, cb: (e: unknown) => void) => eventos.set(tipo, cb),
      skipWaiting: async () => {},
      location: { origin: 'https://prueba.invalid' },
      registration: { showNotification: async (...args: unknown[]) => { notificaciones.push(args); } },
      clients: {
        claim: async () => { reclamadas++; },
        matchAll: async () => [{ postMessage: (mensaje: unknown) => mensajes.push(mensaje) }],
      },
    },
    caches: {
      keys: async () => ['calendarfencing-estaticos-v1', 'calendarfencing-otra', 'otra-app'],
      delete: async (nombre: string) => { borradas.push(nombre); },
      open: () => assert.fail('No debe abrir/escribir cachés'),
    },
  });
  assert.equal(eventos.has('fetch'), false);
  let pendiente: Promise<unknown> = Promise.resolve();
  eventos.get('activate')!({ waitUntil: (p: Promise<unknown>) => { pendiente = p; } });
  await pendiente;
  assert.deepEqual(borradas, ['calendarfencing-estaticos-v1']);
  assert.equal(reclamadas, 1);
  eventos.get('push')!({
    data: { json: () => ({ titulo: 'Prueba sintética', cuerpo: 'Sin envío', url: '/ranking', etiqueta: 'prueba' }) },
    waitUntil: (p: Promise<unknown>) => { pendiente = p; },
  });
  await pendiente;
  assert.equal(notificaciones[0][0], 'Prueba sintética');
  assert.equal((notificaciones[0][1] as { data: { url: string } }).data.url, '/ranking');
  assert.equal((mensajes[0] as { tipo: string }).tipo, 'notificacion');
  assert.equal(eventos.has('notificationclick'), true);
});
