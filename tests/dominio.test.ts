import { describe, expect, it } from 'vitest';
import { deriveCategories, requiresGuardianAccount } from '@/lib/categories';
import {
  computeDeadlines,
  deadlineStatus,
  mergeDeadlines,
  type ComputedDeadline,
  type DeadlineRuleRow,
} from '@/lib/deadlines';
import {
  availableTransitions,
  canTransition,
  waitingOn,
} from '@/lib/entries/state-machine';
import { timezoneInfo, mapsLinks } from '@/lib/travel';

/** Tabla de categorías de la temporada 2026-2027, como la editaría el admin. */
const CATEGORIAS = [
  { code: 'M13' as const, birthYearMin: 2014, birthYearMax: 2016, rank: 1, laddered: true },
  { code: 'M15' as const, birthYearMin: 2012, birthYearMax: 2014, rank: 2, laddered: true },
  { code: 'M17' as const, birthYearMin: 2010, birthYearMax: 2013, rank: 3, laddered: true },
  { code: 'M20' as const, birthYearMin: 2007, birthYearMax: 2012, rank: 4, laddered: true },
  { code: 'ABS' as const, birthYearMin: null, birthYearMax: 2014, rank: 5, laddered: true },
  { code: 'VET' as const, birthYearMin: null, birthYearMax: 1997, rank: 6, laddered: false },
];

describe('categorías derivadas de la fecha de nacimiento', () => {
  it('un M17 puede tirar M17, M20 y Absoluto, pero no M15', () => {
    const r = deriveCategories(2010, CATEGORIAS);
    expect(r.own).toBe('M17');
    expect(r.eligible).toEqual(['M17', 'M20', 'ABS']);
    expect(r.eligible).not.toContain('M15');
  });

  it('coge siempre la categoría más baja que encaje', () => {
    // 2014 encaja en M13 y M15; le corresponde M13.
    expect(deriveCategories(2014, CATEGORIAS).own).toBe('M13');
  });

  it('el nacido en el año de corte no se queda fuera', () => {
    // Caso límite del plan: el nacido el 31/12 del año de corte. Como las
    // categorías van por AÑO, la fecha exacta dentro del año da igual.
    expect(deriveCategories(2016, CATEGORIAS).own).toBe('M13');
    expect(deriveCategories(2007, CATEGORIAS).own).toBe('M20');
  });

  it('un veterano puede tirar VET y también Absoluto', () => {
    const r = deriveCategories(1985, CATEGORIAS);
    expect(r.eligible).toContain('VET');
    expect(r.eligible).toContain('ABS');
  });

  it('sin tabla de temporada no se inventa una categoría', () => {
    const r = deriveCategories(2010, []);
    expect(r.own).toBeNull();
    expect(r.eligible).toEqual([]);
    expect(r.explanation).toContain('categorías configuradas');
  });

  it('marca cuándo la cuenta tiene que ser del tutor', () => {
    const hoy = new Date('2026-09-25T12:00:00Z');
    // 13 años: no puede consentir por sí mismo en España.
    expect(requiresGuardianAccount('2013-01-01', hoy)).toBe(true);
    expect(requiresGuardianAccount('2010-01-01', hoy)).toBe(false);
    // Justo el día que cumple 14.
    expect(requiresGuardianAccount('2012-09-25', hoy)).toBe(false);
    expect(requiresGuardianAccount('2012-09-26', hoy)).toBe(true);
  });
});

