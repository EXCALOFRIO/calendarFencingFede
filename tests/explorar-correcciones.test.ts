import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { aIso, textoDeCampo, valorEmitido } from '@/components/admin/campo-fecha';
import { cargarExplorar } from '@/lib/sport/explorar/pantalla';
import {
  CRITERIOS_VACIOS,
  chipsActivos,
  construirUrl,
  etiquetaTemporada,
  leerCriterios,
  opcionesTemporada,
  type CriteriosExplorar,
} from '@/lib/sport/explorar/url';
import { esFechaIsoReal, formatDateEs } from '@/lib/utils';
import { crearContexto } from './helpers/explorar';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/explorar',
}));

const { ChipsActivos } = await import('@/components/explorar/resultados');
const { FormularioFiltros, agruparTemporadas, prepararBusqueda } = await import(
  '@/components/explorar/formulario-filtros'
);

const criterios = (parcial: Partial<CriteriosExplorar>): CriteriosExplorar => ({
  ...CRITERIOS_VACIOS,
  ...parcial,
});

const consultaPrincipal = /FROM sport_person p\s+WHERE/;

describe('selector de temporada con las claves de ambas fuentes', () => {
  it('ofrece FIE «AAAA» y RFEE «AAAA-AAAA» exactos, sin repetir valores y con etiquetas distintas', () => {
    const opciones = opcionesTemporada('2026-10-02', 3);
    expect(opciones.filter((o) => o.fuente === 'FIE').map((o) => o.valor)).toEqual([
      '2027',
      '2026',
      '2025',
    ]);
    expect(opciones.filter((o) => o.fuente === 'RFEE').map((o) => o.valor)).toEqual([
      '2026-2027',
      '2025-2026',
      '2024-2025',
    ]);
    expect(new Set(opciones.map((o) => o.valor)).size).toBe(opciones.length);
    expect(new Set(opciones.map((o) => o.etiqueta)).size).toBe(opciones.length);
    expect(opciones.find((o) => o.valor === '2027')?.etiqueta).toBe('FIE 2027');
    expect(opciones.find((o) => o.valor === '2026-2027')?.etiqueta).toBe('RFEE 2026-2027');
  });

  it('la temporada FIE cambia de año en septiembre igual que la ingestión', () => {
    const fie = (hoy: string) =>
      opcionesTemporada(hoy, 1).find((o) => o.fuente === 'FIE')?.valor;
    expect(fie('2026-08-31')).toBe('2026');
    expect(fie('2026-09-01')).toBe('2027');
  });

  it('un valor FIE elegido en el selector viaja a la URL y llega al servidor sin ser rechazado', async () => {
    const fie = opcionesTemporada('2026-10-02', 1).find((o) => o.fuente === 'FIE');
    expect(fie?.valor).toBe('2027');
    const url = construirUrl(criterios({ temporada: fie?.valor ?? '' }));
    expect(url).toBe('/explorar?temporada=2027');

    const params = Object.fromEntries(new URL(url, 'http://x').searchParams);
    const leidos = leerCriterios(params).criterios;
    const { ctx, sentencias } = crearContexto({
      respuestas: [{ cuando: consultaPrincipal, filas: [] }],
    });
    const vista = await cargarExplorar(ctx, leidos, undefined);
    expect(vista.tipo).toBe('ok');
    expect(sentencias[0].params).toContain('2027');
  });

  it('el chip y el selector nombran la fuente sin convertir la temporada en un rango civil', () => {
    expect(etiquetaTemporada('2027')).toBe('FIE 2027');
    expect(etiquetaTemporada('2026-2027')).toBe('RFEE 2026-2027');
    expect(etiquetaTemporada('abc')).toBe('abc');
    expect(chipsActivos(criterios({ temporada: '2027' }))[0]).toMatchObject({ valor: 'FIE 2027' });
    expect(chipsActivos(criterios({ temporada: '2026-2027' }))[0]).toMatchObject({
      valor: 'RFEE 2026-2027',
    });
  });

  it('el selector agrupa por fuente con los valores exactos y no repite la temporada de la URL', () => {
    const { sueltas, grupos } = agruparTemporadas(opcionesTemporada('2026-10-02', 2), '2027');
    expect(sueltas).toEqual([]);
    expect(grupos.map((g) => g.opciones.map((o) => [o.valor, o.etiqueta]))).toEqual([
      [
        ['2027', 'FIE 2027'],
        ['2026', 'FIE 2026'],
      ],
      [
        ['2026-2027', 'RFEE 2026-2027'],
        ['2025-2026', 'RFEE 2025-2026'],
      ],
    ]);
    expect(grupos[0].etiqueta).toMatch(/^FIE/);
    expect(grupos[1].etiqueta).toMatch(/^RFEE/);
  });

  it('una temporada de la URL fuera de la lista se conserva en el selector con su etiqueta', () => {
    const opciones = opcionesTemporada('2026-10-02', 2);
    expect(agruparTemporadas(opciones, '2015').sueltas).toEqual([
      { valor: '2015', etiqueta: 'FIE 2015' },
    ]);
    expect(agruparTemporadas(opciones, '').sueltas).toEqual([]);
  });

  it('el formulario con una temporada FIE en la URL se pinta con la clave exacta sin errores', () => {
    const html = renderToStaticMarkup(
      React.createElement(FormularioFiltros, {
        criterios: criterios({ temporada: '2027' }),
        temporadas: opcionesTemporada('2026-10-02', 3),
        atajoEspana: false,
      }),
    );
    expect(html).toContain('Más filtros (1 activos)');
    expect(html).toContain('for="explorar-temporada"');
  });
});

