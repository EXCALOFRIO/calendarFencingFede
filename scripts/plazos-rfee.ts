/**
 * Carga la escalera de plazos NACIONALES tal y como la escribe la RFEE.
 *
 *   npx tsx scripts/plazos-rfee.ts
 *
 * QUÉ SIGNIFICA `surchargeEur`, QUE ES LA PARTE QUE ENGAÑA
 * -------------------------------------------------------
 * El importe de una fila es **lo que cuesta inscribirse una vez que ESE hito ha
 * vencido**, no lo que cuesta llegar a él. Lo fija `deadlineStatus()`, que toma
 * como recargo vigente el del último hito ya pasado. Así, «cierre ordinario, 5 €»
 * se lee: *pasado el viernes a las 12:00, agregarte cuesta 5 €*.
 *
 * Importa decirlo porque invita a equivocarse en la dirección caras: al leer
 * «Límite 1: 5 €» en el PDF, la tentación es poner los 5 € en la fila del
 * límite 1, y entonces la aplicación diría que el fin de semana anterior es
 * gratis cuando ya cuesta 5 €. Los importes de esta tabla van **desplazados un
 * peldaño hacia arriba** respecto a cómo los enumera la circular, a propósito.
 *
 * POR QUÉ EXISTE
 * --------------
 * Los importes que había puestos eran correctos. Las FECHAS no. Se comprobó
 * simulando la escalera de un TNR del sábado 3 de octubre de 2026:
 *
 *              lo que decía la app       lo que dice la normativa
 *   ordinario  sáb 26/09 a las 01:59     vie 25/09 a las 12:00
 *   límite 1   mar 29/09 a las 01:59     lun 28/09 a las 23:59
 *   límite 2   mié 30/09 a las 01:59     mar 29/09 a las 23:59
 *
 * Tres fallos a la vez: los hitos caían **a las dos de la madrugada** porque se
 * calculaban a las 23:59 UTC y España está en +01:00/+02:00; el ordinario caía
 * en **sábado** en lugar de viernes; y con un contador de días eso solo salía
 * aproximado para las competiciones de sábado —de 28 nacionales, 9 empiezan en
 * domingo y 2 en martes, y en esas once el día era otro—.
 *
 * Faltaban además los importes de equipos: la RFEE cobra 25 € y 50 € donde a un
 * tirador le cobra 5 € y 30 €.
 *
 * DE DÓNDE SALE CADA NÚMERO
 * -------------------------
 *   Circular 12-26, punto 5
 *     «el plazo de inscripción finaliza el viernes de la semana anterior a la
 *      competición a las 12:00 h»
 *
 *   Normativa para Rankings Nacionales 26-27, punto 3.3.2
 *     «Límite 1: Hasta el lunes anterior a las 23:59 […] INDIVIDUALES 5 € por
 *      tirador/a · EQUIPOS 25 € por equipo»
 *     «Límite 2: hasta el martes anterior a la competición a las 23:59 […]
 *      INDIVIDUALES 30 € por tirador/a · EQUIPOS 50 € por equipo»
 *
 * Y el cierre: «No se permitirá inscripción el día de la competición», con el
 * límite 2 como último escalón. Por eso el límite 2 es un cierre duro y no
 * lleva importe: pasado el martes no hay ninguna cantidad que puedas pagar.
 *
 * Los plazos van anclados al día de la semana, no a un número de días: ver el
 * comentario de `deadline_rule.weekday` en `src/db/schema/rules.ts`.
 */

import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db } from '../src/db';
import { deadlineRule, season } from '../src/db/schema';

const CIRCULAR_12_26 = {
  sourceDocument: 'Circular 12-26 (punto 5)',
  sourceUrl:
    'https://esgrima.es/wp-content/uploads/2026/09/CIRCULAR_12-26_GESTION_ADMINISTRATIVA_26-27.pdf',
};

const NORMATIVA_RANKINGS = {
  sourceDocument: 'Normativa de Rankings 26-27 (punto 3.3.2)',
  sourceUrl:
    'https://esgrima.es/wp-content/uploads/2026/09/NORMATIVA-PARA-RANKINGS-NACIONALES_26-27_V1.pdf',
};

/** Lunes = 1 … domingo = 7, como la norma ISO. */
const VIERNES = 5;
const LUNES = 1;
const MARTES = 2;

type Regla = typeof deadlineRule.$inferInsert;

