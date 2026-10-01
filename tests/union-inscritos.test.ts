import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aplicarLectura, datosVigentes, estadoDeLista, type Lectura } from '@/lib/entries/lectura';
import {
  aListaVisible,
  contarPorPrueba,
  reencajar,
  unirObservaciones,
  type Observacion,
  type ObservacionCruda,
} from '@/lib/entries/union';

const obs = (o: Partial<Observacion> & Pick<Observacion, 'nombre' | 'fuente'>): Observacion => ({
  competitionId: 'c-fm',
  equipo: '',
  club: null,
  athleteId: null,
  retiradoEn: null,
  sourceUrl: `https://ejemplo.test/${o.fuente}`,
  leidoEl: new Date('2026-10-01T00:00:00Z'),
  ...o,
});

describe('unión de listas FIE + Skermo', () => {
  it('una identidad confirmada en las dos fuentes es una fila con dos evidencias; los exclusivos se quedan', () => {
    const filas = unirObservaciones([
      obs({ nombre: 'JORGE PRUEBA UNO', fuente: 'skermo_rfee', athleteId: 'a1', club: 'CLUB X' }),
      obs({ nombre: 'PRUEBA UNO Jorge', fuente: 'fie', athleteId: 'a1' }),
      obs({ nombre: 'SOLO SKERMO', fuente: 'skermo_rfee' }),
      obs({ nombre: 'SOLO FIE', fuente: 'fie', athleteId: 'a9' }),
    ]);

    expect(filas).toHaveLength(3);
    const unida = filas.find((f) => f.athleteIds.includes('a1'))!;
    expect(unida.observaciones.map((o) => o.fuente).sort()).toEqual(['fie', 'skermo_rfee']);
    expect(unida.nombre).toBe('JORGE PRUEBA UNO');
    expect(unida.club).toBe('CLUB X');
    expect(filas.map((f) => f.nombre)).toEqual(
      expect.arrayContaining(['SOLO SKERMO', 'SOLO FIE']),
    );
  });

  it('Skermo con menos filas no descarta los exclusivos de la FIE', () => {
    const fie = ['f1', 'f2', 'f3', 'f4'].map((id) =>
      obs({ nombre: `FIE ${id}`, fuente: 'fie', athleteId: id }),
    );
    const filas = unirObservaciones([obs({ nombre: 'SKERMO UNO', fuente: 'skermo_rfee' }), ...fie]);
    for (const id of ['f1', 'f2', 'f3', 'f4']) {
      expect(filas.some((f) => f.athleteIds.includes(id))).toBe(true);
    }
    expect(filas).toHaveLength(5);
  });

  it('el mismo nombre sin identidad confirmada no se funde, ni entre fuentes ni entre homónimos', () => {
    const entreFuentes = unirObservaciones([
      obs({ nombre: 'ANA GARCIA', fuente: 'skermo_rfee' }),
      obs({ nombre: 'ANA GARCIA', fuente: 'fie' }),
    ]);
    expect(entreFuentes).toHaveLength(2);

    const homonimos = unirObservaciones([
      obs({ nombre: 'ANA GARCIA', fuente: 'fie', athleteId: 'a1' }),
      obs({ nombre: 'ANA GARCIA', fuente: 'skermo_rfee', athleteId: 'a2' }),
    ]);
    expect(homonimos).toHaveLength(2);
    expect(homonimos.flatMap((f) => f.athleteIds).sort()).toEqual(['a1', 'a2']);
  });

  it('el estado conflict del resolvedor impide fundir y no elige candidato', () => {
    const filas = unirObservaciones([
      obs({
        nombre: 'A', fuente: 'fie', athleteId: 'a1',
        resolucion: { kind: 'conflict', personIds: ['p1', 'p2'] },
      }),
      obs({ nombre: 'A', fuente: 'skermo_rfee', athleteId: 'a1' }),
    ]);
    expect(filas).toHaveLength(2);
    for (const f of filas) expect(f.observaciones).toHaveLength(1);
  });

  it('una ficha con dos personas confirmadas distintas no se funde con ninguna', () => {
    const filas = unirObservaciones([
      obs({ nombre: 'X', fuente: 'fie', athleteId: 'a1', resolucion: { kind: 'confirmed', personId: 'p1' } }),
      obs({ nombre: 'X', fuente: 'skermo_rfee', athleteId: 'a1', resolucion: { kind: 'confirmed', personId: 'p2' } }),
      obs({ nombre: 'X2', fuente: 'skermo_regional', athleteId: 'a1' }),
    ]);
    expect(filas).toHaveLength(3);
  });

  it('una persona confirmada funde observaciones aunque la ficha local falte en una', () => {
    const filas = unirObservaciones([
      obs({ nombre: 'P', fuente: 'fie', resolucion: { kind: 'confirmed', personId: 'p1' } }),
      obs({ nombre: 'P otra', fuente: 'skermo_rfee', resolucion: { kind: 'confirmed', personId: 'p1' } }),
    ]);
    expect(filas).toHaveLength(1);
  });

  it('prueba y equipo forman parte del contexto: no se mezclan listas', () => {
    const filas = unirObservaciones([
      obs({ nombre: 'A', fuente: 'fie', athleteId: 'a1', competitionId: 'c-fm' }),
      obs({ nombre: 'A', fuente: 'fie', athleteId: 'a1', competitionId: 'c-ff' }),
      obs({ nombre: 'A', fuente: 'fie', athleteId: 'a1', competitionId: 'c-fm-eq', equipo: 'ESP' }),
      obs({ nombre: 'A', fuente: 'fie', athleteId: 'a1', competitionId: 'c-fm-eq', equipo: 'ESP 2' }),
    ]);
    expect(filas).toHaveLength(4);
    expect(new Set(filas.map((f) => f.competitionId))).toEqual(
      new Set(['c-fm', 'c-ff', 'c-fm-eq']),
    );
  });

  it('releer los mismos datos no duplica filas ni evidencias', () => {
    const una = [
      obs({ nombre: 'A', fuente: 'fie', athleteId: 'a1' }),
      obs({ nombre: 'A SK', fuente: 'skermo_rfee', athleteId: 'a1' }),
    ];
    const filas = unirObservaciones([...una, ...una]);
    expect(filas).toHaveLength(1);
    expect(filas[0].observaciones).toHaveLength(2);
  });

  it('una baja en una fuente no quita a quien sigue vigente en la otra', () => {
    const baja = new Date('2026-10-02T00:00:00Z');
    const mixta = unirObservaciones([
      obs({ nombre: 'A', fuente: 'fie', athleteId: 'a1', retiradoEn: baja }),
      obs({ nombre: 'A SK', fuente: 'skermo_rfee', athleteId: 'a1' }),
    ]);
    expect(mixta).toHaveLength(1);
    expect(mixta[0].retiradoEn).toBeNull();

    const todas = [
      obs({ nombre: 'B', fuente: 'fie', athleteId: 'a2', retiradoEn: baja }),
      obs({ nombre: 'B SK', fuente: 'skermo_rfee', athleteId: 'a2', retiradoEn: baja }),
    ];
    expect(unirObservaciones(todas)).toHaveLength(0);
    const conBajas = unirObservaciones(todas, { incluirRetirados: true });
    expect(conBajas).toHaveLength(1);
    expect(conBajas[0].retiradoEn).toEqual(baja);
  });
});