describe('fecha inválida en la URL', () => {
  it('desde=2026-99-99 llega como entrada_invalida y no consulta datos', async () => {
    const { criterios: leidos } = leerCriterios({ desde: '2026-99-99' });
    expect(leidos.desde).toBe('2026-99-99');
    const { ctx, sentencias } = crearContexto();
    expect(await cargarExplorar(ctx, leidos, undefined)).toEqual({ tipo: 'entrada_invalida' });
    expect(sentencias).toHaveLength(0);
  });

  it('el chip conserva el valor bruto, no lanza y se puede quitar', () => {
    const { criterios: leidos } = leerCriterios({ desde: '2026-99-99', hasta: '2026-02-31', arma: 'sable' });
    let chips: ReturnType<typeof chipsActivos> = [];
    expect(() => {
      chips = chipsActivos(leidos);
    }).not.toThrow();
    expect(chips.find((c) => c.clave === 'desde')).toMatchObject({
      valor: '2026-99-99',
      quitar: '/explorar?arma=SABLE&hasta=2026-02-31',
    });
    expect(chips.find((c) => c.clave === 'hasta')?.valor).toBe('2026-02-31');

    const html = renderToStaticMarkup(React.createElement(ChipsActivos, { criterios: leidos }));
    expect(html).toContain('2026-99-99');
    expect(html).toContain('fecha no válida');
    expect(html).toContain('href="/explorar?arma=SABLE&amp;hasta=2026-02-31"');
  });

  it('las fechas válidas conservan su formato visible', () => {
    const [chip] = chipsActivos(criterios({ desde: '2026-01-10' }));
    expect(chip.valor).toBe(formatDateEs('2026-01-10'));
    const html = renderToStaticMarkup(
      React.createElement(ChipsActivos, { criterios: criterios({ desde: '2026-01-10' }) }),
    );
    expect(html).not.toContain('fecha no válida');
  });

  it('el formulario abierto con una fecha de URL imposible la marca como inválida', () => {
    const html = renderToStaticMarkup(
      React.createElement(FormularioFiltros, {
        criterios: criterios({ desde: '2026-99-99' }),
        temporadas: [],
        atajoEspana: false,
      }),
    );
    expect(html).toMatch(/id="explorar-desde"[^>]*aria-invalid="true"/);
    expect(html).toContain('No se entiende esa fecha');
  });

  it('esFechaIsoReal distingue formato de fecha existente', () => {
    expect(esFechaIsoReal('2026-02-28')).toBe(true);
    expect(esFechaIsoReal('2024-02-29')).toBe(true);
    expect(esFechaIsoReal('2026-02-29')).toBe(false);
    expect(esFechaIsoReal('2026-99-99')).toBe(false);
    expect(esFechaIsoReal('2026-1-5')).toBe(false);
    expect(esFechaIsoReal('')).toBe(false);
  });
});

