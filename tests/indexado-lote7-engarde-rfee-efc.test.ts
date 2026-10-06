import { describe, expect, it } from 'vitest';
import { hechosPrueba, type HechosPrueba } from '../src/lib/ingest/hechos/formato';
import { CLAVES_FIJAS } from '../scripts/indexado/cargar-hechos';
import {
  armaGeneroVeteranos, atributosDeCodigo, esEventoEfc, fasesQueFaltan, fechaDePrueba, fusionarFases, grupoEdad, gruposSolapados,
  nombresCompatibles, ordenFase, repartirPoulesMixtas, solapeNombres, unirDosFases,
} from '../scripts/indexado/lote7-engarde-rfee';
import {
  armaDeFila, categoriaEfc, claveEvento, clavePrueba, decodificarXml, fechaEfc, partesTorneoEfc, pruebaEquiposXml, pruebaIndividualXml,
} from '../scripts/indexado/lote7-efc';
import { FUENTES_NOMBRE, FUENTES_SOLO_EN_PRUEBA } from '../scripts/indexado/unificar-personas';
import { nombreTorneo, portadaEstatica } from '../scripts/indexado/lote7-engarde-rfee-estaticas';

const hechos = (o: { key: string; gender?: 'M' | 'F' | 'MIXTO'; results: [string, number | null][]; bouts?: [string, string, 'POULE' | 'TABLEAU', string][] }): HechosPrueba => ({
  version: 1, source: 'engarde', extractor: 'lector_engarde', sourceUrl: `https://engarde-service.com/competition/rfee/x/${o.key}`,
  sourceSha256: '0'.repeat(64),
  edition: { season: '2024-2025', tournamentKey: 'engarde:rfee/x', name: 'X', startDate: '2025-01-01', endDate: '2025-01-01', city: null, countryCode: null },
  competition: { competitionKey: `engarde:rfee/x/${o.key}`, weapon: 'ESPADA', gender: o.gender ?? 'M', category: 'ABS', categoryRaw: null, format: 'INDIVIDUAL', date: '2025-01-01' },
  status: { results: 'completo', pools: o.bouts?.some((b) => b[2] === 'POULE') ? 'completo' : 'sin_resultados', tableau: o.bouts?.some((b) => b[2] === 'TABLEAU') ? 'completo' : 'sin_resultados', publishedParticipants: null, notes: [] },
  results: o.results.map(([name, position]) => ({
    factKey: `${o.key}:${name}`, name, countryCode: null, club: null, position, positionRaw: null, points: null, fieId: null, license: null, birthYear: null,
  })),
  bouts: (o.bouts ?? []).map(([a, b, phase, roundKey]) => ({
    phase, roundKey, aRef: `${o.key}:${a}`, bRef: `${o.key}:${b}`, aName: a, bName: b, scoreA: 5, scoreB: 3, winner: null,
  })),
});

