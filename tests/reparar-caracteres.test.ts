import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { quitarGuardia, restaurarGuardia } from '../scripts/indexado/comun';
import { csv, reparar } from '../scripts/indexado/reparar-caracteres';
import {
  construirDiccionario, encajar, letrasDeVariante, proponer, SUSTITUCION as X,
} from '../src/lib/sport/nombres/reparar-caracteres';

const sinVariantes: [] = [];

describe('reparar-caracteres (módulo)', () => {
  it('encaja una palabra rota con otra de la misma letra base fuera del hueco', () => {
    expect(encajar(`MU${X}OZ`, 'MUÑOZ')).toEqual(['Ñ']);
    expect(encajar(`MU${X}OZ`, 'munoz')).toEqual(['N']);
    expect(encajar(`MU${X}OZ`, 'MUÑOZA')).toBeNull();
    expect(encajar(`S${X}NCHEZ`, 'SANCHEZ')).toEqual(['A']);
    expect(encajar(`MU${X}OZ`, `MU${X}OZ`)).toBeNull();
  });

  it('lee las letras de una variante aunque cambie el orden de las palabras', () => {
    const l = letrasDeVariante(`MOMP${X} LISARDE Clara`, 'CLARA MOMPÓ LISARDE', true);
    expect(l?.get(0)).toEqual(['Ó']);
    expect(letrasDeVariante(`MOMP${X} LISARDE Clara`, 'CLARA MOMPÓ RUIZ', true)).toBeNull();
    // Una lectura de la prueba con una palabra de más no cuenta; la misma persona sí.
    expect(letrasDeVariante(`PE${X}A Ana`, 'PEÑA LOPEZ Ana', true)).toBeNull();
    expect(letrasDeVariante(`PE${X}A Ana`, 'PEÑA LOPEZ Ana', false)?.get(0)).toEqual(['Ñ']);
  });

  it('vía a: variante con la letra, o sin tilde cuando la base sólo admite una letra', () => {
    const dic = construirDiccionario([]);
    const a = proponer(`MU${X}OZ Ana`, [{ nombre: 'MUÑOZ Ana', origen: 'alias', mismaPersona: true }], dic);
    expect(a).toMatchObject({ propuesta: 'MUÑOZ Ana', via: 'a' });
    const n = proponer(`NU${X}EZ Leo`, [{ nombre: 'NUNEZ Leo', origen: 'fusión', mismaPersona: true }], dic);
    expect(n).toMatchObject({ propuesta: 'NUÑEZ Leo', via: 'a' });
    expect(n.palabras[0].evidencia).toContain('única letra no ASCII');
    // Una «A» sin tilde no decide entre Á, À, Ä…: sin diccionario queda pendiente.
    const v = proponer(`Xi${X}n FRANCO`, [{ nombre: 'Xian FRANCO', origen: 'fusión', mismaPersona: true }], dic);
    expect(v.propuesta).toBeNull();
    // Con diccionario, la base «A» restringe la elección.
    const v2 = proponer(`Xi${X}n FRANCO`, [{ nombre: 'Xian FRANCO', origen: 'fusión', mismaPersona: true }], construirDiccionario(['XIÁN OTERO']));
    expect(v2).toMatchObject({ propuesta: 'Xián FRANCO', via: 'b' });
  });

  it('ignora variantes que ponen una letra imposible y no decide si se contradicen', () => {
    const dic = construirDiccionario([]);
    const r = proponer(`PE${X}ARE Ana`, [{ nombre: 'PERARE Ana', origen: 'prueba', mismaPersona: false }], dic);
    expect(r.propuesta).toBeNull();
    expect(r.palabras[0].evidencia).not.toContain('PERARE');
    const c = proponer(`P${X}REZ Ana`, [
      { nombre: 'PÉREZ Ana', origen: 'x', mismaPersona: true },
      { nombre: 'PÍREZ Ana', origen: 'y', mismaPersona: true },
    ], construirDiccionario(['PÉREZ A', 'PÉREZ B', 'PÉREZ C', 'PÉREZ D', 'PÉREZ E']));
    expect(c).toMatchObject({ propuesta: 'PÉREZ Ana', via: 'b' });
  });

  it('vía b: palabra única o dominante (≥95 % y ≥5 nombres)', () => {
    const unica = proponer(`Trist${X}n AMORES`, sinVariantes, construirDiccionario(['TRISTÁN LOPEZ']));
    expect(unica).toMatchObject({ propuesta: 'Tristán AMORES', via: 'b' });
    expect(proponer(`${X}lvaro RUIZ`, sinVariantes, construirDiccionario(['Álvaro Gil'])).propuesta).toBe('Álvaro RUIZ');
    const dominante = construirDiccionario([...Array.from({ length: 19 }, (_, i) => `GONZÁLEZ ${i}`), 'GONZÀLEZ Z']);
    expect(proponer(`GONZ${X}LEZ Ana`, sinVariantes, dominante).propuesta).toBe('GONZÁLEZ Ana');
    // Letras base distintas (É frente a Í): sigue haciendo falta el 95 %.
    const bases = construirDiccionario([...Array.from({ length: 9 }, (_, i) => `PÉREZ ${i}`), 'PÍREZ Z']);
    const d = proponer(`P${X}REZ Ana`, sinVariantes, bases);
    expect(d.propuesta).toBeNull();
    expect(d.palabras[0].evidencia).toContain('sin mayoría clara');
  });

  it('vía b: si sólo cambia el acento sobre la misma letra base, basta ≥80 % y ≥5', () => {
    const fern = construirDiccionario([...Array.from({ length: 15 }, (_, i) => `FERNÁNDEZ ${i}`), 'FERNÀNDEZ Y', 'FERNÀNDEZ Z']);
    const f = proponer(`FERN${X}NDEZ Ana`, sinVariantes, fern);
    expect(f).toMatchObject({ propuesta: 'FERNÁNDEZ Ana', via: 'b' });
    expect(f.palabras[0].evidencia).toContain('mismo acento base: 15 frente a 2');
    // Tres variantes de la A (Á, À, Ã) siguen siendo «mismo acento».
    const hern = construirDiccionario([...Array.from({ length: 8 }, (_, i) => `HERNÁNDEZ ${i}`), 'HERNÀNDEZ Y', 'HERNÃNDEZ Z']);
    expect(proponer(`HERN${X}NDEZ Leo`, sinVariantes, hern).propuesta).toBe('HERNÁNDEZ Leo');
    // Por debajo del 80 %.
    const alex = construirDiccionario(['ÀLEX 1', 'ÀLEX 2', 'ÀLEX 3', 'ÀLEX 4', 'ÁLEX 5', 'ÁLEX 6']);
    expect(proponer(`${X}lex GIL`, sinVariantes, alex).propuesta).toBeNull();
    // 80 % pero menos de 5 nombres.
    const pocas = construirDiccionario(['GÓMEZ 1', 'GÓMEZ 2', 'GÓMEZ 3', 'GÓMEZ 4', 'GÒMEZ 5']);
    expect(proponer(`G${X}MEZ Ana`, sinVariantes, pocas).propuesta).toBeNull();
    // Justo en el 80 % con 8 nombres.
    const justo = construirDiccionario([...Array.from({ length: 8 }, (_, i) => `INÉS ${i}`), 'INÊS Y', 'INÊS Z']);
    expect(proponer(`In${X}s RUIZ`, sinVariantes, justo).propuesta).toBe('Inés RUIZ');
    // Las dominantes de antes no dicen «mismo acento» cuando no hay rivales.
    expect(proponer(`G${X}MEZ Ana`, sinVariantes, construirDiccionario(['GÓMEZ 1'])).palabras[0].evidencia).not.toContain('mismo acento');
  });

  it('vía c: Ñ sólo en patrones españoles claros; si no, se deja', () => {
    const dic = construirDiccionario([]);
    expect(proponer(`XU${X}OZ Ana`, sinVariantes, dic)).toMatchObject({ propuesta: 'XUÑOZ Ana', via: 'c' });
    expect(proponer(`CA${X}ADA Ana`, sinVariantes, dic)).toMatchObject({ propuesta: 'CAÑADA Ana', via: 'c' });
    expect(proponer(`AVENDA${X}O PESTA${X}A Diego`, sinVariantes, construirDiccionario(['AVENDAÑO GIL Eva'])))
      .toMatchObject({ propuesta: 'AVENDAÑO PESTAÑA Diego', via: 'c' });
    expect(proponer(`CATALA PE${X}ATE Alejandro`, sinVariantes, dic)).toMatchObject({ propuesta: 'CATALA PEÑATE Alejandro', via: 'c' });
    expect(proponer(`MONTA${X}A Luz`, sinVariantes, dic).palabras[0].evidencia).toContain('patrón español');
    // Si el diccionario conoce otra letra para la palabra, el patrón no decide.
    expect(proponer(`ZARA${X}A Luz`, sinVariantes, construirDiccionario(['ZARAÍA 1', 'ZARAÚA 2'])).propuesta).toBeNull();
    // Fuera del patrón no se inventa: «…A�AS», «…E�ATO», «…A�O».
    for (const w of [`PESTA${X}AS`, `PE${X}ATO`, `GABALD${X}N`]) expect(proponer(`${w} Ana`, sinVariantes, dic).propuesta).toBeNull();
    const p = proponer(`PE${X}ARE Ana`, sinVariantes, dic);
    expect(p).toMatchObject({ propuesta: null, via: null });
    // Con varias palabras rotas, si una no se decide el nombre entero queda pendiente.
    expect(proponer(`MU${X}OZ G${X}MEZ`, sinVariantes, dic).propuesta).toBeNull();
  });

  it('respeta la caja de la palabra y no cuenta palabras ASCII ni rotas en el diccionario', () => {
    const dic = construirDiccionario(['MARÍA LOPEZ', 'maría lopez', `MAR${X}A X`, 'MARIA Y']);
    expect(dic.get('MARÍA')).toBe(1);
    expect(dic.has('MARIA')).toBe(false);
    expect(proponer(`Mar${X}a Ruiz`, sinVariantes, dic).propuesta).toBe('María Ruiz');
  });
});

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  return db;
}