describe('reencaje por prueba', () => {
  const cruda = (o: Partial<ObservacionCruda>): ObservacionCruda => ({
    ...obs({ nombre: 'N', fuente: 'fie' }),
    prueba: 'FLORETE|M|ABS|INDIVIDUAL',
    tarjeta: 't1',
    competitionId: 'fie-fm',
    ...o,
  });

  it('cuelga la lista de la FIE de la prueba equivalente y deja aparte equipos y otro género', () => {
    const destinos = new Map([
      ['t1|FLORETE|M|ABS|INDIVIDUAL', 'es-fm'],
      ['t1|FLORETE|F|ABS|INDIVIDUAL', 'es-ff'],
      ['t1|FLORETE|M|ABS|EQUIPOS', 'fie-fm-eq'],
    ]);
    const salida = reencajar(
      [
        cruda({}),
        cruda({ prueba: 'FLORETE|F|ABS|INDIVIDUAL', competitionId: 'fie-ff' }),
        cruda({ prueba: 'FLORETE|M|ABS|EQUIPOS', competitionId: 'fie-fm-eq', equipo: 'ESP' }),
        cruda({ prueba: 'ESPADA|M|ABS|INDIVIDUAL', competitionId: 'fie-em' }),
      ],
      destinos,
    );
    expect(salida.map((s) => s.competitionId)).toEqual(['es-fm', 'es-ff', 'fie-fm-eq', 'fie-em']);
    expect(salida[0]).not.toHaveProperty('prueba');
    expect(salida[0]).not.toHaveProperty('tarjeta');
  });
});

