/**
 * Mete en `ranking_rule` la fórmula de puntos y el arrastre de la temporada
 * anterior de la «NORMATIVA PARA RANKINGS NACIONALES_26-27_V1».
 *
 *   npx tsx scripts/normativa-ranking-rfee.ts            (enseña qué cambiaría)
 *   npx tsx scripts/normativa-ranking-rfee.ts --escribir (lo escribe)
 *
 * POR QUÉ UN SCRIPT Y NO UNA MIGRACIÓN
 * ------------------------------------
 * Son DATOS de normativa, no estructura. Si fueran una migración, el día que la
 * RFEE publique la V2 habría que escribir otra migración para cambiar un
 * número, y el panel de `/admin/normativa` —que existe justo para eso— dejaría
 * de ser la fuente de la verdad. Así el admin puede editarlos después sin que
 * este script se los vuelva a pisar.
 *
 * QUÉ NO SE METE, Y ES A PROPÓSITO
 * --------------------------------
 * Los costes. El usuario fue explícito: «lo del coste de las competis no hace
 * falta que lo pongas». Así que la cuota de arbitraje de 25 € (punto 3.4.1), la
 * cuota de participación de 15 € (3.1), las multas por inscripción fuera de
 * plazo (3.3.2), las de anulación (3.3.3) y la de no presentarse (3.4) están en
 * el PDF y NO entran aquí. Los recargos por plazo ya estaban hechos en
 * `deadline_rule` y este script no los toca.
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db } from '../src/db';
import { rankingRule, season } from '../src/db/schema';

const ESCRIBIR = process.argv.includes('--escribir');

/** De dónde sale cada número. Sin esto, un valor no se puede defender. */
const DOCUMENTO = 'NORMATIVA PARA RANKINGS NACIONALES_26-27_V1';
const URL =
  'https://esgrima.es/wp-content/uploads/2026/09/NORMATIVA-PARA-RANKINGS-NACIONALES_26-27_V1.pdf';

/**
 * Los parámetros de la fórmula del punto 1.4.1, los mismos para todas las
 * categorías: el documento da UNA fórmula y luego le aplica coeficientes.
 *
 * El 1000 y el 1,01 son los dos números que no cabían en `points_table` ni en
 * `coefficients`, y por los que se amplió `ranking_rule` con `points_formula`.
 */
const FORMULA = { tipo: 'rfee_log10', escala: 1000, techo: 1.01 } as const;

/**
 * Arrastre de la temporada anterior, en tanto por uno.
 *
 * Cadete, júnior y sénior salen del cuadro del punto 1.1. El 0 % de sub-23 sale
 * de SU tabla del punto 1.3, porque el cuadro del 1.1 no lo trae. M13 y M15 no
 * tienen fila de arrastre en ninguna parte del documento, y por eso van a
 * `null` y no a 0: «la normativa no lo dice» no es «la normativa dice cero».
 */
const ARRASTRE: Record<string, string | null> = {
  M13: null,
  M15: null,
  M17: '0.1000',
  M20: '0.1500',
  M23: '0.0000',
  ABS: '0.2000',
};

/**
 * Coeficientes del punto 1.2 y de las tablas del 1.3, con la clave
 * `CIRCUITO:CATEGORÍA` cuando la categoría de la prueba importa.
 *
 * Ver `coeficienteDePrueba` en `src/lib/ranking/formula.ts`: para el ranking
 * cadete un TNR cadete vale 1 y un TNR júnior vale 1,25, y los dos son circuito
 * `TNR`. Sin la categoría en la clave, los dos cobrarían lo mismo.
 */
