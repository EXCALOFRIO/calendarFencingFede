import { describe, expect, it } from 'vitest';
import {
  asaltosDeCuadro,
  clasificarUnidad,
  decodificarEngarde,
  esTextoEngarde,
  fechaEngarde,
  leerCompeticion,
  leerCuadro,
  leerPoule,
  leerTiradores,
  leerUnidad,
} from '../src/lib/ingest/sources/engarde-nativo';
import {
  categoriaDe,
  leerFicha,
  nivelesDe,
  precede,
  type Unidad,
} from '../scripts/indexado/rfee-wayback-a-hechos';

// Prueba ficticia recortada con el formato de Engarde 8: 5 tiradores, una poule, cuadro de 4.
const EGW = `(def competition
  type competition
  arme {[type arme] [enumere (("f" fleuret "fleuret"))]}
)

(def ma_competition
  classe competition
  sexe feminin
  type_compe individuelle
  version "                ENGARDE Version 8.16 - 11/11/2005"
  championnat "TNR CADETE PRUEBA"
  id "1"
  arme epee
  categorie cadet
  date "~16/3/2013"
  titre_ligne "ESPADA FEM M17"
  titre1 "TNR PRUEBA M-17"
  titre_reduit "EF17_IND_PRU_16MAR2013"
  federation "RFEE"
  tableauxactifs (a4 a2)
)
`;

const TIREUR = `{[classe tireur] [presence present] [sexe feminin] [status normal] [nom "ALFA UNO "]
 [prenom "Ana"] [serie 1] [club1 1] [nation1 1] [date_nais "~23/6/1997"] [licence_fie
 "N-000001"] [points 4.00] [cle 1]}
{[classe tireur] [presence present] [sexe feminin] [status normal] [nom "BETA DOS"]
 [prenom "Berta"] [club1 2] [nation1 1] [date_nais "~2/7/1996"] [licence_fie "N-000002"] [cle 2]}
{[classe tireur] [presence present] [sexe feminin] [status normal] [nom "GAMMA TRES"]
 [prenom "Carla"] [club1 1] [nation1 1] [date_nais "~1/1/1997"] [licence_fie "0"] [cle 3]}
{[classe tireur] [presence present] [sexe feminin] [status normal] [nom "DELTA CUATRO"]
 [prenom "Diana"] [club1 2] [nation1 1] [licence_fie "N-000004"] [cle 4]}
{[classe tireur] [presence present] [sexe feminin] [status normal] [nom "EPSILON CINCO"]
 [prenom "Elena"] [club1 2] [nation1 1] [licence_fie "N-000005"] [cle 5]}
{[classe tireur] [presence absent] [sexe feminin] [status normal] [nom "ZETA SEIS"]
 [prenom "Fátima"] [club1 2] [nation1 1] [licence_fie "N-000006"] [cle 6]}
`;

const CLUB = `{[classe club] [nom "CLUB-A"] [nation1 1] [cle 1]}
{[classe club] [nom "CLUB-B"] [nation1 1] [cle 2]}
`;
const NATION = `{[classe nation] [nom "ESP"] [cle 1]}
`;

// Filas en el orden de les_tir_feuille (1 2 3 4 5); (w 4) es victoria sin llegar a 5.
const POULE = `{[numero 1]
 [les_tir_cons (1 2 3 4 5)]
 [les_tir_feuille (1 2 3 4 5)]
 [grille (((*** ()) (v 5) (v 5) (v 5) (v 5)) ((d 1) (*** ()) (v 5) (v 5) (v 5))
 ((d 2) (d 3) (*** ()) (w 4) (v 5)) ((d 0) (d 4) (d 3) (*** ()) (v 5))
 ((d 1) (d 2) (d 3) (d 4) (*** ())))]
 [scores ((e 1 1 4 4 20 4))]
}
`;

const CLASPOU = `q;1;1;4;4;20;4;
q;2;2;4;3;16;10;
q;3;3;4;2;14;13;
q;4;4;4;1;12;17;
e;5;5;4;0;10;20;
`;

const A4 = `{[nom a4]
 [taille 4]
 [etat termine]
 [les_matches ({[match (1 4 15 7 1 1 4)] [imprime vrai]}
 {[match (3 2 15 12 3 3 2)] [imprime vrai]})]
}
`;
const A2 = `{[nom a2]
 [taille 2]
 [etat termine]
 [les_matches ({[match (1 3 14 15 3 1 2)]})]
}
`;
const A8_VACIO = `{[nom a8]
 [taille 8]
 [etat vide]
 [les_matches ({[match (() () () () () 1 8)]})]
}
`;

const SUITES = `;Tableau direct sans tirage de la 3e place
{[classe suite_tableaux] [nom "A"] [nom_etendu "tableau direct"] [cle 1] [nomsy a]}
`;