function reglas(seasonId: string): Regla[] {
  const comun = { seasonId, scope: 'NACIONAL' as const, active: true };

  return [
    // Viernes de la semana anterior, 12:00. Pasado esto, agregarse cuesta la
    // multa del «Límite 1»: 5 € un tirador, 25 € un equipo.
    {
      ...comun,
      ...CIRCULAR_12_26,
      type: 'L1',
      label: 'Cierre ordinario',
      format: 'INDIVIDUAL',
      weekday: VIERNES,
      weeksBefore: 1,
      timeOfDay: '12:00',
      // Solo se usaría si alguien borrase el anclaje semanal. Equivale al
      // viernes de la semana anterior a una competición de sábado.
      daysBefore: 8,
      surchargeEur: '5.00',
      blocking: false,
      effectiveFrom: new Date('2026-09-02T00:00:00Z'),
    },
    {
      ...comun,
      ...CIRCULAR_12_26,
      type: 'L1',
      label: 'Cierre ordinario',
      format: 'EQUIPOS',
      weekday: VIERNES,
      weeksBefore: 1,
      timeOfDay: '12:00',
      daysBefore: 8,
      surchargeEur: '25.00',
      blocking: false,
      effectiveFrom: new Date('2026-09-02T00:00:00Z'),
    },
    // Lunes 23:59. Pasado esto sube a la multa del «Límite 2»: 30 € y 50 €.
    {
      ...comun,
      ...NORMATIVA_RANKINGS,
      type: 'L2',
      label: 'Límite 1 para agregarse',
      format: 'INDIVIDUAL',
      weekday: LUNES,
      weeksBefore: 0,
      timeOfDay: '23:59',
      daysBefore: 5,
      surchargeEur: '30.00',
      blocking: false,
      effectiveFrom: new Date('2026-09-04T00:00:00Z'),
    },
    {
      ...comun,
      ...NORMATIVA_RANKINGS,
      type: 'L2',
      label: 'Límite 1 para agregarse',
      format: 'EQUIPOS',
      weekday: LUNES,
      weeksBefore: 0,
      timeOfDay: '23:59',
      daysBefore: 5,
      surchargeEur: '50.00',
      blocking: false,
      effectiveFrom: new Date('2026-09-04T00:00:00Z'),
    },
    // Martes 23:59: último. No lleva importe porque pasado el martes no hay
    // ninguna cantidad que puedas pagar para entrar.
    {
      ...comun,
      ...NORMATIVA_RANKINGS,
      type: 'L3',
      label: 'Límite 2: cierre definitivo',
      format: null,
      weekday: MARTES,
      weeksBefore: 0,
      timeOfDay: '23:59',
      daysBefore: 4,
      surchargeEur: null,
      blocking: true,
      effectiveFrom: new Date('2026-09-04T00:00:00Z'),
    },
  ];
}

const [temporada] = await db
  .select({ id: season.id, label: season.label })
  .from(season)
  .where(eq(season.current, true))
  .limit(1);

if (!temporada) {
  console.error('No hay temporada marcada como actual.');
  process.exit(1);
}

console.log(`Temporada ${temporada.label}.\n`);

/**
 * Se borran las reglas nacionales anteriores en vez de editarlas: la escalera
 * ha cambiado de forma —donde había tres filas ahora hay cinco, porque los
 * importes de equipos son distintos— y emparejarlas una a una sería más frágil
 * que rehacerlas. Las internacionales no se tocan: la FIE sí cuenta días.
 */
const borradas = await db
  .delete(deadlineRule)
  .where(
    and(
      eq(deadlineRule.seasonId, temporada.id),
      eq(deadlineRule.scope, 'NACIONAL'),
    ),
  )
  .returning({ id: deadlineRule.id });

console.log(`Reglas nacionales anteriores retiradas: ${borradas.length}`);

const puestas = await db
  .insert(deadlineRule)
  .values(reglas(temporada.id))
  .returning({ id: deadlineRule.id, label: deadlineRule.label });

console.log(`Reglas nacionales cargadas: ${puestas.length}\n`);

const DIA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

for (const r of reglas(temporada.id)) {
  const semana = r.weeksBefore === 1 ? ' de la semana anterior' : '';
  const importe = r.surchargeEur ? `luego ${r.surchargeEur} €` : 'sin importe';
  console.log(
    `  ${r.type}  ${(r.label ?? '').padEnd(34)} ${(r.format ?? 'ambos').padEnd(11)}` +
      ` ${DIA[r.weekday ?? 0]}${semana} a las ${r.timeOfDay}` +
      `  ${importe}${r.blocking ? ' · cierra' : ''}`,
  );
}