describe('auditoría Engarde rfee', () => {
  it('distingue grupos de edad de fases de una prueba', () => {
    expect(grupoEdad('FLORETE MIXTO 2014-2015', 'M13')).toBe('N2014-2015');
    expect(grupoEdad('Tablón Sable Femenino 2012-13', 'M13')).toBe('N2012-2013');
    expect(grupoEdad('ESPADA FEM  50 60', 'VET')).toBe('V50-60');
    expect(grupoEdad('ef30_40', 'VET')).toBe('V30-40');
    expect(grupoEdad('Espada Femenina Grupo A', 'VET')).toBe('GA');
    expect(grupoEdad('ESPADA MAS IND 1ª FASE', 'ABS')).toBeNull();
    expect(gruposSolapados('V60', 'V50-60')).toBe(true);
    expect(gruposSolapados('V40', 'V50')).toBe(false);
    expect(gruposSolapados('N2012', 'N2012')).toBe(false);
  });

  it('deduce los atributos de las pruebas antiguas del código y del torneo', () => {
    expect(atributosDeCodigo('ff17i', 'Campeonato de España Cadete 2017')).toEqual({ weapon: 'FLORETE', gender: 'F', category: 'M17', individual: true });
    expect(atributosDeCodigo('efe', 'Campeonato de España M-14 2017')).toEqual({ weapon: 'ESPADA', gender: 'F', category: 'M14', individual: false });
    expect(atributosDeCodigo('sm_eq', 'Campeonato de España Junior 2015')).toMatchObject({ weapon: 'SABLE', gender: 'M', individual: false, category: 'M20' });
    expect(atributosDeCodigo('ff_cadet', 'Campeonato Mediterraneo 2015')).toBeNull();
    expect(armaGeneroVeteranos('CAMPEONATO DE ESPAÑA VETERANOS SF40', 'sfv_40')).toEqual({ weapon: 'SABLE', gender: 'F' });
    expect(armaGeneroVeteranos('', 'emv_60')).toEqual({ weapon: 'ESPADA', gender: 'M' });
  });

  it('usa la fecha del índice, de la página o de la lista, nunca la de relleno', () => {
    expect(fechaDePrueba('2024-03-02', null, '2012-01-01')).toBe('2024-03-02');
    expect(fechaDePrueba('2012-01-01', null, '2015-02-14')).toBe('2015-02-14');
    expect(fechaDePrueba(null, null, '2012-01-01')).toBeNull();
  });

  it('reconoce eventos EFC y fases', () => {
    expect(esEventoEfc('EFC Cadet Circuit Segovia 2026', 'efc_segovia26')).toBe(true);
    expect(esEventoEfc('TNR Florete Absoluto', 'tnr_flo')).toBe(false);
    expect(ordenFase('ESPADA MAS IND 1ª FASE')).toBe(1);
    expect(ordenFase('ESPADA MAS 1FASE')).toBe(1);
    expect(ordenFase('ESPADA MAS ABS IND FASE FINAL')).toBe(2);
    expect(ordenFase('ESPADA MAS INDIVIDUAL 2ª FASE')).toBe(2);
    expect(ordenFase('ESPADA MASCULINA')).toBeNull();
  });

  it('compara fases y nombres', () => {
    expect(fasesQueFaltan({ resultados: 50, poules: 150, cuadro: 49 }, { resultados: 50, poules: 0, cuadro: 49 })).toEqual(['poules']);
    expect(fasesQueFaltan({ resultados: 50, poules: 150, cuadro: 49 }, { resultados: 49, poules: 148, cuadro: 47 })).toEqual([]);
    expect(fasesQueFaltan({ resultados: 75, poules: 0, cuadro: 0 }, { resultados: 67, poules: 0, cuadro: 0 })).toEqual(['resultados']);
    expect(nombresCompatibles('alejandro larena ramirez', 'larena ramirez')).toBe(true);
    expect(nombresCompatibles('ana garcia', 'luis garcia')).toBe(false);
    expect(solapeNombres(['a b', 'c d', 'e f', 'g h'], ['a b', 'c d', 'x y', 'z w', 'q r'])).toBe(0.5);
    expect(solapeNombres(['a b'], ['a b'])).toBeNull();
  });

  it('une poules y cuadro publicados como pruebas separadas', () => {
    const poules = hechos({ key: 'p', results: [['ANA', 1], ['EVA', 2], ['LUZ', 3]], bouts: [['ANA', 'EVA', 'POULE', 'P1'], ['EVA', 'LUZ', 'POULE', 'P1']] });
    const tablon = hechos({ key: 't', results: [['ANA', 1], ['EVA', 2]], bouts: [['ANA', 'EVA', 'TABLEAU', 'T2']] });
    const h = fusionarFases([poules, tablon])!;
    expect(h.competition.competitionKey).toBe('engarde:rfee/x/p');
    expect(h.bouts.map((b) => [b.phase, b.aRef, b.bRef])).toEqual([
      ['POULE', 'p:ANA', 'p:EVA'], ['POULE', 'p:EVA', 'p:LUZ'], ['TABLEAU', 'p:ANA', 'p:EVA'],
    ]);
    expect(() => hechosPrueba.parse(h)).not.toThrow();
  });

  it('reparte poules mixtas entre los tablones de cada género', () => {
    const mixta = hechos({ key: 'm', gender: 'MIXTO', results: [['ANA', 1], ['LUIS', 2], ['EVA', 3]], bouts: [['ANA', 'LUIS', 'POULE', 'P1'], ['ANA', 'EVA', 'POULE', 'P1']] });
    const fem = hechos({ key: 'f', gender: 'F', results: [['ANA', 1], ['EVA', 2]], bouts: [['ANA', 'EVA', 'TABLEAU', 'T2']] });
    const [h] = repartirPoulesMixtas(mixta, [fem]);
    expect(h.bouts.filter((b) => b.phase === 'POULE').map((b) => [b.aRef, b.bRef])).toEqual([['f:ANA', 'f:EVA']]);
    expect(h.status.pools).toBe('parcial');
  });

  it('une una prueba en dos fases con la segunda vuelta de poules', () => {
    const f1 = hechos({ key: 'f1', results: [['ANA', 1], ['EVA', 2], ['LUZ', 3]], bouts: [['ANA', 'LUZ', 'POULE', 'P1']] });
    const f2 = hechos({ key: 'f2', results: [['ANA', 1], ['EVA', 2]], bouts: [['ANA', 'EVA', 'POULE', 'P1'], ['ANA', 'EVA', 'TABLEAU', 'T2']] });
    const h = unirDosFases(f1, f2)!;
    expect(h.results.map((r) => r.name)).toEqual(['ANA', 'EVA', 'LUZ']);
    expect(h.bouts.map((b) => `${b.phase}:${b.roundKey}`).sort()).toEqual(['POULE:P1', 'POULE:V2P1', 'TABLEAU:T2']);
    expect(() => hechosPrueba.parse(h)).not.toThrow();
  });
});

