import 'dotenv/config';
import { rechazarEscrituraNoCoordinada } from '../src/lib/ingest/cli-obsoleto';
import { conciliarTorneoEngarde } from '../src/lib/ingest/conciliar-torneo-engarde';
import { descubrirEnlacesFie, vistaEnlace } from '../src/lib/ingest/enlaces-resultados';
import { clasificarSerie, ETIQUETA_SERIE } from '../src/lib/ingest/series-complementarias';
import { depsEngardeReales, leerTorneoEngarde } from '../src/lib/ingest/sources/engarde';

/**
 * Fuentes complementarias y enlaces verificados. Sin `--aplicar` sólo hace GET
 * públicos (y el POST público del índice de Engarde) e imprime recuentos, sin
 * nombres de participantes ni escrituras. Sin `--aplicar` tampoco se consulta
 * la base: los planes de `engarde` salen como `sin_canonica`.
 *
 *   npm run complementarios -- engarde <organizador> <torneo> [--aplicar]
 *   npm run complementarios -- enlaces <temporada> <competitionId> [--aplicar]
 *
 * `--aplicar` exige el esquema deportivo (0017) aplicado por el propietario y,
 * para `engarde`, pruebas canónicas ya guardadas con las que cotejar.
 */

const args = process.argv.slice(2);
rechazarEscrituraNoCoordinada(args);
const aplicar = args.includes('--aplicar');
const [modo, a, b] = args.filter((x) => !x.startsWith('--'));

async function engarde(org: string, evt: string) {
  const torneo = await leerTorneoEngarde(org, evt);
  const serie = clasificarSerie({ nombre: torneo.nombre });
  console.log(
    `Engarde ${org}/${evt}: ${torneo.estado} pruebas=${torneo.pruebas.length}/${torneo.publicado ?? '-'} ` +
      `serie=${serie ? ETIQUETA_SERIE[serie] : 'sin determinar'}` +
      (torneo.error ? ` error=${torneo.error}` : ''),
  );
  if (torneo.pruebas.length === 0) return;

  const fechas = torneo.pruebas.map((p) => p.fecha).filter((f): f is string => f !== null).sort();
  const desde = fechas[0] ? new Date(Date.parse(fechas[0]) - 31 * 86_400_000).toISOString().slice(0, 10) : null;
  const hasta = fechas.at(-1) ? new Date(Date.parse(fechas.at(-1)!) + 31 * 86_400_000).toISOString().slice(0, 10) : null;

  let canonicas: Awaited<ReturnType<typeof import('../src/lib/ingest/complementarios-db').cargarCanonicasDb>> = [];
  const dbModulo = aplicar ? await import('../src/db') : null;
  if (dbModulo && desde && hasta) {
    const { cargarCanonicasDb } = await import('../src/lib/ingest/complementarios-db');
    canonicas = await cargarCanonicasDb(dbModulo.db, { desde, hasta });
  }
  console.log(`  pruebas canónicas candidatas: ${canonicas.length}`);

  const resultados = await conciliarTorneoEngarde(torneo, canonicas, depsEngardeReales);
  const cuenta = new Map<string, number>();
  for (const r of resultados) cuenta.set(r.plan.accion, (cuenta.get(r.plan.accion) ?? 0) + 1);
  console.log(`  planes: ${[...cuenta].map(([k, n]) => `${k}=${n}`).join(' ') || '-'}`);
  const cuentaCuadro = new Map<string, number>();
  for (const r of resultados) if (r.cuadro) cuentaCuadro.set(r.cuadro.plan.accion, (cuentaCuadro.get(r.cuadro.plan.accion) ?? 0) + 1);
  console.log(`  planes de cuadro: ${[...cuentaCuadro].map(([k, n]) => `${k}=${n}`).join(' ') || '-'}`);

  if (!aplicar) {
    console.log('Modo lectura: no se ha escrito nada. Añade --aplicar para guardar.');
    return;
  }
  const { crearDepsComplementoDb } = await import('../src/lib/ingest/complementarios-db');
  const { persistirAsaltosComplemento, persistirComplemento } = await import('../src/lib/ingest/complementarios-persist');
  const deps = crearDepsComplementoDb(dbModulo!.db);
  for (const r of resultados) {
    if (!r.canonica) continue;
    if (r.cuadro) {
      const cuadro = await persistirAsaltosComplemento(deps, {
        competitionId: r.canonica.competitionId,
        prueba: r.canonica.prueba,
        candidato: r.candidato,
        fase: 'TABLEAU',
        plan: r.cuadro.plan,
      });
      if (cuadro.estado === 'esquema_no_aplicado') {
        console.log('El esquema deportivo (migración 0017) no está aplicado: no se escribió nada.');
        process.exitCode = 2;
        return;
      }
      console.log(
        `  ${r.prueba.compe}: cuadro ${cuadro.accion} asaltos ${JSON.stringify(cuadro.asaltos)} cobertura=${cuadro.cobertura ?? '-'}`,
      );
    }
    const resumen = await persistirComplemento(deps, {
      competitionId: r.canonica.competitionId,
      prueba: r.canonica.prueba,
      candidato: r.candidato,
      plan: r.plan as Parameters<typeof persistirComplemento>[1]['plan'],
      publicado: r.lectura?.publicado ?? null,
    });
    if (resumen.estado === 'esquema_no_aplicado') {
      console.log('El esquema deportivo (migración 0017) no está aplicado: no se escribió nada.');
      process.exitCode = 2;
      return;
    }
    console.log(
      `  ${r.prueba.compe}: ${resumen.accion} puestos ${JSON.stringify(resumen.puestos)} cobertura=${resumen.cobertura ?? '-'}`,
    );
  }
}