describe('regresión Takamatsu 2026 (fixture del 2026-10-01)', () => {
  type Fixture = {
    consultadoEl: string;
    fie: {
      competitionId: number;
      genero: 'M' | 'F';
      formato: 'INDIVIDUAL' | 'EQUIPOS';
      url: string;
      espanolesFieId: number[];
    }[];
    skermo: { pruebas: { skermoId: number; genero: string; formato: string; publicados: number }[] };
  };
  const fx = JSON.parse(
    readFileSync(new URL('./fixtures/takamatsu-2026-inscritos.json', import.meta.url), 'utf8'),
  ) as Fixture;

  const destinoDe = (g: string, f: string) => `dest-${g}-${f}`;
  const clave = (g: string, f: string) => `FLORETE|${g}|ABS|${f}`;
  const destinos = new Map<string, string>(
    fx.fie.map((p) => [`tak|${clave(p.genero, p.formato)}`, destinoDe(p.genero, p.formato)]),
  );

  const crudas: ObservacionCruda[] = [
    ...fx.fie.flatMap((p) =>
      p.espanolesFieId.map<ObservacionCruda>((id) => ({
        ...obs({
          nombre: `ESP ${id}`,
          fuente: 'fie',
          athleteId: `ath-${id}`,
          sourceUrl: p.url,
          equipo: p.formato === 'EQUIPOS' ? 'ESP' : '',
        }),
        competitionId: `fie-${p.competitionId}`,
        prueba: clave(p.genero, p.formato),
        tarjeta: 'tak',
      })),
    ),
    // Skermo publica menos y sin ID de la FIE: no se puede afirmar que sea ninguno de ellos.
    ...fx.skermo.pruebas
      .filter((s) => s.publicados > 0)
      .flatMap((s) =>
        Array.from({ length: s.publicados }, (_, i) => ({
          ...obs({ nombre: `SKERMO ${s.skermoId}-${i}`, fuente: 'skermo_rfee' }),
          competitionId: `sk-${s.skermoId}`,
          prueba: clave(s.genero, s.formato),
          tarjeta: 'tak',
        })),
      ),
  ];

  const filas = unirObservaciones(reencajar(crudas, destinos));
  const de = (g: string, f: string) => filas.filter((x) => x.competitionId === destinoDe(g, f));

  it('conserva a todos los españoles de la FIE aunque Skermo publique menos', () => {
    for (const p of fx.fie) {
      const dentro = de(p.genero, p.formato).flatMap((x) => x.athleteIds);
      for (const id of p.espanolesFieId) expect(dentro).toContain(`ath-${id}`);
    }
    const skermoFemenino = fx.skermo.pruebas.find((s) => s.genero === 'F')!;
    const femenino = fx.fie.find((p) => p.genero === 'F' && p.formato === 'INDIVIDUAL')!;
    expect(de('F', 'INDIVIDUAL').length).toBeGreaterThanOrEqual(
      Math.max(femenino.espanolesFieId.length, skermoFemenino.publicados),
    );
  });

  it('mantiene separadas masculino/femenino e individual/equipos', () => {
    const claves = new Set(filas.map((f) => f.competitionId));
    expect(claves).toEqual(
      new Set(fx.fie.map((p) => destinoDe(p.genero, p.formato))),
    );
    // Los mismos deportistas están en individual y en equipos y siguen siendo filas de pruebas distintas.
    const individual = de('M', 'INDIVIDUAL').flatMap((x) => x.athleteIds);
    const equipos = de('M', 'EQUIPOS').flatMap((x) => x.athleteIds);
    expect(individual.filter((id) => equipos.includes(id)).length).toBeGreaterThan(0);
    expect(filas.filter((f) => f.athleteIds.includes('ath-32606'))).toHaveLength(2);
    // Ninguna ficha femenina aparece en una lista masculina.
    const femeninas = fx.fie.filter((p) => p.genero === 'F').flatMap((p) => p.espanolesFieId);
    const masculinos = de('M', 'INDIVIDUAL').flatMap((x) => x.athleteIds);
    for (const id of femeninas) expect(masculinos).not.toContain(`ath-${id}`);
  });

  it('una lista de equipos no es una selección: sólo publica equipo y los miembros publicados', () => {
    for (const f of de('F', 'EQUIPOS')) {
      expect(f.equipo).toBe('ESP');
      expect(f.observaciones.every((o) => o.fuente === 'fie')).toBe(true);
    }
  });

  it('no usa los recuentos como constantes: la propiedad es por conjunto, no por número', () => {
    const publicados = contarPorPrueba(filas);
    for (const p of fx.fie) {
      expect(publicados[destinoDe(p.genero, p.formato)]).toBeGreaterThanOrEqual(
        p.espanolesFieId.length,
      );
    }
  });
});