describe('exportaciones estáticas rfee', () => {
  it('lee la portada y nombra el torneo aunque el título sea «undefined»', () => {
    const html = `<html><head><title>undefined</title></head><body><div id="title">TNR M-20 Florete MADRID 15 MARZO 2014</div>
      <div id="liens"><ul><li><a href="fm20ind"><img src="x.png"/>Florete Masculino Individual</a></li><li><a href="ffm20eq">Florete Femenino Equipos</a></li></ul></div></body></html>`;
    expect(portadaEstatica(html)).toEqual({
      titulo: 'TNR M-20 Florete MADRID 15 MARZO 2014',
      pruebas: [{ compe: 'fm20ind', nombre: 'Florete Masculino Individual' }, { compe: 'ffm20eq', nombre: 'Florete Femenino Equipos' }],
    });
    expect(nombreTorneo('undefined', ['Campeonato de España M-15 Florete Masculino Individual', 'Campeonato de España M-15 Sable Femenino Equipos'], '2014-06-07'))
      .toBe('Campeonato de España M-15 2014');
    expect(nombreTorneo('TNR Madrid 2014', [], '2014-03-15')).toBe('TNR Madrid 2014');
  });
});

const XML_IND = `<?xml version="1.0" encoding="iso-8859-1" ?>
<CompetitionIndividuelle Championnat="EFC" Arme="S" Sexe="F" Categorie="C" Date="14.10.2023" TitreLong="Cadet Circuit Budapest Women's Sabre">
  <Tireurs>
    <Tireur ID="1" Nom="GARCÍA" Prenom="Ana" Nation="ESP" Club="CE MADRID" Licence="00850001" DateNaissance="01.02.2008" Classement="1" Statut="N" />
    <Tireur ID="2" Nom="ROSSI" Prenom="Bea" Nation="ITA" Licence="00850002" Classement="2" Statut="N" />
    <Tireur ID="3" Nom="KOVACS" Prenom="Cili" Nation="HUN" Licence="00850003" Classement="3" Statut="N" />
    <Tireur ID="4" Nom="MEIER" Prenom="Dora" Nation="GER" Classement="3" Statut="N" />
  </Tireurs>
  <Phases>
    <TourDePoules ID="1">
      <Poule ID="1">
        <Tireur REF="1" NbVictoires="2" TD="10" TR="5" />
        <Tireur REF="2" NbVictoires="1" TD="8" TR="9" />
        <Tireur REF="3" NbVictoires="0" TD="6" TR="10" />
        <Match ID="1"><Tireur REF="1" Score="5" Statut="V" /><Tireur REF="2" Score="3" Statut="D" /></Match>
        <Match ID="2"><Tireur REF="1" Score="5" Statut="V" /><Tireur REF="3" Score="2" Statut="D" /></Match>
        <Match ID="3"><Tireur REF="2" Score="5" Statut="V" /><Tireur REF="3" Score="4" Statut="D" /></Match>
      </Poule>
    </TourDePoules>
    <PhaseDeTableaux><SuiteDeTableaux>
      <Tableau Taille="4">
        <Match><Tireur REF="1" Score="15" Statut="V" /><Tireur REF="4" Score="10" Statut="D" /></Match>
        <Match><Tireur REF="2" Score="15" Statut="V" /><Tireur REF="3" Score="12" Statut="D" /></Match>
      </Tableau>
      <Tableau Taille="2">
        <Match><Tireur REF="1" Score="15" Statut="V" /><Tireur REF="2" Score="14" Statut="D" /></Match>
      </Tableau>
    </SuiteDeTableaux></PhaseDeTableaux>
  </Phases>
</CompetitionIndividuelle>`;