function ficheros(extra: Record<string, string> = {}): Map<string, string> {
  return new Map(Object.entries({
    'competition.egw': EGW,
    'tireur.txt': TIREUR,
    'club.txt': CLUB,
    'nation.txt': NATION,
    'poulet1p1.txt': POULE,
    'claspou_fin_1.txt': CLASPOU,
    'clastab_initial.txt': CLASPOU.split('\n').filter((l) => l.startsWith('q')).join('\n'),
    'tableaua8.txt': A8_VACIO,
    'tableaua4.txt': A4,
    'tableaua2.txt': A2,
    'suite_tableaux.txt': SUITES,
    ...extra,
  }));
}

describe('lector de ficheros nativos de Engarde', () => {
  it('lee los metadatos de competition.egw', () => {
    const m = leerCompeticion(EGW)!;
    expect(m).toMatchObject({
      arma: 'ESPADA', sexo: 'F', categoria: 'cadet', fecha: '2013-03-16', individual: true,
      titulo: 'ESPADA FEM M17', tituloReducido: 'EF17_IND_PRU_16MAR2013', dominio: null,
    });
    expect(m.tableauxActivos).toEqual(['a4', 'a2']);
  });

  it('lee tiradores con club, nación, licencia válida y sólo el año de nacimiento', () => {
    const t = leerTiradores(TIREUR, new Map([['1', 'CLUB-A'], ['2', 'CLUB-B']]), new Map([['1', 'ESP']]));
    expect(t.size).toBe(6);
    expect(t.get('1')).toMatchObject({ nombre: 'ALFA UNO Ana', club: 'CLUB-A', nacion: 'ESP', licencia: 'N-000001', anioNacimiento: 1997, presente: true });
    expect(t.get('3')!.licencia).toBeNull();
    expect(t.get('6')!.presente).toBe(false);
    expect(Object.values(t.get('1')!).join(' ')).not.toMatch(/23\/6/);
  });

  it('lee la poule en el orden de la hoja, con victorias w y v', () => {
    const p = leerPoule(POULE, 'P')!;
    expect(p.numero).toBe(1);
    expect(p.esperados).toBe(10);
    expect(p.sinResultado).toBe(0);
    expect(p.asaltos).toContainEqual({ ronda: 'P1', a: '3', b: '4', tocadosA: 4, tocadosB: 3, ganador: 'A' });
    expect(p.asaltos).toContainEqual({ ronda: 'P1', a: '1', b: '2', tocadosA: 5, tocadosB: 1, ganador: 'A' });
  });

  it('no inventa asaltos de celdas de abandono o incoherentes', () => {
    const p = leerPoule(POULE.replace('((d 1) (*** ())', '((a ()) (*** ())'), 'P')!;
    expect(p.sinResultado).toBe(1);
    expect(p.asaltos.every((b) => !(b.a === '1' && b.b === '2'))).toBe(true);
  });

  it('lee cruces del cuadro con exentos y abandonos', () => {
    const c = leerCuadro(`{[nom a8] [taille 8] [etat termine] [les_matches ({[match (1 nobody () () 1 1 8)]} {[match (2 7 abandon () 7 2 7)]} {[match (3 6 15 9 3 3 6)]})]}`)!;
    expect(c).toMatchObject({ nombre: 'a8', suite: 'a', tamano: 8, estado: 'termine' });
    expect(c.cruces[0]).toMatchObject({ a: '1', b: null, ganador: '1' });
    expect(c.cruces[1]).toMatchObject({ a: '2', b: '7', tocadosA: null, incidencia: 'abandon', ganador: '7' });
    expect(c.cruces[2]).toMatchObject({ tocadosA: 15, tocadosB: 9, plazaA: 3, plazaB: 6 });
  });

  it('calcula la clasificación final con la regla de Engarde', () => {
    const l = leerUnidad(ficheros());
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    const c = clasificarUnidad(l.unidad);
    const puesto = Object.fromEntries(c.puestos.map((p) => [p.cle, p.posicion]));
    // Final: 3 gana a 1; semifinalistas empatados en el 3; la eliminada en poules, 5ª.
    expect(puesto).toEqual({ '3': 1, '1': 2, '2': 3, '4': 3, '5': 5 });
    expect(c.completa).toBe(true);
    expect(asaltosDeCuadro(l.unidad).map((b) => b.ronda).sort()).toEqual(['T2', 'T4', 'T4']);
  });

  it('con asalto por el tercer puesto, los semifinalistas quedan 3º y 4º', () => {
    const l = leerUnidad(ficheros({
      'suite_tableaux.txt': `${SUITES}{[classe suite_tableaux] [nom "B"] [nom_etendu "asalto por el tercer lugar"] [cle 2] [nomsy b]}\n`,
      'tableaub2.txt': `{[nom b2] [taille 2] [etat termine] [les_matches ({[match (4 2 15 13 4 1 2)]})]}`,
    }));
    if (!l.ok) throw new Error(l.motivo);
    const puesto = Object.fromEntries(clasificarUnidad(l.unidad).puestos.map((p) => [p.cle, p.posicion]));
    expect(puesto['4']).toBe(3);
    expect(puesto['2']).toBe(4);
    expect(asaltosDeCuadro(l.unidad).filter((b) => b.ronda === 'C2')).toHaveLength(1);
  });

  it('si la final no está decidida, la deja sin puesto y no da la prueba por completa', () => {
    const l = leerUnidad(ficheros({ 'tableaua2.txt': `{[nom a2] [taille 2] [etat en_cours] [les_matches ({[match (1 3 () () () 1 2)]})]}` }));
    if (!l.ok) throw new Error(l.motivo);
    const c = clasificarUnidad(l.unidad);
    expect(c.completa).toBe(false);
    expect(c.supervivientes.sort()).toEqual(['1', '3']);
    expect(c.puestos.find((p) => p.cle === '2')!.posicion).toBe(3);
  });

  it('los abandonos en poules quedan al final, empatados', () => {
    const l = leerUnidad(ficheros({ 'claspou_fin_1.txt': CLASPOU.replace('e;5;5;', 'a;5;5;') }));
    if (!l.ok) throw new Error(l.motivo);
    expect(clasificarUnidad(l.unidad).puestos.find((p) => p.cle === '5')).toMatchObject({ posicion: 5 });
  });

  it('detecta los ficheros cifrados de Engarde 9', () => {
    expect(esTextoEngarde('!TSLOcLTY5S[JfMT>\noik5XcUXZU)UWg5T;')).toBe(false);
    expect(leerUnidad(ficheros({ 'tireur.txt': '!TSLOcLTY5S[JfMT>\noik5XcUXZU)UWg5T;' }))).toEqual({ ok: false, motivo: 'cifrado' });
  });

  it('decodifica windows-1252 y fechas de Engarde', () => {
    expect(decodificarEngarde(new Uint8Array([0x45, 0x53, 0x50, 0x41, 0xd1, 0x41]))).toBe('ESPAÑA');
    expect(fechaEngarde('~2/7/1997')).toBe('1997-07-02');
    expect(fechaEngarde('~')).toBeNull();
  });
});