const COEFICIENTES: Record<string, Record<string, number>> = {
  // «RESULTADOS DE LAS 2 COMPETICIONES M13» 1 · «CAMPEONATO DE ESPAÑA M13» 1,25
  M13: { 'TNR:M13': 1, 'CTO_ESPANA:M13': 1.25 },
  M15: { 'TNR:M15': 1, 'CTO_ESPANA:M15': 1.25 },
  // Cadete: 2 TNR cadete (1) y 2 TNR júnior (1,25); Cto España cadete 1,25 y
  // júnior 1,50.
  M17: {
    'TNR:M17': 1,
    'TNR:M20': 1.25,
    'CTO_ESPANA:M17': 1.25,
    'CTO_ESPANA:M20': 1.5,
  },
  // Júnior: 2 TNR júnior (1) y 3 TNR sénior (1,25); Cto España júnior 1,25,
  // sub-23 1,25 y sénior 1,50.
  M20: {
    'TNR:M20': 1,
    'TNR:ABS': 1.25,
    'CTO_ESPANA:M20': 1.25,
    'CTO_ESPANA:M23': 1.25,
    'CTO_ESPANA:ABS': 1.5,
  },
  // Sub-23: 2 mejores de los 3 TNR sénior (1); Cto España sub-23 1,25 y
  // sénior 1,50.
  M23: { 'TNR:ABS': 1, 'CTO_ESPANA:M23': 1.25, 'CTO_ESPANA:ABS': 1.5 },
  // Sénior: 2 mejores de los 3 TNR sénior (1); Cto España sénior 1,25.
  ABS: { 'TNR:ABS': 1, 'CTO_ESPANA:ABS': 1.25 },
};

const [actual] = await db
  .select({ id: season.id, label: season.label })
  .from(season)
  .where(eq(season.current, true))
  .limit(1);

if (!actual) {
  console.error('No hay ninguna temporada marcada como actual. No hay dónde escribir.');
  process.exit(1);
}

const existentes = await db
  .select({
    id: rankingRule.id,
    category: rankingRule.category,
    coefficients: rankingRule.coefficients,
    pointsFormula: rankingRule.pointsFormula,
    previousSeasonCarry: rankingRule.previousSeasonCarry,
  })
  .from(rankingRule)
  .where(eq(rankingRule.seasonId, actual.id));

console.log(`Temporada ${actual.label}: ${existentes.length} reglas de ranking.`);
console.log('');

let cambios = 0;

for (const regla of existentes) {
  const cat = regla.category;
  if (!cat || !(cat in ARRASTRE)) {
    console.log(`  ${cat ?? 'sin categoría'}: no está en la normativa 26-27, se deja.`);
    continue;
  }

  const arrastre = ARRASTRE[cat];
  const coefs = COEFICIENTES[cat];

  const yaTieneFormula = regla.pointsFormula !== null;
  const yaTieneArrastre = regla.previousSeasonCarry !== null;
  const coefsActuales = JSON.stringify(regla.coefficients);
  const coefsNuevos = JSON.stringify(coefs);

  const quePasa: string[] = [];
  if (!yaTieneFormula) quePasa.push('fórmula');
  if (!yaTieneArrastre && arrastre !== null) quePasa.push(`arrastre ${arrastre}`);
  if (coefsActuales !== coefsNuevos) quePasa.push('coeficientes por categoría');

  if (quePasa.length === 0) {
    console.log(`  ${cat}: ya está completa.`);
    continue;
  }

  console.log(`  ${cat}: ${quePasa.join(', ')}`);
  console.log(`      coeficientes -> ${coefsNuevos}`);

  if (ESCRIBIR) {
    await db
      .update(rankingRule)
      .set({
        pointsFormula: FORMULA,
        previousSeasonCarry: arrastre,
        coefficients: coefs,
        sourceDocument: DOCUMENTO,
        sourceUrl: URL,
        updatedAt: new Date(),
      })
      .where(and(eq(rankingRule.id, regla.id), eq(rankingRule.seasonId, actual.id)));
    cambios += 1;
  }
}

console.log('');
if (ESCRIBIR) {
  console.log(`Escritas ${cambios} reglas, con procedencia «${DOCUMENTO}».`);
} else {
  console.log('Nada escrito. Vuelve a lanzarlo con --escribir para aplicarlo.');
}