const XML_EQ = `<?xml version="1.0" encoding="iso-8859-1" ?>
<CompetitionParEquipes Championnat="EFC" Arme="E" Sexe="M" Categorie="C" Date="15.10.2023" TitreLong="Cadet Circuit Men's Epee Team">
  <Equipes>
    <Equipe ID="1" Nation="ESP" Classement="1" Statut="N" />
    <Equipe ID="2" Nation="ITA" Classement="2" Statut="N" />
    <Equipe ID="3" Nation="ITA" Classement="3" Statut="N" />
  </Equipes>
  <Phases><PhaseDeTableaux><SuiteDeTableaux>
    <Tableau Taille="2"><Match><Equipe REF="1" Score="45" Statut="V" /><Equipe REF="2" Score="40" Statut="D" /></Match></Tableau>
  </SuiteDeTableaux></PhaseDeTableaux></Phases>
</CompetitionParEquipes>`;

describe('circuito EFC', () => {
  it('formato, cargador y unificación aceptan la fuente efc', () => {
    const h = hechos({ key: 'e', results: [['ANA', 1]] });
    expect(() => hechosPrueba.parse({ ...h, source: 'efc', extractor: 'lector_efc_xml' })).not.toThrow();
    expect(CLAVES_FIJAS.has('efc')).toBe(true);
    expect(FUENTES_NOMBRE).toContain('efc');
    expect(FUENTES_SOLO_EN_PRUEBA.has('efc')).toBe(true);
  });

  it('construye las claves de evento y prueba', () => {
    expect(claveEvento('Budapest', '2023-10-14')).toBe('budapest-20231014');
    expect(claveEvento('Göteborg', '2026-10-31')).toBe('goteborg-20261031');
    expect(claveEvento('København', '2021-12-04')).toBe('kobenhavn-20211204');
    expect([armaDeFila('Epee'), armaDeFila('Foil'), armaDeFila('Sabre'), armaDeFila('?')]).toEqual(['ESPADA', 'FLORETE', 'SABLE', null]);
    expect(clavePrueba('2023-2024', 'budapest-20231014', { weapon: 'ESPADA', gender: 'M', category: 'M17', format: 'INDIVIDUAL' }))
      .toBe('efc:2023-2024:budapest-20231014:EM-M17');
    expect(clavePrueba('2023-2024', 'budapest-20231014', { weapon: 'SABLE', gender: 'F', category: 'M17', format: 'EQUIPOS' }))
      .toBe('efc:2023-2024:budapest-20231014:SF-M17-EQ');
    expect(categoriaEfc('C', '')).toBe('M17');
    expect(categoriaEfc('', 'European U23 Circuit')).toBe('M23');
    expect(fechaEfc('02/06 - 05/06/2011')).toBe('2011-06-05');
    expect(partesTorneoEfc('Competitions - European Cadet Circuit - Hungary - Budapest')).toEqual({ nombre: 'European Cadet Circuit Budapest', sede: 'Budapest' });
  });

  it('lee clasificación, poules y cuadro del XML individual de la EFC', () => {
    const xml = decodificarXml(Buffer.from(XML_IND, 'latin1'));
    const p = pruebaIndividualXml(xml)!;
    expect(p.atributos).toMatchObject({ weapon: 'SABLE', gender: 'F', category: 'M17', format: 'INDIVIDUAL', fecha: '2023-10-14' });
    expect(p.results[0]).toMatchObject({ factKey: 'efc:lic:00850001', name: 'GARCÍA Ana', countryCode: 'ESP', position: 1, birthYear: 2008, license: null, fieId: null });
    expect(p.results[3].factKey).toBe('efc:GER:dora-meier');
    expect(p.bouts.filter((b) => b.phase === 'POULE')).toHaveLength(3);
    expect(p.bouts.filter((b) => b.phase === 'TABLEAU').map((b) => b.roundKey).sort()).toEqual(['T2', 'T4', 'T4']);
    expect(p.status).toMatchObject({ results: 'completo', pools: 'completo', tableau: 'completo' });
  });

  it('lee clasificación y encuentros del XML por equipos', () => {
    const p = pruebaEquiposXml(XML_EQ)!;
    expect(p.atributos.format).toBe('EQUIPOS');
    expect(p.results.map((r) => [r.factKey, r.name])).toEqual([['team:efc:ESP', 'ESP'], ['team:efc:ITA-1', 'ITA 1'], ['team:efc:ITA-2', 'ITA 2']]);
    expect(p.bouts).toEqual([expect.objectContaining({ phase: 'TABLEAU', roundKey: 'T2', aRef: 'team:efc:ESP', bRef: 'team:efc:ITA-1', scoreA: 45, scoreB: 40 })]);
  });
});
