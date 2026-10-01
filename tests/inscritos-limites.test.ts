import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SIN_EVENTO,
  datosVigentes,
  iniciarLectura,
  lecturaDelEvento,
  type LecturaDeEvento,
} from '@/lib/entries/lectura';
import type { FilaUnida } from '@/lib/entries/union';

const h = vi.hoisted(() => ({
  requireProfile: vi.fn(),
  getManagedAthletes: vi.fn(),
  select: vi.fn(),
  unidas: vi.fn(),
  rolesAdmin: { rows: [] as unknown[] },
}));

vi.mock('@/lib/auth/session', () => ({
  requireProfile: h.requireProfile,
  getManagedAthletes: h.getManagedAthletes,
  getSessionProfile: vi.fn(),
}));

vi.mock('@/db', () => {
  const cadena = (): unknown =>
    new Proxy(function () {}, {
      get: (_t, prop) =>
        prop === 'then'
          ? (resolve: (v: unknown) => void) => resolve(h.rolesAdmin.rows)
          : () => cadena(),
    });
  return {
    db: {
      select: (...args: unknown[]) => {
        h.select(...args);
        return cadena();
      },
    },
  };
});

describe('guarda de sesión en el límite privado de lectura', () => {
  beforeEach(() => {
    h.requireProfile.mockReset();
    h.select.mockReset();
  });

  it('inscritosUnidosDeTorneos exige sesión antes de consultar nada', async () => {
    h.requireProfile.mockRejectedValue(new Error('NO_AUTENTICADO'));
    const { inscritosUnidosDeTorneos } = await import('@/lib/queries/inscritos-union');
    await expect(inscritosUnidosDeTorneos(['t1'])).rejects.toThrow('NO_AUTENTICADO');
    expect(h.select).not.toHaveBeenCalled();
  });

  it('tarjetasConAtletas e inscritosPublicados tampoco consultan sin sesión', async () => {
    h.requireProfile.mockRejectedValue(new Error('NO_AUTENTICADO'));
    const { tarjetasConAtletas, inscritosPublicados } = await import('@/lib/queries/inscritos-union');
    await expect(tarjetasConAtletas(['a1'], '2026-10-01')).rejects.toThrow('NO_AUTENTICADO');
    await expect(inscritosPublicados('t1')).rejects.toThrow('NO_AUTENTICADO');
    expect(h.select).not.toHaveBeenCalled();
  });

  it('probar-ficha comprueba la sesión antes de leer el evento y ya no hay atajo de desarrollo', () => {
    const origen = readFileSync(
      new URL('../src/app/probar-ficha/[id]/page.tsx', import.meta.url),
      'utf8',
    );
    const guarda = origen.indexOf('getSessionProfile()');
    const primeraConsulta = Math.min(
      ...['listEvents(', 'inscritosPublicados('].map((c) => origen.indexOf(c, origen.indexOf('export default'))),
    );
    expect(guarda).toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(primeraConsulta);
    expect(origen).toMatch(/redirect\('\/entrar'\)/);
  });
});

const fila = (o: Partial<FilaUnida> & Pick<FilaUnida, 'nombre'>): FilaUnida => ({
  competitionId: 'c1',
  equipo: null,
  club: null,
  athleteIds: [],
  retiradoEn: null,
  observaciones: [],
  ...o,
});

