import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CompetitionView, DatoExtraidoView, EventView } from '@/lib/queries/calendar';
import {
  convertirHora,
  instanteDeHoraLocal,
  leerHora,
  mismoReloj,
  siglasHuso,
} from '@/lib/huso-dispositivo';
import { cargarPodiosEvento, leerPodios } from '@/lib/queries/evento-resultados';
import { crearContexto } from './helpers/explorar';

vi.mock('@/app/(app)/detalle-evento', () => ({ detalleDelEvento: vi.fn() }));
vi.mock('@/app/(app)/explorar/resultados-evento', () => ({ resultadosDelEvento: vi.fn() }));
vi.mock('@/components/calendario/ficha/resultados-accion', () => ({ podiosDelEvento: vi.fn() }));
vi.mock('lucide-react', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('lucide-react');
});
vi.mock('radix-ui', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('radix-ui');
});

const { FichaEvento } = await import('@/components/calendario/ficha-evento');
const { CabeceraFicha } = await import('@/components/calendario/cabecera-ficha');
const { horariosDelTorneo, rotuloDeHito, tituloDeDia, accesoRepiteDireccion, accesoCreible } = await import(
  '@/components/calendario/horarios-torneo'
);
const { inscripcionDe, otrosDatosDe, rotuloLimpio } = await import(
  '@/components/calendario/ficha/datos-ficha'
);
const { CuerpoPodios } = await import('@/components/calendario/ficha/resultados-torneo');
const { torneoTerminado } = await import('@/components/calendario/ficha/terminado');
const { Sheet } = await import('@/components/ui/sheet');

/** Intl separa la cifra del símbolo con un espacio duro. */
const sinNbsp = (s: string) => s.replace(/\u00a0/g, ' ');

let n = 0;
function dato(campo: string, valor: string, extra: Partial<DatoExtraidoView> = {}): DatoExtraidoView {
  n += 1;
  return {
    id: `dato-${n}`,
    campo,
    etiqueta: campo,
    valor,
    estado: 'sin_revisar',
    pisadoPorPublicado: false,
    prueba: null,
    fecha: null,
    cita: valor,
    contexto: null,
    documento: { titulo: 'Invitación', url: 'https://example.test/inv.pdf' },
    revisadoEn: null,
    ...extra,
  };
}

function prueba(sobre: Partial<CompetitionView> = {}): CompetitionView {
  return {
    id: 'flo-f',
    weapon: 'FLORETE',
    gender: 'F',
    category: 'ABS',
    categoryRaw: null,
    format: 'INDIVIDUAL',
    competitionDate: '2026-10-16',
    installationOpen: null,
    callTime: null,
    scratchTime: null,
    startTime: null,
    registrationCount: null,
    feeEur: null,
    sourceUrl: null,
    deadlines: [],
    status: {
      state: 'sin_datos',
      label: 'Plazo no publicado',
      next: null,
      daysLeft: null,
      currentSurchargeEur: null,
      nextSurchargeEur: null,
      closed: false,
      hasEstimates: false,
    },
    datosExtraidos: [],
    ...sobre,
  } as CompetitionView;
}

function evento(sobre: Partial<EventView> = {}): EventView {
  return {
    id: 'ev-takamatsu',
    source: 'fie',
    sourceUrl: null,
    name: 'Takamatsu City World Cup 2026',
    startDate: '2099-10-15',
    endDate: '2099-10-18',
    venue: null,
    venueAddress: null,
    city: 'Takamatsu City',
    country: 'JP',
    geoLat: null,
    geoLon: null,
    timezone: 'Asia/Tokyo',
    officialSite: null,
    imageUrl: null,
    imageSource: null,
    circuit: 'COPA_MUNDO',
    circuitFie: null,
    scope: 'INTERNACIONAL',
    regionalFederation: null,
    notes: null,
    lastSeenAt: new Date('2026-10-01T12:00:00Z'),
    disappearedAt: null,
    competitions: [prueba()],
    documents: [],
    liveLinks: [],
    linkedEvents: [],
    sources: [],
    datosExtraidos: [],
    ...sobre,
  } as EventView;
}

