import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { pruebaEncaja } from '../src/lib/queries/calendar';
import type { CompetitionView } from '../src/lib/queries/calendar';

/**
 * A QUÉ PRUEBA VA CADA HORARIO LEÍDO DE UN PDF
 * ===========================================================================
 *
 * El extractor nombra cada horario con el texto que encontró en el documento,
 * y eso llega tal cual:
 *
 *   Skermo (español)   installation_open.2026-10-03.individual
 *   FIE (inglés)       installation_open.2026-10-15.men-s-foil
 *   FIE (francés)      pools_start.2026-11-12.fleuret-dames
 *
 * `pruebaEncaja` decide si ese texto nombra ESTA prueba del torneo. Se probó
 * solo con el español y el resultado fue que los horarios de la FIE no se
 * atribuían a nadie: se quedaban a nivel de evento y la ficha del torneo
 * decía «los horarios no están publicados» con los datos ya leídos y con su
 * cita verificada.
 *
 * Las dos mitades de esto importan igual:
 *
 *  - que **encaje** lo que tiene que encajar, o el dato no se ve;
 *  - que **no encaje** lo que no, porque un horario colgado de la prueba
 *    equivocada no se detecta mirando la pantalla: se detecta llegando al
 *    pabellón el día que no toca. De ahí que la regla sea «si el texto no
 *    dice ni el arma ni la categoría, no se atribuye a nadie».
 */
function prueba(p: Partial<CompetitionView>): CompetitionView {
  return {
    id: 'p1',
    weapon: 'FLORETE',
    gender: 'M',
    category: 'ABS',
    categoryRaw: 'S',
    format: 'INDIVIDUAL',
    competitionDate: '2026-10-15',
    installationOpen: null,
    callTime: null,
    scratchTime: null,
    startTime: null,
    registrationCount: null,
    feeEur: null,
    sourceUrl: null,
    deadlines: [],
    status: 'ABIERTO',
    datosExtraidos: [],
    ...p,
  } as CompetitionView;
}

const floreteMasculinoAbs = prueba({});
const floreteFemeninoAbs = prueba({ gender: 'F' });
const floreteMasculinoEquipos = prueba({ format: 'EQUIPOS' });
const sableMasculinoAbs = prueba({ weapon: 'SABLE' });
const espadaFemeninoM17 = prueba({ weapon: 'ESPADA', gender: 'F', category: 'M17' });

describe('los horarios de la FIE, que vienen en inglés', () => {
  it('«men-s-foil» es el florete masculino, no el femenino', () => {
    expect(pruebaEncaja('men-s-foil', floreteMasculinoAbs)).toBe(true);
    expect(pruebaEncaja('men-s-foil', floreteFemeninoAbs)).toBe(false);
  });

  it('«women-s-foil» es el femenino: «men» dentro de «women» no cuenta', () => {
    expect(pruebaEncaja('women-s-foil', floreteFemeninoAbs)).toBe(true);
    expect(pruebaEncaja('women-s-foil', floreteMasculinoAbs)).toBe(false);
  });

  it('reconoce las tres armas en inglés', () => {
    expect(pruebaEncaja('men-s-sabre', sableMasculinoAbs)).toBe(true);
    expect(pruebaEncaja('men-s-sabre', floreteMasculinoAbs)).toBe(false);
    expect(pruebaEncaja('women-s-epee-cadet', espadaFemeninoM17)).toBe(true);
    expect(pruebaEncaja('women-s-epee-cadet', floreteFemeninoAbs)).toBe(false);
  });

  it('«team» solo va a una prueba por equipos', () => {
    expect(pruebaEncaja('men-s-foil-team', floreteMasculinoEquipos)).toBe(true);
    expect(pruebaEncaja('men-s-foil-team', floreteMasculinoAbs)).toBe(false);
  });

  it('«team-event» a secas no se atribuye a nadie', () => {
    // No dice arma ni categoría, y un torneo puede tener la de equipos
    // masculina y la femenina: atribuirlo sería adivinar.
    expect(pruebaEncaja('team-event', floreteMasculinoEquipos)).toBe(false);
  });

  it('las categorías en inglés', () => {
    expect(pruebaEncaja('cadet', espadaFemeninoM17)).toBe(true);
    expect(pruebaEncaja('cadet', floreteMasculinoAbs)).toBe(false);
    expect(pruebaEncaja('senior-men-s-foil', floreteMasculinoAbs)).toBe(true);
    expect(pruebaEncaja('junior-men-s-foil', floreteMasculinoAbs)).toBe(false);
  });
});

describe('los horarios en francés, que la FIE también publica', () => {
  it('«fleuret dames» es el florete femenino', () => {
    expect(pruebaEncaja('fleuret dames', floreteFemeninoAbs)).toBe(true);
    expect(pruebaEncaja('fleuret dames', floreteMasculinoAbs)).toBe(false);
  });

  it('«épée» con acento y sin él', () => {
    expect(pruebaEncaja('epee dames cadet', espadaFemeninoM17)).toBe(true);
    expect(pruebaEncaja('épée dames cadet', espadaFemeninoM17)).toBe(true);
  });

  it('«par équipes» es por equipos', () => {
    expect(pruebaEncaja('fleuret hommes par equipes', floreteMasculinoEquipos)).toBe(
      true,
    );
    expect(pruebaEncaja('fleuret hommes par equipes', floreteMasculinoAbs)).toBe(false);
  });
});

describe('el español sigue funcionando igual', () => {
  it('lo que ya encajaba', () => {
    expect(pruebaEncaja('florete masculino absoluto', floreteMasculinoAbs)).toBe(true);
    expect(pruebaEncaja('florete femenino', floreteFemeninoAbs)).toBe(true);
    expect(pruebaEncaja('florete masculino equipos', floreteMasculinoEquipos)).toBe(
      true,
    );
    expect(pruebaEncaja('espada femenina cadete', espadaFemeninoM17)).toBe(true);
  });

  it('un horario sin arma ni categoría no se atribuye', () => {
    expect(pruebaEncaja('individual', floreteMasculinoAbs)).toBe(false);
    expect(pruebaEncaja('comienzo', floreteMasculinoAbs)).toBe(false);
    expect(pruebaEncaja('', floreteMasculinoAbs)).toBe(false);
  });
});
