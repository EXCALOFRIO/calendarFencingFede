import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../src/db';
import { deadlineRule, season, seasonCategory } from '../src/db/schema';

/**
 * Semilla de CONFIGURACIÓN, no de datos de ejemplo.
 *
 * Esto es importante: la aplicación no lleva ni un solo dato de demostración.
 * Nada de tiradores, clubes ni competiciones inventadas. Si una pantalla no
 * tiene datos, se ve vacía con su explicación.
 *
 * Lo que sí hace falta antes de poder usar la app son las tablas de normativa,
 * porque sin temporada no se puede calcular ninguna categoría. Este script
 * crea esa estructura mínima con valores que hay que REVISAR:
 *
 *   - Los años de nacimiento salen de la circular de categorías de la RFEE de
 *     la temporada. Aquí van calculados a partir del año de inicio, que es la
 *     regla habitual, pero hay que contrastarlos con la circular publicada.
 *   - Los plazos y recargos NO se pueden recopilar de ninguna fuente: solo
 *     existen dentro de circulares en PDF. Se dejan a cero y con una nota
 *     visible para que el administrador ponga los importes reales, en vez de
 *     inventarse números que parecerían oficiales.
 *
 * Ejecuta:  npm run db:seed
 */

/** "2026-2027" a partir del año de inicio. */
function seasonLabel(startYear: number): string {
  return `${startYear}-${startYear + 1}`;
}

/**
 * Categorías por año de nacimiento.
 *
 * La regla habitual de la RFEE es que la categoría se cuenta por el año
 * natural en que se cumplen los años, referido al año en que ACABA la
 * temporada. Los rangos de abajo se derivan de ahí. El campo
 * `sourceDocument` queda vacío a propósito: hasta que alguien contraste
 * contra la circular, la app muestra estos valores como configurables y no
 * como oficiales.
 */
function categoriesFor(startYear: number) {
  const end = startYear + 1;

  return [
    { code: 'M13' as const, min: end - 13, max: end - 11, rank: 1, laddered: true },
    { code: 'M14' as const, min: end - 14, max: end - 12, rank: 2, laddered: true },
    { code: 'M15' as const, min: end - 15, max: end - 13, rank: 3, laddered: true },
    { code: 'M17' as const, min: end - 17, max: end - 14, rank: 4, laddered: true },
    { code: 'M20' as const, min: end - 20, max: end - 15, rank: 5, laddered: true },
    { code: 'M23' as const, min: end - 23, max: end - 18, rank: 6, laddered: true },
    { code: 'ABS' as const, min: null, max: end - 13, rank: 7, laddered: true },
    // Veteranos no forma parte de la escalera: se entra por edad y además se
    // puede seguir tirando en Absoluto.
    { code: 'VET' as const, min: null, max: end - 30, rank: 8, laddered: false },
  ];
}

/**
 * Plazos por tipo de prueba.
 *
 * Los `daysBefore` reflejan la práctica habitual y sirven para que el semáforo
 * funcione desde el primer día; los IMPORTES van a cero porque no hay ninguna
 * fuente de la que sacarlos automáticamente. El administrador los pone desde
 * la pantalla de normativa, y ahí queda registrado de qué circular salen.
 */
const DEADLINE_RULES = [
  {
    scope: 'INTERNACIONAL' as const,
    circuit: null,
    type: 'L1' as const,
    label: 'Límite ordinario',
    daysBefore: 28,
    surchargeEur: '0',
    blocking: false,
  },
  {
    scope: 'INTERNACIONAL' as const,
    circuit: null,
    type: 'L2' as const,
    label: 'Segundo plazo',
    daysBefore: 21,
    surchargeEur: null,
    blocking: false,
  },
  {
    scope: 'INTERNACIONAL' as const,
    circuit: null,
    type: 'L3' as const,
    label: 'Tercer plazo',
    daysBefore: 14,
    surchargeEur: null,
    blocking: false,
  },
  {
    scope: 'INTERNACIONAL' as const,
    circuit: null,
    type: 'FIE_D7' as const,
    label: 'Cierre FIE',
    daysBefore: 7,
    surchargeEur: null,
    blocking: true,
  },
  {
    scope: 'NACIONAL' as const,
    circuit: 'TNR',
    type: 'L1' as const,
    label: 'Límite ordinario',
    daysBefore: 10,
    surchargeEur: '0',
    blocking: false,
  },
];