describe('la hora de la sede y la del dispositivo', () => {
  it('convierte una hora de Takamatsu a la de Madrid, con el día si cambia', () => {
    expect(convertirHora('2026-10-16', '09:00', 'Asia/Tokyo', 'Europe/Madrid')).toEqual({ hora: '02:00', dias: 0 });
    expect(convertirHora('2026-10-18', '06:30', 'Asia/Tokyo', 'Europe/Madrid')).toEqual({ hora: '23:30', dias: -1 });
    expect(convertirHora('2026-10-16', '09:00', 'Europe/Madrid', 'America/Lima')).toEqual({ hora: '02:00', dias: 0 });
  });

  it('respeta el cambio de hora del destino', () => {
    // El 25 de octubre de 2026 España pasa a UTC+1: la misma hora de Tokio da una hora menos.
    expect(convertirHora('2026-10-24', '09:00', 'Asia/Tokyo', 'Europe/Madrid')?.hora).toBe('02:00');
    expect(convertirHora('2026-10-26', '09:00', 'Asia/Tokyo', 'Europe/Madrid')?.hora).toBe('01:00');
  });

  it('lee las horas como las escriben las convocatorias y rechaza lo demás', () => {
    expect(leerHora('09:00')).toEqual([9, 0]);
    expect(leerHora('9.30h')).toEqual([9, 30]);
    expect(leerHora('09h00')).toEqual([9, 0]);
    expect(leerHora('por la mañana')).toBeNull();
    expect(instanteDeHoraLocal('2026-10-16', 'mediodía', 'Asia/Tokyo')).toBeNull();
  });

  it('compara relojes y no nombres de huso, y pone siglas legibles', () => {
    expect(mismoReloj('Europe/Paris', 'Europe/Madrid', '2026-10-16')).toBe(true);
    expect(mismoReloj('Asia/Tokyo', 'Europe/Madrid', '2026-10-16')).toBe(false);
    expect(siglasHuso('Asia/Tokyo', '2026-10-16')).toBe('JST');
    expect(siglasHuso('Europe/Madrid', '2026-07-01')).toBe('CEST');
    expect(siglasHuso('Europe/Istanbul', '2026-09-24')).toBe('UTC+3');
  });
});

describe('el horario día a día', () => {
  const flor = prueba({
    datosExtraidos: [
      dato('installation_open.2026-10-16.women-s-foil', '07:00', {
        fecha: '2026-10-16',
        prueba: 'Women’s Foil',
        cita: '07:00 Venue open & Weapon control & registration',
      }),
      dato('pools_start.2026-10-16.women-s-foil', '09:00', {
        fecha: '2026-10-16',
        prueba: 'Women’s Foil',
        cita: "09:00 Women's Foil Pools & Preliminary DE tableau",
      }),
    ],
  });
  const sinDia = dato('start_time.suelto', '10:00');
  const deEquipos = dato('installation_open.2026-10-18.team-event', '06:30', {
    fecha: '2026-10-18',
    prueba: 'Team Event',
    cita: '06:30 Venue open',
  });
  const ev = evento({ competitions: [flor], datosExtraidos: [deEquipos, sinDia] });

  it('agrupa por día, ordena por hora y pone rótulos en castellano sin claves internas', () => {
    const { dias } = horariosDelTorneo(ev);
    expect(dias.map((d) => d.fecha)).toEqual(['2026-10-16', '2026-10-18']);
    expect(dias[0].hitos.map((h) => [h.hora, h.rotulo, h.aQue])).toEqual([
      ['07:00', 'Apertura y control de armas', 'Florete femenino'],
      ['09:00', 'Poules y primeras directas', 'Florete femenino'],
    ]);
    // La apertura del pabellón vale para todo el día: va en su titular, no como fila.
    expect(dias[1].hitos).toEqual([]);
    expect(dias[1].apertura).toMatchObject({ hora: '06:30', rotulo: 'Apertura del pabellón' });
    expect(dias[0].apertura).toBeNull();
    expect(tituloDeDia('2026-10-16')).toBe('Vie 16 oct');
  });

  it('apunta lo que usa: una hora sin día no entra y queda para «otros datos»', () => {
    const { usados } = horariosDelTorneo(ev);
    expect(usados.has(sinDia.id)).toBe(false);
    expect(otrosDatosDe(ev, flor).map((d) => d.id)).toEqual([sinDia.id]);
  });

  it('no repite como «del torneo» la hora que ya tiene una prueba', () => {
    const llamada = prueba({ callTime: '08:30' });
    const repetida = dato('call_time', '08:30', { fecha: '2026-10-16' });
    const { dias, usados } = horariosDelTorneo(evento({ competitions: [llamada], datosExtraidos: [repetida] }));
    expect(dias[0].hitos).toHaveLength(1);
    expect(usados.has(repetida.id)).toBe(true);
  });

  it('el cuadro sale de la frase', () => {
    expect(rotuloDeHito('start_time', dato('start_time', '09:00', { cita: "09:00 Men's Foil T64 starting time" }))).toBe('Cuadro de 64');
    expect(rotuloDeHito('teams_start', dato('teams_start', '08:00', { cita: '08:00 MF team T64 (if necessary)' }))).toBe(
      'Cuadro de 64 (si hace falta)',
    );
  });
});

