import { describe, expect, it } from 'vitest';
import { construirAvisosCalendario, type EventoCalendario } from '@/lib/notificaciones/calendario';
import { construirAvisosResultados } from '@/lib/notificaciones/agrupar';
import { destinoDeAviso, destinoEvento, destinoPerfil, destinoResultados } from '@/lib/notificaciones/destinos';
import { construirAvisosPerfil } from '@/lib/notificaciones/perfil';
import { PREFERENCIAS_POR_DEFECTO } from '@/lib/notificaciones/tipos';

const EV = 'aaaaaaaa-0000-4000-8000-000000000001';
const ED = 'bbbbbbbb-0000-4000-8000-000000000001';
const PR = 'cccccccc-0000-4000-8000-000000000001';
const PE = 'dddddddd-0000-4000-8000-000000000001';
const SIN_PREFS = new Map();

describe('cada aviso abre su destino exacto', () => {
  it('resultados: la prueba de la edición, con la persona resaltada si es una sola', () => {
    expect(destinoResultados({ edicionId: ED, pruebaId: PR, personaId: PE })).toBe(`/explorar/ediciones/${ED}?prueba=${PR}&persona=${PE}`);
    const prueba = { competitionId: PR, editionId: ED, nombreEdicion: 'Copa', arma: 'ESPADA', genero: 'F', categoria: 'ABS', formato: 'INDIVIDUAL' } as never;
    const una = construirAvisosResultados(prueba, [
      { profileId: 'p', motivo: 'seguidos', clavePersona: 'a', personaId: PE, nombre: 'Ana', puesto: 3 },
    ], SIN_PREFS, PREFERENCIAS_POR_DEFECTO);
    expect(una[0].url).toBe(`/explorar/ediciones/${ED}?prueba=${PR}&persona=${PE}`);
    const varias = construirAvisosResultados(prueba, [
      { profileId: 'p', motivo: 'seguidos', clavePersona: 'a', personaId: PE, nombre: 'Ana', puesto: 3 },
      { profileId: 'p', motivo: 'seguidos', clavePersona: 'b', personaId: null, nombre: 'Bea', puesto: 5 },
    ], SIN_PREFS, PREFERENCIAS_POR_DEFECTO);
    expect(varias[0].url).toBe(`/explorar/ediciones/${ED}?prueba=${PR}`);
  });

  it('perfil: la sección Ranking de la persona', () => {
    expect(destinoPerfil(PE)).toBe(`/explorar/${PE}/ranking`);
    const [aviso] = construirAvisosPerfil(PE, 'Ana', [{ clave: 'nacional:x', antes: '2025-2026|8', ahora: '2025-2026|5', texto: 't' }], ['p'], SIN_PREFS);
    expect(aviso.url).toBe(`/explorar/${PE}/ranking`);
  });

  it('calendario: el mes del torneo, su nombre y su ficha', () => {
    const evento: EventoCalendario = {
      id: EV, name: 'Copa de España', startDate: '2026-11-07', endDate: '2026-11-08', city: null,
      competitions: [{ weapon: 'ESPADA', gender: 'F', category: 'ABS', format: 'INDIVIDUAL', deadlines: [] }],
    };
    expect(destinoEvento(evento)).toBe(`/?mes=2026-11&q=Copa+de+Espa%C3%B1a&evento=${EV}`);
    const [aviso] = construirAvisosCalendario(
      [{ profileId: 'p', armas: null, generos: null, categorias: null }],
      [evento], new Set([EV]), new Date('2026-10-08T10:00:00Z'), SIN_PREFS,
    );
    expect(aviso.url).toBe(destinoEvento(evento));
  });

  it('los avisos ya guardados se ponen al día al leerlos, sin tocar lo que ya era exacto', () => {
    expect(destinoDeAviso({ url: '/?mes=2026-11&q=Copa', grupo: `evento:${EV}` })).toBe(`/?mes=2026-11&q=Copa&evento=${EV}`);
    expect(destinoDeAviso({ url: `/?mes=2026-11&evento=${EV}`, grupo: `evento:${EV}` })).toBe(`/?mes=2026-11&evento=${EV}`);
    expect(destinoDeAviso({ url: `/explorar/${PE}`, grupo: `persona:${PE}` })).toBe(`/explorar/${PE}/ranking`);
    const resultados = `/explorar/ediciones/${ED}?prueba=${PR}`;
    expect(destinoDeAviso({ url: resultados, grupo: `competicion:${PR}` })).toBe(resultados);
    expect(destinoDeAviso({ url: 'https://fuera.example', grupo: `evento:${EV}` })).toBe('/notificaciones');
    expect(destinoDeAviso({ url: '//fuera.example', grupo: 'prueba' })).toBe('/notificaciones');
  });
});