describe('acción inscritosDelEvento', () => {
  beforeEach(() => {
    h.requireProfile.mockReset();
    h.getManagedAthletes.mockReset();
    h.unidas.mockReset();
    h.rolesAdmin.rows = [];
  });

  async function cargar() {
    vi.resetModules();
    vi.doMock('@/lib/queries/inscritos-union', () => ({ inscritosUnidosDeTorneos: h.unidas }));
    return (await import('@/app/(app)/inscritos')).inscritosDelEvento;
  }

  it('sin sesión no lee la lista', async () => {
    h.requireProfile.mockRejectedValue(new Error('NO_AUTENTICADO'));
    const inscritosDelEvento = await cargar();
    await expect(inscritosDelEvento('t1')).rejects.toThrow('NO_AUTENTICADO');
    expect(h.unidas).not.toHaveBeenCalled();
  });

  it('marca esMio sólo por fichas probadas y la lista visible no lleva fuente, URL ni fichas', async () => {
    h.requireProfile.mockResolvedValue({ profileId: 'p', role: 'athlete' });
    h.getManagedAthletes.mockResolvedValue([{ id: 'ath-1' }]);
    h.unidas.mockResolvedValue({
      filas: [
        fila({
          nombre: 'MIA',
          athleteIds: ['ath-1'],
          observaciones: [
            {
              competitionId: 'c1', nombre: 'MIA', equipo: '', club: null, athleteId: 'ath-1',
              retiradoEn: null, fuente: 'fie', sourceUrl: 'https://fie.org/x', leidoEl: null,
            },
          ],
        }),
        // Conflicto o contradicción: sin fichas atribuidas.
        fila({ nombre: 'DUDOSA', athleteIds: [] }),
      ],
      estados: { c1: 'con_datos' },
    });
    const inscritosDelEvento = await cargar();
    const r = await inscritosDelEvento('t1');
    expect(r.oficiales.map((o) => [o.nombre, o.esMio])).toEqual([
      ['MIA', true],
      ['DUDOSA', false],
    ]);
    const texto = JSON.stringify(r).toLowerCase();
    for (const prohibido of ['fie.org', 'ath-1', 'fuente', 'sourceurl', 'licen', 'birth', 'email']) {
      expect(texto).not.toContain(prohibido);
    }
    expect(r.estados).toEqual({ c1: 'con_datos' });
  });

  it('una fila en conflicto no suprime la solicitud pendiente del admin ni la atribuye', async () => {
    h.requireProfile.mockResolvedValue({ profileId: 'p', role: 'admin' });
    h.getManagedAthletes.mockResolvedValue([{ id: 'ath-1' }]);
    h.rolesAdmin.rows = [
      { competitionId: 'c1', athleteId: 'ath-1', firstName: 'Mia', lastName: 'Ruiz', clubName: null, status: 'submitted' },
      { competitionId: 'c1', athleteId: 'ath-2', firstName: 'Otra', lastName: 'Sola', clubName: null, status: 'submitted' },
    ];
    h.unidas.mockResolvedValue({
      // ath-1 figura en una fila cuya identidad es contradictoria: athleteIds vacío.
      filas: [fila({ nombre: 'MIA RUIZ', athleteIds: [] }), fila({ nombre: 'OTRA', athleteIds: ['ath-2'] })],
      estados: {},
    });
    const inscritosDelEvento = await cargar();
    const r = await inscritosDelEvento('t1');
    expect(r.pendientes.map((p) => p.nombre)).toEqual(['Mia Ruiz']);
    expect(r.pendientes[0].esMio).toBe(true);
    expect(r.oficiales.every((o) => !o.esMio)).toBe(true);
  });
});