describe('la inscripción, agrupada', () => {
  const ev = evento({
    datosExtraidos: [
      dato('fee_eur', '80.00', { prueba: 'individual', cita: 'Individual competition: EUR 80' }),
      dato('fee_eur.equipos', '400.00', { prueba: 'equipos', cita: 'Team competition: EUR 400' }),
      dato('fee_eur.equipos', '2,00', { cita: 'un máximo de 2 equipos por arma' }),
      dato('entry_quota', '12', { etiqueta: 'Cupo por federación' }),
      dato('entry_quota.equipos', '1', { etiqueta: 'Cupo de equipos' }),
      dato('min_age', '13'),
      dato('payment_method', 'En efectivo'),
      dato('entry_requirement.fie-license', 'FIE license valid for the current season'),
    ],
  });

  it('cuotas en euros, cupos con su unidad y requisitos en castellano', () => {
    const r = inscripcionDe(ev, ev.competitions[0]);
    expect(r.cuotas.map((c) => [c.rotulo, sinNbsp(c.valor)])).toEqual([
      ['Cuota individual', '80 €'],
      ['Cuota por equipos', '400 €'],
    ]);
    expect(r.condiciones.map((c) => [c.rotulo, c.valor])).toEqual([
      ['Cupo por federación', '12 tiradores'],
      ['Cupo de equipos', '1 equipo'],
      ['Edad mínima', '13 años'],
      ['Forma de pago', 'En efectivo'],
    ]);
    expect(r.requisitos.map((c) => c.valor)).toEqual(['Licencia FIE en vigor esta temporada']);
  });

  it('la cuota publicada manda sobre la leída del mismo tipo, sin repetirla', () => {
    const conPublicada = { ...ev, competitions: [prueba({ feeEur: '75' })] };
    const r = inscripcionDe(conPublicada, conPublicada.competitions[0]);
    expect(r.cuotas.map((c) => [c.rotulo, sinNbsp(c.valor), c.dato === null])).toEqual([
      ['Cuota de inscripción', '75 €', true],
      ['Cuota por equipos', '400 €', false],
    ]);
  });

  it('un importe cuya frase no habla de euros no es cuota y va a «otros datos»', () => {
    const otros = otrosDatosDe(ev, ev.competitions[0]);
    expect(otros.map((d) => d.valor)).toEqual(['2,00']);
  });

  it('el rótulo de lo que sobra no enseña el sufijo de día y prueba', () => {
    expect(rotuloLimpio(dato('start_time.x', '13:00', { etiqueta: 'Inicio · 2026-10-14 training available' }))).toBe('Inicio');
    expect(rotuloLimpio(dato('fee_eur.m17', '30', { etiqueta: 'Cuota · cadete' }))).toBe('Cuota · cadete');
  });

  it('el acceso que repite la dirección no se enseña dos veces', () => {
    expect(accesoRepiteDireccion('Atatürk Bulvarı, 55100', 'Archery Hall -, Atatürk Bulvarı, 55100 İlkadım')).toBe(true);
    expect(accesoRepiteDireccion('Gate 7, Av. San Luis 1308', 'Velódromo, Av. Aviación')).toBe(false);
    expect(accesoCreible('ESPADA MASCULINO')).toBe(false);
    expect(accesoCreible('Gate 7, Av. San Luis N° 1308')).toBe(true);
  });
});

