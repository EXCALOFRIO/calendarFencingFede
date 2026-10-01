import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  SIN_EVENTO,
  aplicarLecturaDeEvento,
  datosVigentes,
  lecturaDelEvento,
  type LecturaDeEvento,
} from '@/lib/entries/lectura';
import type { QuienVa } from '@/app/(app)/inscritos';
import type { CompetitionView, EventView } from '@/lib/queries/calendar';

vi.mock('@/app/(app)/detalle-evento', () => ({ detalleDelEvento: vi.fn() }));

const { BandaEstasDentro } = await import(
  '@/components/calendario/ficha-evento'
);

const AVISO = 'La última lectura falló';
const SIN_LECTURA = 'No se ha podido leer la lista de inscritos';

const evento = { id: 'ev-1', source: 'fie' } as unknown as EventView;
const prueba = {
  id: 'prueba-a',
  registrationCount: null,
} as unknown as CompetitionView;

function datos(parcial: Partial<QuienVa> = {}): QuienVa {
  return { oficiales: [], estados: {}, pendientes: [], ...parcial };
}

function inscrito(competitionId: string, nombre: string) {
  return {
    competitionId,
    nombre,
    club: null,
    equipo: null,
    esMio: false,
  } as unknown as QuienVa['oficiales'][number];
}

/** Misma derivación que hace `vista.tsx` a partir de la lectura del evento. */
function propsDeLectura(lectura: LecturaDeEvento<QuienVa>) {
  const l = lecturaDelEvento(lectura, 'ev-1');
  return { inscritos: datosVigentes(l), fallo: l.tipo === 'error' };
}

function render(props: { inscritos: QuienVa | null; fallo?: boolean }) {
  return renderToStaticMarkup(
    React.createElement(BandaEstasDentro, { evento, prueba, ...props }),
  );
}

describe('BandaEstasDentro: aviso de lectura fallida', () => {
  it('avisa tras una lectura válida vacía seguida de un error, sin perder la lista', () => {
    let lectura: LecturaDeEvento<QuienVa> = {
      eventoId: 'ev-1',
      lectura: { tipo: 'sin_consultar' },
    };
    lectura = aplicarLecturaDeEvento(
      lectura,
      'ev-1',
      { ok: true, datos: datos({ estados: { 'prueba-a': 'vacia' } }) },
    );
    lectura = aplicarLecturaDeEvento(lectura, 'ev-1', { ok: false });

    const props = propsDeLectura(lectura);
    expect(props.fallo).toBe(true);
    expect(props.inscritos).not.toBeNull();

    const html = render(props);
    expect(html).toContain(AVISO);
    expect(html).toContain('Lista vacía');
    expect(html).not.toContain(SIN_LECTURA);
  });

  it('avisa aunque la prueba seleccionada no tenga filas y otra prueba sí', () => {
    const html = render({
      inscritos: datos({
        oficiales: [inscrito('otra-prueba', 'PEREZ ANA')],
        estados: { 'prueba-a': 'sin_consultar', 'otra-prueba': 'con_datos' },
      }),
      fallo: true,
    });
    expect(html).toContain(AVISO);
    expect(html).toContain('Todavía no hay lista');
    expect(html).not.toContain('PEREZ');
  });

  it('sigue avisando con filas retenidas', () => {
    const html = render({
      inscritos: datos({
        oficiales: [inscrito('prueba-a', 'Garcia Luis')],
        estados: { 'prueba-a': 'con_datos' },
      }),
      fallo: true,
    });
    expect(html).toContain(AVISO);
    expect(html).toContain('Garcia');
  });

  it('no avisa cuando la lectura es correcta, vacía o con filas', () => {
    expect(
      render({ inscritos: datos({ estados: { 'prueba-a': 'vacia' } }) }),
    ).not.toContain(AVISO);
    expect(
      render({
        inscritos: datos({ oficiales: [inscrito('prueba-a', 'Garcia Luis')] }),
        fallo: false,
      }),
    ).not.toContain(AVISO);
  });

  it('sin lectura previa un fallo conserva su mensaje de error propio', () => {
    const inicial: LecturaDeEvento<QuienVa> = {
      eventoId: 'ev-1',
      lectura: { tipo: 'sin_consultar' },
    };
    const lectura = aplicarLecturaDeEvento(inicial, 'ev-1', { ok: false });
    const html = render(propsDeLectura(lectura));
    expect(html).toContain(SIN_LECTURA);
    expect(html).not.toContain(AVISO);
    expect(html).not.toContain('Lista vacía');
  });

  it('sin evento abierto y sin fallo muestra la carga', () => {
    const html = render(
      propsDeLectura(SIN_EVENTO as LecturaDeEvento<QuienVa>),
    );
    expect(html).toContain('Mirando quién va');
    expect(html).not.toContain(AVISO);
  });
});