describe('plazos y semáforo', () => {
  const REGLAS: DeadlineRuleRow[] = [
    {
      id: 'r1',
      scope: 'INTERNACIONAL',
      circuit: null,
      category: null,
      type: 'L1',
      label: 'Límite ordinario',
      daysBefore: 28,
      surchargeEur: '0',
      blocking: false,
      sourceDocument: 'Circular 12-26',
      sourceUrl: 'https://esgrima.es/circular.pdf',
    },
    {
      id: 'r2',
      scope: 'INTERNACIONAL',
      circuit: null,
      category: null,
      type: 'L2',
      label: 'Segundo plazo',
      daysBefore: 21,
      surchargeEur: '150',
      blocking: false,
      sourceDocument: 'Circular 12-26',
      sourceUrl: null,
    },
    {
      id: 'r3',
      scope: 'INTERNACIONAL',
      circuit: null,
      category: null,
      type: 'FIE_D7',
      label: 'Cierre FIE',
      daysBefore: 7,
      surchargeEur: null,
      blocking: true,
      sourceDocument: null,
      sourceUrl: null,
    },
    {
      // Regla más específica: debe ganar a la genérica para su circuito.
      id: 'r4',
      scope: 'INTERNACIONAL',
      circuit: 'SEN_GP',
      category: null,
      type: 'L1',
      label: 'Límite ordinario (Gran Premio)',
      daysBefore: 35,
      surchargeEur: '0',
      blocking: false,
      sourceDocument: null,
      sourceUrl: null,
    },
  ];

  it('calcula los hitos a partir de la fecha de inicio', () => {
    const d = computeDeadlines('2026-10-30', REGLAS, {
      scope: 'INTERNACIONAL',
      circuit: 'SEN_WC',
      category: 'ABS',
    });
    expect(d.map((x) => x.type)).toEqual(['L1', 'L2', 'FIE_D7']);
    expect(d[0].deadlineAt.toISOString().slice(0, 10)).toBe('2026-10-02');
    expect(d.every((x) => x.origin === 'CALCULADO')).toBe(true);
  });

  it('la regla más específica gana a la genérica', () => {
    const d = computeDeadlines('2026-10-30', REGLAS, {
      scope: 'INTERNACIONAL',
      circuit: 'SEN_GP',
      category: 'ABS',
    });
    const l1 = d.find((x) => x.type === 'L1');
    expect(l1?.label).toBe('Límite ordinario (Gran Premio)');
  });

  it('el plazo publicado gana siempre al calculado', () => {
    const calculado = computeDeadlines('2026-10-30', REGLAS, {
      scope: 'INTERNACIONAL',
      circuit: 'SEN_WC',
      category: 'ABS',
    });
    const publicado: ComputedDeadline[] = [
      {
        type: 'L1',
        label: 'Cierre de inscripción',
        deadlineAt: new Date('2026-10-15T21:59:59Z'),
        surchargeEur: null,
        blocking: false,
        origin: 'PUBLICADO',
        sourceDocument: 'Calendario oficial (fuente)',
        sourceUrl: null,
      },
    ];

    const unidos = mergeDeadlines(publicado, calculado);
    const l1 = unidos.find((x) => x.type === 'L1');
    expect(l1?.origin).toBe('PUBLICADO');
    expect(l1?.deadlineAt.toISOString().slice(0, 10)).toBe('2026-10-15');
  });

  it('el semáforo distingue a tiempo, atención y urgente', () => {
    const plazos = computeDeadlines('2026-12-01', REGLAS, {
      scope: 'INTERNACIONAL',
      circuit: 'SEN_WC',
      category: 'ABS',
    });

    // El evento empieza el 01/12; el límite ordinario cae 28 días antes, el
    // 03/11. Verde a más de una semana, ámbar en la última semana, rojo en
    // los últimos tres días.
    expect(deadlineStatus(plazos, new Date('2026-10-01T12:00:00Z')).state).toBe('verde');
    expect(deadlineStatus(plazos, new Date('2026-10-29T12:00:00Z')).state).toBe('ambar');
    expect(deadlineStatus(plazos, new Date('2026-11-02T12:00:00Z')).state).toBe('rojo');
  });

  it('marca cerrado cuando ha pasado un cierre duro', () => {
    const plazos = computeDeadlines('2026-12-01', REGLAS, {
      scope: 'INTERNACIONAL',
      circuit: 'SEN_WC',
      category: 'ABS',
    });
    const s = deadlineStatus(plazos, new Date('2026-11-29T12:00:00Z'));
    expect(s.state).toBe('cerrado');
    expect(s.closed).toBe(true);
  });

  it('sin plazos dice que no está publicado, no que esté todo bien', () => {
    const s = deadlineStatus([]);
    expect(s.state).toBe('sin_datos');
    expect(s.label).toBe('Plazo no publicado');
  });

  it('avisa del recargo vigente cuando ya se pasó el ordinario', () => {
    const plazos = computeDeadlines('2026-12-01', REGLAS, {
      scope: 'INTERNACIONAL',
      circuit: 'SEN_WC',
      category: 'ABS',
    });
    const s = deadlineStatus(plazos, new Date('2026-11-06T12:00:00Z'));
    expect(s.currentSurchargeEur).toBe('0');
    expect(s.nextSurchargeEur).toBe('150');
  });
});