describe('conversión de la web antigua de la RFEE', () => {
  it('lee la ficha del calendario', () => {
    const html = `<td style="font-family:arial; font-size:17px; color:#103746;">CW PRUEBA</td>
      <td width="50%"><strong>Fecha Inicio:</strong> 25/10/2009</td><td><strong>Fecha Fin:</strong> 26/10/2009</td>
      <td><strong>Municipio:</strong> VILLA FICTICIA</td>
      <a href="calendario/181.htm">x</a> <a href="calendario/182.rar">y</a>`;
    expect(leerFicha(html, '1-147')).toEqual({
      clave: '1-147', titulo: 'CW PRUEBA', inicio: '2009-10-25', fin: '2009-10-26', municipio: 'VILLA FICTICIA', archivos: ['182'],
    });
  });

  it('elige la categoría del título antes que la de Engarde', () => {
    expect(categoriaDe(['TNR M-15 ESPADA FEM'], 'cadet')).toBe('M15');
    expect(categoriaDe(['FASE NACIONAL M-23 ABS'], null)).toBe('ABS');
    expect(categoriaDe(['CRN 2011 M-10'], 'pupille')).toBe('M10');
    expect(categoriaDe(['TORNEO SAMA'], 'senior')).toBe('ABS');
    expect(categoriaDe(['TORNEO SAMA'], null)).toBeNull();
  });

  it('ordena las fases a partir de la final', () => {
    const u = (nombre: string, presentes: string[], supervivientes: string[], asaltos: number) =>
      ({ ruta: nombre, presentes: new Set(presentes), supervivientes: new Set(supervivientes), asaltosPoule: asaltos, asaltosCuadro: 0 }) as unknown as Unidad;
    const fase1 = u('1F', ['a', 'b', 'c', 'd', 'e', 'f'], ['a', 'b'], 15);
    const final = u('2F', ['a', 'b', 'x', 'y'], [], 9);
    expect(precede(fase1, final)).toBe(true);
    expect(precede(final, fase1)).toBe(false);
    const { niveles, sueltas } = nivelesDe([fase1, final]);
    expect(niveles.map((n) => n.map((x) => x.ruta))).toEqual([['2F'], ['1F']]);
    expect(sueltas).toEqual([]);
  });
});