async function main() {
  const now = new Date();
  // La temporada de esgrima va de septiembre a agosto.
  const startYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  const label = seasonLabel(startYear);

  console.log(`Configurando la temporada ${label}...`);

  const [existing] = await db
    .select()
    .from(season)
    .where(eq(season.label, label))
    .limit(1);

  let seasonId: string;

  if (existing) {
    seasonId = existing.id;
    console.log('  La temporada ya existía; no se toca.');
  } else {
    const [created] = await db
      .insert(season)
      .values({
        label,
        startDate: `${startYear}-09-01`,
        endDate: `${startYear + 1}-08-31`,
        current: true,
      })
      .returning({ id: season.id });
    seasonId = created.id;
    console.log('  Temporada creada y marcada como actual.');
  }

  let categoriasNuevas = 0;
  for (const c of categoriesFor(startYear)) {
    const inserted = await db
      .insert(seasonCategory)
      .values({
        seasonId,
        code: c.code,
        birthYearMin: c.min,
        birthYearMax: c.max,
        rank: c.rank,
        laddered: c.laddered,
        // Vacío a propósito: hasta que se contraste con la circular oficial,
        // estos valores son configuración por revisar, no dato oficial.
        sourceDocument: null,
        sourceUrl: null,
      })
      .onConflictDoNothing({ target: [seasonCategory.seasonId, seasonCategory.code] })
      .returning({ id: seasonCategory.id });
    categoriasNuevas += inserted.length;
  }
  console.log(`  ${categoriasNuevas} categorías creadas.`);

  /**
   * Solo se siembran las reglas si la temporada no tiene NINGUNA: si el admin
   * ya las ha tocado, este script no debe pisarle los importes.
   *
   * La comprobación va AQUÍ, una sola vez, y no dentro del bucle. Estaba
   * dentro, y como la primera vuelta ya insertaba una fila, la segunda vuelta
   * encontraba esa fila recién creada y hacía `break`: la temporada se
   * quedaba con UNA regla de las cinco, la internacional de 28 días. El
   * efecto visible era que todas las pruebas internacionales salían con
   * "Plazo cerrado" en el semáforo, porque su único plazo ya había vencido y
   * no había ningún hito posterior.
   */
  const [yaHayReglas] = await db
    .select({ id: deadlineRule.id })
    .from(deadlineRule)
    .where(eq(deadlineRule.seasonId, seasonId))
    .limit(1);

  let reglasNuevas = 0;
  for (const r of yaHayReglas ? [] : DEADLINE_RULES) {
    await db.insert(deadlineRule).values({
      seasonId,
      scope: r.scope,
      circuit: r.circuit as never,
      category: null,
      type: r.type,
      label: r.label,
      daysBefore: r.daysBefore,
      surchargeEur: r.surchargeEur,
      blocking: r.blocking,
      sourceDocument: null,
      sourceUrl: null,
    });
    reglasNuevas += 1;
  }
  console.log(`  ${reglasNuevas} reglas de plazo creadas.`);

  console.log('\nHecho. Ahora, antes de dar acceso a nadie:');
  console.log('  1. Revisa los años de nacimiento contra la circular de');
  console.log('     categorías de la RFEE (pantalla Admin > Normativa).');
  console.log('  2. Pon los importes reales de los recargos, con la circular');
  console.log('     de la que salen. Mientras estén vacíos, la app mostrará');
  console.log('     "no publicado" en vez de un número inventado.');
  console.log('  3. Da de alta los clubes y las personas (Admin > Usuarios).');
  console.log('  4. Lanza la primera carga de datos: npm run ingest');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('La configuración inicial ha fallado:', error);
    process.exit(1);
  });