describe('la ficha', () => {
  const ev = evento({
    competitions: [
      prueba({
        datosExtraidos: [
          dato('pools_start.2099-10-16.women-s-foil', '09:00', { fecha: '2099-10-16', prueba: 'Women’s Foil' }),
        ],
      }),
    ],
    datosExtraidos: [dato('venue', 'Kagawa Prefectural Arena'), dato('link.otro', 'https://www.kotoden.co.jp/bus/index.html')],
  });
  const pintar = (e: EventView) =>
    renderToStaticMarkup(
      React.createElement(
        Sheet,
        { open: true },
        React.createElement(CabeceraFicha, { evento: e }),
        React.createElement(FichaEvento, { evento: e, tirador: null, inscritos: { oficiales: [], estados: {}, pendientes: [] } }),
      ),
    );

  it('enseña la hora local de la sede y la tuya, sin la cuenta de «horas más que en España»', () => {
    const html = pintar(ev);
    expect(html).toContain('>JST<');
    expect(html).toContain('>tu hora<');
    expect(html).not.toContain('Hora local de');
    expect(html).not.toContain('más que en España');
    expect(html).not.toContain('Allí son las');
  });

  it('sin la lista de frases del PDF y con los enlaces por su dominio', () => {
    const html = pintar(ev);
    expect(html).not.toContain('frases del PDF');
    expect(html).not.toContain('Cada dato va con la frase original');
    expect(html).toContain('kotoden.co.jp');
    expect(html).not.toContain('>https://www.kotoden.co.jp');
    // El pabellón leído aparece una vez, en la sede.
    expect(html.match(/Kagawa Prefectural Arena/g)).toHaveLength(1);
  });

  it('un torneo terminado lo dice, sin plazo y sin banda de resultados hasta que haya algo', () => {
    const pasado = evento({ ...ev, startDate: '2020-10-15', endDate: '2020-10-18' });
    expect(torneoTerminado(pasado)).toBe(true);
    const html = pintar(pasado);
    expect(html).toContain('Terminada');
    expect(html).not.toContain('resultados-torneo');
    expect(html).not.toContain('Leyendo resultados');
    expect(html).not.toContain('vinculada');
    expect(html).not.toContain('>Inscripción<');
    expect(torneoTerminado({ endDate: '2026-10-05' }, '2026-10-05')).toBe(false);
  });

  it('el podio va con su color de medalla y enlaza a la edición', () => {
    const html = renderToStaticMarkup(
      React.createElement(CuerpoPodios, {
        vista: {
          tipo: 'ok',
          ediciones: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              nombre: 'Coupe du Monde',
              temporada: '2026',
              fuente: 'fie',
              ciudad: 'Samsun',
              pais: 'TUR',
              inicio: '2026-09-24',
              fin: '2026-09-27',
              pruebas: 1,
              armas: ['FLORETE'],
              formatos: ['INDIVIDUAL'],
              serie: null,
              pruebasDetalle: [
                {
                  id: '22222222-2222-4222-8222-222222222222',
                  arma: 'FLORETE',
                  genero: 'F',
                  categoria: { codigo: 'M20', raw: null },
                  formato: 'INDIVIDUAL',
                  fecha: '2026-09-25',
                  fuente: 'fie',
                  pruebaCalendarioId: null,
                  resultados: { estado: 'completo', importados: 64 },
                  enlaces: [],
                },
              ],
            },
          ],
          podios: {
            '22222222-2222-4222-8222-222222222222': [
              { puesto: 1, nombre: 'LIU Jaelyn', pais: 'USA', club: null, personaId: null },
              { puesto: 3, nombre: 'KUS Natasza', pais: 'POL', club: null, personaId: null },
              { puesto: 3, nombre: 'AMR HOSSNY Sara', pais: 'EGY', club: null, personaId: null },
            ],
          },
        } as never,
      }),
    );
    expect(html).toContain('href="/explorar/ediciones/11111111-1111-4111-8111-111111111111"');
    expect(html).toContain('Florete femenino');
    expect(html).toContain('bg-amber-100');
    expect(html.match(/bg-orange-100/g)).toHaveLength(2);
  });
});