describe('procedencia interna, sin etiquetas ni datos personales en la lista visible', () => {
  it('dos observaciones producen una fila cuya serialización no lleva fuente, URL, licencia ni ficha ajena', () => {
    const filas = unirObservaciones([
      obs({ nombre: 'A UNO', fuente: 'skermo_rfee', athleteId: 'ficha-secreta', sourceUrl: 'https://app.skermo.org/x' }),
      obs({ nombre: 'UNO A', fuente: 'fie', athleteId: 'ficha-secreta', sourceUrl: 'https://fie.org/y' }),
    ]);
    expect(filas[0].observaciones.map((o) => o.sourceUrl).sort()).toEqual([
      'https://app.skermo.org/x',
      'https://fie.org/y',
    ]);

    const visible = aListaVisible(filas, new Set(['ficha-secreta']));
    expect(visible).toHaveLength(1);
    expect(visible[0].esMio).toBe(true);
    expect(Object.keys(visible[0]).sort()).toEqual(
      ['club', 'competitionId', 'equipo', 'esMio', 'nombre', 'retiradoEn'],
    );
    const texto = JSON.stringify(visible);
    for (const prohibido of ['ficha-secreta', 'skermo', 'fie', 'http', 'licen', 'birth', 'email', 'correo']) {
      expect(texto.toLowerCase()).not.toContain(prohibido);
    }
  });

  it('esMio se calcula por ficha confirmada, no por nombre', () => {
    const filas = unirObservaciones([
      obs({ nombre: 'ANA GARCIA', fuente: 'fie', athleteId: 'otra' }),
    ]);
    expect(aListaVisible(filas, new Set(['mia']))[0].esMio).toBe(false);
  });
});

describe('lista no consultada, vacía y fallo de lectura', () => {
  it('son tres estados distintos', () => {
    expect(estadoDeLista({ consultada: false, filas: 0 })).toBe('sin_consultar');
    expect(estadoDeLista({ consultada: true, filas: 0 })).toBe('vacia');
    expect(estadoDeLista({ consultada: true, filas: 3 })).toBe('con_datos');
    expect(estadoDeLista({ consultada: true, filas: 0, fallo: true })).toBe('error');
    expect(estadoDeLista({ consultada: false, filas: 0, fallo: true })).toBe('error');
  });

  it('un error conserva el último dato válido, no lo vacía; una corrección lo sustituye', () => {
    let l: Lectura<string[]> = { tipo: 'sin_consultar' };
    expect(datosVigentes(l)).toBeNull();

    l = aplicarLectura(l, { ok: true, datos: ['a', 'b'] });
    l = aplicarLectura(l, { ok: false });
    expect(l.tipo).toBe('error');
    expect(datosVigentes(l)).toEqual(['a', 'b']);

    l = aplicarLectura(l, { ok: false });
    expect(datosVigentes(l)).toEqual(['a', 'b']);

    l = aplicarLectura(l, { ok: true, datos: ['a', 'c'] });
    expect(datosVigentes(l)).toEqual(['a', 'c']);
    l = aplicarLectura(l, { ok: true, datos: ['a', 'c'] });
    expect(datosVigentes(l)).toEqual(['a', 'c']);
  });

  it('un error sin lectura previa no es una lista vacía; una lista vacía válida tampoco es error', () => {
    const error = aplicarLectura<string[]>({ tipo: 'sin_consultar' }, { ok: false });
    expect(error).toEqual({ tipo: 'error', previos: null });
    expect(datosVigentes(error)).not.toEqual([]);

    const vacia = aplicarLectura<string[]>({ tipo: 'sin_consultar' }, { ok: true, datos: [] });
    expect(vacia.tipo).toBe('ok');
    expect(datosVigentes(vacia)).toEqual([]);
  });
});

describe('inscripción futura no es resultado ni duelo', () => {
  it('la unión de inscritos no lee ni produce puestos, asaltos ni marcadores', () => {
    const origen =
      readFileSync(new URL('../src/lib/queries/inscritos-union.ts', import.meta.url), 'utf8') +
      readFileSync(new URL('../src/lib/entries/union.ts', import.meta.url), 'utf8');
    expect(origen).not.toMatch(/sportResult|sportBout|sport_result|sport_bout|officialRankingEntry/);

    const [fila] = unirObservaciones([obs({ nombre: 'A', fuente: 'fie', athleteId: 'a1' })]);
    for (const campo of ['position', 'puesto', 'score', 'marcador', 'victorias']) {
      expect(fila).not.toHaveProperty(campo);
    }
  });
});