describe('caller de la ficha: una lectura buena sobrevive a un reintento fallido', () => {
  type Datos = { lista: string[] };

  /** Contenedor mínimo con la semántica de `setState` funcional. */
  function contenedor() {
    let estado: LecturaDeEvento<Datos> = SIN_EVENTO;
    return {
      get: () => estado,
      actualizar: (cambio: (a: LecturaDeEvento<Datos>) => LecturaDeEvento<Datos>) => {
        estado = cambio(estado);
      },
    };
  }

  const diferido = <T,>() => {
    let resolver!: (v: T) => void;
    let rechazar!: (e: unknown) => void;
    const promesa = new Promise<T>((res, rej) => {
      resolver = res;
      rechazar = rej;
    });
    return { promesa, resolver, rechazar };
  };

  const asentar = () => new Promise((r) => setTimeout(r, 0));

  it('reabrir el mismo evento y fallar conserva lo leído; el error se señala aparte', async () => {
    const c = contenedor();
    const cargar = vi
      .fn<(id: string) => Promise<Datos>>()
      .mockResolvedValueOnce({ lista: ['A'] })
      .mockRejectedValueOnce(new Error('red'));

    const cancelar1 = iniciarLectura({ eventoId: 'e1', cargar, actualizar: c.actualizar });
    await asentar();
    expect(datosVigentes(lecturaDelEvento(c.get(), 'e1'))).toEqual({ lista: ['A'] });

    // Cierra la ficha y vuelve a abrir el mismo torneo.
    cancelar1();
    iniciarLectura({ eventoId: 'e1', cargar, actualizar: c.actualizar });
    // Mientras reintenta, lo anterior sigue visible.
    expect(datosVigentes(lecturaDelEvento(c.get(), 'e1'))).toEqual({ lista: ['A'] });
    await asentar();
    const lectura = lecturaDelEvento(c.get(), 'e1');
    expect(lectura.tipo).toBe('error');
    expect(datosVigentes(lectura)).toEqual({ lista: ['A'] });
  });

  it('un fallo sin lectura previa no es una lista vacía', async () => {
    const c = contenedor();
    iniciarLectura({ eventoId: 'e1', cargar: async () => { throw new Error('x'); }, actualizar: c.actualizar });
    await asentar();
    const l = lecturaDelEvento(c.get(), 'e1');
    expect(l).toEqual({ tipo: 'error', previos: null });
    expect(datosVigentes(l)).toBeNull();
  });

  it('cambiar de evento no enseña los datos del anterior ni acepta su respuesta tardía', async () => {
    const c = contenedor();
    const a = diferido<Datos>();
    const cancelarA = iniciarLectura({ eventoId: 'A', cargar: () => a.promesa, actualizar: c.actualizar });
    a.resolver({ lista: ['de-A'] });
    await asentar();
    expect(datosVigentes(lecturaDelEvento(c.get(), 'A'))).toEqual({ lista: ['de-A'] });

    const tardiaA = diferido<Datos>();
    cancelarA();
    iniciarLectura({ eventoId: 'A', cargar: () => tardiaA.promesa, actualizar: c.actualizar });
    cancelarA();

    const b = diferido<Datos>();
    iniciarLectura({ eventoId: 'B', cargar: () => b.promesa, actualizar: c.actualizar });
    // Ya se mira B: nada de A, ni siquiera como «previos».
    expect(datosVigentes(lecturaDelEvento(c.get(), 'B'))).toBeNull();
    expect(datosVigentes(lecturaDelEvento(c.get(), 'A'))).toBeNull();

    // La respuesta tardía de A no pisa a B.
    tardiaA.resolver({ lista: ['tardia-A'] });
    await asentar();
    expect(c.get().eventoId).toBe('B');
    expect(datosVigentes(lecturaDelEvento(c.get(), 'B'))).toBeNull();

    b.resolver({ lista: ['de-B'] });
    await asentar();
    expect(datosVigentes(lecturaDelEvento(c.get(), 'B'))).toEqual({ lista: ['de-B'] });
  });

  it('una respuesta que llega tras cerrar la ficha se descarta', async () => {
    const c = contenedor();
    const d = diferido<Datos>();
    const cancelar = iniciarLectura({ eventoId: 'A', cargar: () => d.promesa, actualizar: c.actualizar });
    cancelar();
    d.resolver({ lista: ['tarde'] });
    await asentar();
    expect(datosVigentes(lecturaDelEvento(c.get(), 'A'))).toBeNull();
  });

  it('la ficha no reinicia la lectura al reabrir: el efecto depende del id, no del objeto', () => {
    const origen = readFileSync(
      new URL('../src/components/calendario/vista.tsx', import.meta.url),
      'utf8',
    );
    expect(origen).toMatch(/\[abiertoId, cargarInscritos\]/);
    expect(origen).not.toMatch(/setLecturaInscritos\(\{ tipo: 'sin_consultar' \}\)/);
  });
});