describe('sin nada que enseñar no hay banda', () => {
  const base = {
    id: '11111111-1111-4111-8111-111111111111', nombre: 'Coupe du Monde', temporada: '2026', fuente: 'fie',
    ciudad: null, pais: null, inicio: null, fin: null, pruebas: 1, armas: [], formatos: [], serie: null,
  };
  const prueba = {
    id: '22222222-2222-4222-8222-222222222222', arma: 'FLORETE', genero: 'F', categoria: { codigo: 'ABS', raw: null },
    formato: 'INDIVIDUAL', fecha: null, fuente: 'fie', pruebaCalendarioId: null,
    resultados: { estado: 'pendiente', importados: 0 }, enlaces: [],
  };
  const pinta = (vista: unknown) => renderToStaticMarkup(React.createElement(CuerpoPodios, { vista: vista as never }));

  it('ni leyendo, ni con fallo, ni sin sesión, ni sin edición, ni con pruebas sin podio ni enlace', () => {
    expect(pinta(null)).toBe('');
    expect(pinta('fallo')).toBe('');
    expect(pinta({ tipo: 'sin_sesion' })).toBe('');
    expect(pinta({ tipo: 'ok', ediciones: [], podios: {} })).toBe('');
    expect(pinta({ tipo: 'ok', ediciones: [{ ...base, pruebasDetalle: [prueba] }], podios: {} })).toBe('');
  });

  it('una prueba solo con enlace oficial sí sale, como pastilla con el proveedor', () => {
    const html = pinta({
      tipo: 'ok',
      ediciones: [{ ...base, pruebasDetalle: [{ ...prueba, enlaces: [{ tipo: 'verificado', proveedor: 'engarde', url: 'https://engarde-service.com/x' }] }] }],
      podios: {},
    });
    expect(html).toContain('href="https://engarde-service.com/x"');
    expect(html).toContain('Engarde');
    expect(html).not.toContain('No significa');
  });
});

describe('el podio en la base', () => {
  it('sin sesión no se consulta nada', async () => {
    const { ctx, sentencias } = crearContexto({ perfil: null });
    expect(await cargarPodiosEvento(ctx, '11111111-1111-4111-8111-111111111111')).toEqual({ tipo: 'sin_sesion' });
    expect(sentencias).toHaveLength(0);
  });

  it('sin vínculo guardado prueba el camino por clave, y no si el vínculo ya da ediciones', async () => {
    const porClave = vi.fn(async () => [] as string[]);
    const { ctx } = crearContexto();
    expect(await cargarPodiosEvento(ctx, '11111111-1111-4111-8111-111111111111', porClave)).toEqual({
      tipo: 'ok',
      ediciones: [],
      podios: {},
    });
    expect(porClave).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');

    const fallido = vi.fn(async () => {
      throw new Error('x');
    });
    expect((await cargarPodiosEvento(ctx, '11111111-1111-4111-8111-111111111111', fallido)).tipo).toBe('ok');
  });

  it('una sola fuente por prueba y como mucho oro, plata y dos bronces', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const { ctx, sentencias } = crearContexto({
      respuestas: [
        {
          cuando: /FROM sport_result r/,
          filas: [1, 2, 3, 3, 3].map((puesto, i) => ({ pruebaId: id, puesto, nombre: `T${i}`, pais: null, club: null, personaId: null })),
        },
      ],
    });
    const podios = await leerPodios(ctx, [id]);
    expect(podios[id].map((p) => p.puesto)).toEqual([1, 2, 3, 3]);
    expect(sentencias[0].text).toMatch(/row_number\(\) OVER/);
    expect(sentencias[0].text).toMatch(/r\.position BETWEEN 1 AND 3/);
  });
});
