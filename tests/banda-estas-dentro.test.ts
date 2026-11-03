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
vi.mock('@/app/(app)/explorar/resultados-evento', () => ({ resultadosDelEvento: vi.fn() }));

const { BandaEstasDentro, BandaFuentes } = await import(
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

  it('sin evento abierto y sin fallo no pinta nada mientras llega (ni esqueleto)', () => {
    const html = render(
      propsDeLectura(SIN_EVENTO as LecturaDeEvento<QuienVa>),
    );
    expect(html).toBe('');
  });
});

describe('BandaEstasDentro: de qué fuente es la lista y a dónde salta', () => {
  const ENTRIES = 'https://fie.org/competition/2027/1410/entries';
  const FICHA = 'https://fie.org/competition/2027/1410';
  const SKERMO = 'https://app.skermo.org/calendar/public/rfee#detail5';

  function renderCon(
    p: Partial<CompetitionView>,
    props: { inscritos: QuienVa | null; fallo?: boolean },
  ) {
    return renderToStaticMarkup(
      React.createElement(BandaEstasDentro, {
        evento,
        prueba: { ...prueba, ...p } as CompetitionView,
        ...props,
      }),
    );
  }

  const conLista = () =>
    datos({
      oficiales: [inscrito('prueba-a', 'Garcia Luis'), inscrito('prueba-a', 'Perez Ana')],
      estados: { 'prueba-a': 'con_datos' },
    });

  it('FIE: lo que se ve son sólo los españoles y la completa está en fie.org', () => {
    const html = renderCon(
      { sourceUrl: ENTRIES },
      { inscritos: conLista() },
    );
    expect(html).toContain('Lista de la FIE');
    expect(html).toContain('sólo los españoles');
    expect(html).toContain(`href="${ENTRIES}"`);
    expect(html).toContain('Todos los países en fie.org');
    // La cifra se lee como «españoles», no como la lista entera.
    expect(html).toContain('españoles');
    expect(html).not.toContain('Inscritos en Skermo');
  });

  it('Skermo: la lista es la inscripción de Skermo, sin matiz de incompleta', () => {
    const html = renderCon({ sourceUrl: SKERMO }, { inscritos: conLista() });
    expect(html).toContain('Lista de Skermo');
    expect(html).toContain(`href="${SKERMO}"`);
    expect(html).toContain('Inscritos en Skermo');
    expect(html).not.toContain('sólo los españoles');
    expect(html).not.toContain('fie.org');
  });

  it('unidas: nombra las dos fuentes, matiza la parte de la FIE y enlaza las dos', () => {
    const html = renderCon(
      { sourceUrl: SKERMO, inscritosFieUrl: ENTRIES },
      { inscritos: conLista() },
    );
    expect(html).toContain('Lista de Skermo y de la FIE');
    expect(html).toContain('de la FIE, sólo los españoles');
    expect(html).toContain(`href="${ENTRIES}"`);
    expect(html).toContain(`href="${SKERMO}"`);
    // La cuenta es de la lista unida, no de «españoles».
    expect(html).not.toMatch(/>\s*2\s*españoles/);
  });

  it('sin lista aquí pero con fuente, la banda se queda para saltar a la oficial', () => {
    const html = renderCon(
      { sourceUrl: ENTRIES },
      { inscritos: datos({ estados: { 'prueba-a': 'sin_consultar' } }) },
    );
    expect(html).toContain('Todavía no hay lista');
    expect(html).toContain('Todos los países en fie.org');
    expect(html).toContain(`href="${ENTRIES}"`);
  });

  it('sin lista ni fuente sigue sin pintarse, como antes', () => {
    const html = renderCon(
      {},
      { inscritos: datos({ estados: { 'prueba-a': 'sin_consultar' } }) },
    );
    expect(html).toBe('');
  });
});

describe('BandaFuentes: la prueba en las fuentes oficiales', () => {
  const ENTRIES = 'https://fie.org/competition/2027/1410/entries';
  const FICHA = 'https://fie.org/competition/2027/1410';
  const FTL = 'https://www.fencingtimelive.com/tournaments/eventSchedule/ABC';
  const ENGARDE = 'https://engarde-service.com/competition/rfee/x/fma';

  function renderHub(p: Partial<CompetitionView>, e: Partial<EventView> = {}) {
    return renderToStaticMarkup(
      React.createElement(BandaFuentes, {
        evento: { ...evento, ...e } as EventView,
        prueba: { ...prueba, ...p } as CompetitionView,
      }),
    );
  }

  it('internacional: inscritos de la FIE, resultados del directo y la ficha', () => {
    const html = renderHub({
      sourceUrl: ENTRIES,
      enlacesDirectos: [{ url: FTL, proveedor: 'ftl' }],
    });
    expect(html).toContain('En las fuentes');
    expect(html).toContain('Inscritos · FIE');
    expect(html).toContain('Resultados · Fencing Time Live');
    expect(html).toContain('La prueba · FIE');
    expect(html).toContain(`href="${ENTRIES}"`);
    expect(html).toContain(`href="${FTL}"`);
    expect(html).toContain(`href="${FICHA}"`);
    // Se abren en otra pestaña, avisado.
    expect(html).toContain('target="_blank"');
  });

  it('conviven varios proveedores: Engarde, Fencing Time Live y Fencing Worldwide', () => {
    const html = renderHub({
      enlacesDirectos: [
        { url: ENGARDE, proveedor: 'engarde' },
        { url: FTL, proveedor: 'ftl' },
        { url: 'https://www.fencingworldwide.com/en/12345', proveedor: 'ophardt' },
      ],
    });
    expect(html).toContain('Resultados · Engarde');
    expect(html).toContain('Resultados · Fencing Time Live');
    expect(html).toContain('Resultados · Fencing Worldwide');
  });

  it('el directo del torneo entero completa una prueba sin enlaces propios', () => {
    const html = renderHub(
      {},
      { enlacesDirectos: [{ url: ENGARDE, proveedor: 'engarde' }] },
    );
    expect(html).toContain('Resultados · Engarde');
    expect(html).toContain(`href="${ENGARDE}"`);
  });

  it('sin nada que ofrecer no se pinta', () => {
    expect(renderHub({})).toBe('');
  });
});