describe('fecha tecleada inválida en Desde/Hasta', () => {
  it('aIso ya no da por buena una fecha ISO imposible', () => {
    expect(aIso('2026-99-99')).toBeNull();
    expect(aIso('31/02/2026')).toBeNull();
    expect(aIso('03/10/2026')).toBe('2026-10-03');
    expect(aIso('2026-10-03')).toBe('2026-10-03');
  });

  it('con conservarInvalido el texto inválido sigue siendo distinguible de vacío', () => {
    expect(valorEmitido('31/02/2026', true)).toBe('31/02/2026');
    expect(valorEmitido('', true)).toBe('');
    expect(valorEmitido('   ', true)).toBe('');
    expect(valorEmitido('03/10/2026', true)).toBe('2026-10-03');
  });

  it('los demás callers de CampoFecha siguen recibiendo ISO o vacío', () => {
    expect(valorEmitido('31/02/2026', false)).toBe('');
    expect(valorEmitido('03/10/2026', false)).toBe('2026-10-03');
  });

  it('el campo se rellena con el texto bruto si el valor recibido no es una fecha real', () => {
    expect(textoDeCampo('2026-10-03')).toBe('03/10/2026');
    expect(textoDeCampo('2026-99-99')).toBe('2026-99-99');
    expect(textoDeCampo('31/02/2026')).toBe('31/02/2026');
    expect(textoDeCampo('')).toBe('');
  });

  it('lo que emite el campo bloquea Buscar y no se envía como si estuviera vacío', () => {
    const base = criterios({ q: 'garcia' });
    const tecleado = { ...base, desde: valorEmitido('31/02/2026', true) };
    const envio = prepararBusqueda(tecleado);
    expect(envio.ok).toBe(false);
    if (!envio.ok) {
      expect(envio.errores.desde).toMatch(/«Desde»/);
      expect(envio.errores.desde).toMatch(/fecha válida/);
    }

    const hasta = prepararBusqueda({ ...base, hasta: valorEmitido('2026-99-99', true) });
    expect(hasta.ok).toBe(false);
  });

  it('al corregir o limpiar el campo se puede buscar y la fecha vacía no viaja', () => {
    const base = criterios({ q: 'garcia' });
    expect(prepararBusqueda({ ...base, desde: valorEmitido('28/02/2026', true) })).toEqual({
      ok: true,
      url: '/explorar?q=garcia&desde=2026-02-28',
    });
    expect(prepararBusqueda({ ...base, desde: valorEmitido('', true) })).toEqual({
      ok: true,
      url: '/explorar?q=garcia',
    });
  });

  it('el intervalo sólo se compara cuando ambas fechas son reales', () => {
    const base = criterios({ q: 'garcia' });
    const invertido = prepararBusqueda({ ...base, desde: '2026-05-01', hasta: '2026-01-01' });
    expect(invertido.ok).toBe(false);
    if (!invertido.ok) expect(invertido.errores.intervalo).toBeDefined();

    const mezcla = prepararBusqueda({ ...base, desde: '31/02/2026', hasta: '2026-01-01' });
    expect(mezcla.ok).toBe(false);
    if (!mezcla.ok) {
      expect(mezcla.errores.desde).toBeDefined();
      expect(mezcla.errores.intervalo).toBeUndefined();
    }
    expect(prepararBusqueda({ ...base, desde: '2026-01-01', hasta: '2026-01-01' }).ok).toBe(true);
  });

  it('los demás filtros combinados y el reinicio de cursor siguen igual al buscar', () => {
    const envio = prepararBusqueda(
      criterios({ q: 'garcia', arma: 'SABLE', temporada: '2027', desde: '2026-01-01' }),
    );
    expect(envio).toEqual({
      ok: true,
      url: '/explorar?q=garcia&arma=SABLE&temporada=2027&desde=2026-01-01',
    });
    expect(prepararBusqueda(criterios({ torneo: 'a' })).ok).toBe(false);
    expect(prepararBusqueda(criterios({ nacionalidad: 'ES' })).ok).toBe(false);
  });
});