describe('máquina de estados de las inscripciones', () => {
  it('permite el camino normal', () => {
    expect(canTransition('draft', 'pending_club', 'athlete').ok).toBe(true);
    expect(canTransition('pending_club', 'club_approved', 'club').ok).toBe(true);
    expect(canTransition('club_approved', 'federation_approved', 'admin').ok).toBe(true);
    expect(canTransition('federation_approved', 'submitted', 'admin').ok).toBe(true);
  });

  it('no deja saltarse pasos', () => {
    const r = canTransition('pending_club', 'submitted', 'admin');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('No se puede pasar');
  });

  it('un tirador no puede validar su propia inscripción', () => {
    const r = canTransition('pending_club', 'club_approved', 'athlete');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('rol');
  });

  it('un club no puede aprobar en nombre de la federación', () => {
    expect(canTransition('club_approved', 'federation_approved', 'club').ok).toBe(false);
  });

  it('rechazar exige motivo', () => {
    expect(canTransition('pending_club', 'rejected', 'club').ok).toBe(false);
    expect(
      canTransition('pending_club', 'rejected', 'club', 'Licencia caducada').ok,
    ).toBe(true);
  });

  it('solo el admin retira una inscripción ya enviada', () => {
    expect(canTransition('submitted', 'withdrawn', 'club', 'motivo').ok).toBe(false);
    expect(canTransition('submitted', 'withdrawn', 'admin', 'motivo').ok).toBe(true);
  });

  it('se puede volver a solicitar tras un rechazo', () => {
    expect(canTransition('rejected', 'pending_club', 'guardian').ok).toBe(true);
  });

  it('dice en quién está la pelota', () => {
    expect(waitingOn('pending_club')).toBe('tu club');
    expect(waitingOn('club_approved')).toBe('la RFEE');
    expect(waitingOn('submitted')).toBeNull();
  });

  it('ofrece al club solo lo que el club puede hacer', () => {
    const acciones = availableTransitions('pending_club', 'club').map((t) => t.to);
    expect(acciones).toContain('club_approved');
    expect(acciones).toContain('rejected');
    expect(acciones).not.toContain('federation_approved');
  });
});

describe('ayudas de viaje', () => {
  it('calcula la diferencia horaria con España', () => {
    const info = timezoneInfo('Europe/Istanbul', '2026-09-24', '2026-09-27');
    expect(info?.diffHours).toBe(1);
    expect(info?.label).toContain('1 hora más');
  });

  it('avisa del cambio de hora si cae durante el viaje', () => {
    // El último domingo de octubre de 2026 es el día 25.
    const info = timezoneInfo('Europe/Madrid', '2026-10-24', '2026-10-26');
    expect(info?.dstChangeDuringTrip).toBe(true);
    expect(info?.dstNote).toContain('cambio de hora');
  });

  it('no dice nada si no conoce el huso, en vez de inventarlo', () => {
    expect(timezoneInfo(null, '2026-10-01', '2026-10-02')).toBeNull();
  });

  it('genera enlaces a los mapas del móvil', () => {
    const links = mapsLinks({
      venue: 'Polideportivo Pablo Cáceres',
      venueAddress: 'Calle Mayor 1',
      city: 'Medina del Campo',
    });
    expect(links?.apple).toContain('maps.apple.com');
    expect(links?.google).toContain('google.com/maps');
    expect(links?.geo).toContain('geo:');
  });

  it('no genera enlace de mapa si no hay sede publicada', () => {
    expect(mapsLinks({ venue: null, city: null })).toBeNull();
  });
});