async function enlaces(season: number, competitionId: number) {
  const d = await descubrirEnlacesFie(depsEngardeReales, season, competitionId);
  console.log(`FIE ${season}/${competitionId}: datos=${d.ficha.datos} ficha=${d.ficha.htmlStatus ?? '-'} json=${d.ficha.jsonStatus ?? '-'}`);
  if (d.ficha.aviso) console.log(`  aviso: ${d.ficha.aviso}`);
  console.log(`  enlaces publicados: ${d.publicados.length}`);
  if (!d.prueba || !d.enlaces) {
    console.log('  sin prueba oficial legible: no se evalúa ningún enlace');
    return;
  }
  for (const [proveedor, r] of Object.entries(d.enlaces)) {
    console.log(`  ${proveedor}: ${r.estado} motivos=${r.motivos.join(',') || '-'} → ${vistaEnlace(r).texto}`);
  }
  if (!aplicar) {
    console.log('Modo lectura: no se ha escrito nada. Añade --aplicar para guardar.');
    return;
  }
  const { db } = await import('../src/db');
  const { crearDepsComplementoDb } = await import('../src/lib/ingest/complementarios-db');
  const { persistirEnlaces } = await import('../src/lib/ingest/complementarios-persist');
  const deps = crearDepsComplementoDb(db);
  if (!(await deps.esquema()).identidad) {
    console.log('El esquema deportivo (migración 0017) no está aplicado: no se escribió nada.');
    process.exitCode = 2;
    return;
  }
  console.log(`  guardado: ${JSON.stringify(await persistirEnlaces(deps, d.prueba, d.enlaces))}`);
}

if (modo === 'engarde' && a && b) {
  await engarde(a, b);
} else if (modo === 'enlaces' && Number.isInteger(Number(a)) && Number.isInteger(Number(b))) {
  await enlaces(Number(a), Number(b));
} else {
  console.error(
    'Uso: npm run complementarios -- engarde <organizador> <torneo> [--aplicar]\n' +
      '     npm run complementarios -- enlaces <temporada> <competitionId> [--aplicar]',
  );
  process.exit(1);
}