const triggers = (db: DatabaseSync) => Number((db.prepare(`SELECT count(*) n FROM sqlite_master WHERE type='trigger'`).get() as { n: number }).n);

function fixture(): DatabaseSync {
  const db = crearBase();
  quitarGuardia(db);
  db.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name, start_date) VALUES
      ('e1', 'rfee_pdf', '2023-2024', 'pdf:x', 'Copa', '2024-01-01'), ('e2', 'engarde', '2023-2024', 'engarde:x', 'Copa', '2024-01-01');
    INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, format, competition_date) VALUES
      ('c1', 'e1', 'rfee_pdf', '2023-2024', 'pdf:x:1', 'ESPADA', 'F', 'ABS', 'INDIVIDUAL', '2024-01-01'),
      ('c2', 'e2', 'engarde', '2023-2024', 'engarde:x:1', 'ESPADA', 'F', 'ABS', 'INDIVIDUAL', '2024-01-01');`);
  const persona = (id: string, nombre: string, norm: string, merged: string | null = null) => {
    db.prepare(`INSERT INTO sport_person (id, display_name, name_normalized, gender, merged_into_person_id) VALUES (?,?,?,'F',?)`).run(id, nombre, norm, merged);
    db.prepare(`INSERT INTO sport_person_alias (person_id, source, name_original, name_normalized) VALUES (?, 'rfee_pdf', ?, ?)`).run(id, nombre, norm);
  };
  let n = 0;
  const resultado = (comp: string, source: string, nombre: string, persona: string | null, club: string | null = null) =>
    db.prepare(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name, source_club, occurred_on, content_hash)
      VALUES (?,?,?,?,?,?,?, '2024-01-01', 'hash-original')`).run(`r${(n += 1)}`, comp, source, `k${n}`, persona, nombre, club);
  // a: otra lectura de la misma prueba.
  persona('p1', `MU${X}OZ ZAMORANO Aitana`, 'aitana mu oz zamorano');
  resultado('c1', 'rfee_pdf', `MU${X}OZ ZAMORANO Aitana`, 'p1', `SU${X}E-BI`);
  resultado('c2', 'engarde', 'MUÑOZ ZAMORANO Aitana', null);
  db.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_name, fencer_b_name,
    score_a, score_b, content_hash) VALUES ('b1', 'c1', 'rfee_pdf', 'POULE', 'P1', ?, 'z-ref-b', ?, 'GIL Eva', 5, 3, 'h')`)
    .run(`ref-mu${X}oz`, `MU${X}OZ ZAMORANO Aitana`);
  // a: fusionada en una ficha sin tilde; la base N sólo admite Ñ.
  persona('p7', 'NUNEZ Leo', 'leo nunez');
  persona('p6', `NU${X}EZ Leo`, 'ez leo nu', 'p7');
  // b: diccionario.
  persona('p3', `S${X}NCHEZ Ana`, 'ana nchez s');
  for (const [i, nombre] of ['SÁNCHEZ LOPEZ Luis', 'SÁNCHEZ GIL Eva'].entries()) persona(`d${i}`, nombre, nombre.toLowerCase());
  // Pendiente.
  persona('p2', `PE${X}ARE Juan`, 'are juan pe');
  resultado('c1', 'rfee_pdf', `PE${X}ARE Juan`, 'p2');
  // Alias roto que, reparado, choca con uno bueno de la misma persona.
  persona('p8', 'CAÑO Luis', 'cano luis');
  db.prepare(`INSERT INTO sport_person_alias (person_id, source, name_original, name_normalized) VALUES ('p8', 'rfee_pdf', ?, 'ca luis o')`).run(`CA${X}O Luis`);
  db.prepare(`INSERT INTO sport_link_candidate (source, source_ref, source_name, person_id, status) VALUES ('rfee_pdf', 'nombre:x', ?, 'p1', 'CONFIRMADO')`)
    .run(`MU${X}OZ ZAMORANO Aitana`);
  restaurarGuardia(db);
  return db;
}

describe('reparar-caracteres (script)', () => {
  it('el ensayo no escribe y lista lo que haría', () => {
    const db = fixture();
    const inf = reparar(db, ':memory:', false);
    expect(inf.escritura).toBeNull();
    expect((db.prepare(`SELECT display_name d FROM sport_person WHERE id='p1'`).get() as { d: string }).d).toContain(X);
    const por = Object.fromEntries(inf.decisiones.map((d) => [d.original, d]));
    expect(por[`MU${X}OZ ZAMORANO Aitana`]).toMatchObject({ propuesta: 'MUÑOZ ZAMORANO Aitana', via: 'a' });
    expect(por[`MU${X}OZ ZAMORANO Aitana`].palabras[0].evidencia).toContain('misma prueba (engarde)');
    expect(por[`NU${X}EZ Leo`]).toMatchObject({ propuesta: 'NUÑEZ Leo', via: 'a' });
    expect(por[`S${X}NCHEZ Ana`]).toMatchObject({ propuesta: 'SÁNCHEZ Ana', via: 'b' });
    expect(por[`PE${X}ARE Juan`]).toMatchObject({ propuesta: null });
    expect(por[`SU${X}E-BI`]).toMatchObject({ tipo: 'club', propuesta: null });
    expect(inf.resumen).toMatchObject({ distintos: 6, reparados: 4, pendientes: 2 });
    expect(csv(inf)).toContain('MUÑOZ ZAMORANO Aitana');
    // Lo pendiente se lista al final con su persona y su prueba.
    expect(Object.keys(inf).at(-1)).toBe('revisionManual');
    const pe = inf.revisionManual.find((r) => r.original === `PE${X}ARE Juan`);
    expect(pe).toMatchObject({
      palabrasSinDecidir: [{ palabra: `PE${X}ARE`, motivo: 'sin palabra conocida' }],
      personas: [{ id: 'p2', nombre: `PE${X}ARE Juan` }],
      pruebas: [{ id: 'c1', fuente: 'rfee_pdf', clave: 'pdf:x:1', fecha: '2024-01-01', edicion: 'Copa' }],
    });
    expect(inf.revisionManual.map((r) => r.original)).toEqual([`PE${X}ARE Juan`, `SU${X}E-BI`]);
    expect(csv(inf)).toMatch(/revisión manual[\s\S]*PE\uFFFDARE Juan[\s\S]*pdf:x:1/);
  });

  it('--aplicar escribe con la guardia retirada y la repone', () => {
    const db = fixture();
    const antes = triggers(db);
    expect(antes).toBeGreaterThan(0);
    const inf = reparar(db, ':memory:', true);
    expect(triggers(db)).toBe(antes);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name='_indexado_guardia'`).get()).toBeUndefined();
    expect(inf.escritura).toMatchObject({ personas: 3, alias: 3, aliasDuplicadosBorrados: 1, resultados: 1, asaltos: 1, candidatos: 1 });
    expect(db.prepare(`SELECT fencer_a_name, fencer_b_name, fencer_a_ref FROM sport_bout WHERE id='b1'`).get())
      .toMatchObject({ fencer_a_name: 'MUÑOZ ZAMORANO Aitana', fencer_b_name: 'GIL Eva', fencer_a_ref: `ref-mu${X}oz` });
    expect(db.prepare(`SELECT display_name, name_normalized, updated_at FROM sport_person WHERE id='p1'`).get())
      .toMatchObject({ display_name: 'MUÑOZ ZAMORANO Aitana', name_normalized: 'aitana munoz zamorano' });
    expect((db.prepare(`SELECT display_name d FROM sport_person WHERE id='p2'`).get() as { d: string }).d).toBe(`PE${X}ARE Juan`);
    expect(db.prepare(`SELECT source_name, source_club, content_hash, revision, source_fact_key FROM sport_result WHERE person_id='p1'`).get())
      .toMatchObject({ source_name: 'MUÑOZ ZAMORANO Aitana', source_club: `SU${X}E-BI`, content_hash: 'hash-original', revision: 2, source_fact_key: 'k1' });
    expect(db.prepare(`SELECT name_original n FROM sport_person_alias WHERE person_id='p8'`).all()).toEqual([{ n: 'CAÑO Luis' }]);
    expect(db.prepare(`SELECT source_name, source_ref FROM sport_link_candidate`).get()).toMatchObject({ source_name: 'MUÑOZ ZAMORANO Aitana', source_ref: 'nombre:x' });
    // Idempotente: una segunda pasada sólo encuentra lo pendiente.
    const otra = reparar(db, ':memory:', true);
    expect(otra.resumen.reparados).toBe(0);
    expect(otra.escritura).toMatchObject({ personas: 0, alias: 0, resultados: 0, asaltos: 0, candidatos: 0 });
  });
});
