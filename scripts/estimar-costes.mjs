#!/usr/bin/env node
/**
 * Coste mensual estimado de la aplicación en Cloudflare (plan Workers Paid) y
 * en los servicios externos, para un número de usuarios activos al día.
 *
 *   node scripts/estimar-costes.mjs                      -> escenarios habituales
 *   node scripts/estimar-costes.mjs --dau 500 --sesiones 4 --acciones 8
 *   node scripts/estimar-costes.mjs --perfil antes       -> consumos previos a la optimización
 *
 * Los consumos por sesión salen de las mediciones guardadas en
 * docs/capacidad-costes-2026-10-07.md y docs/costes-y-escalado-2026-10-08.md.
 * Los precios son los publicados por cada proveedor en octubre de 2026; si
 * cambian, sólo hay que tocar PRECIOS.
 */

const PRECIOS = {
  base: 5,
  workers: { peticiones: 10e6, precioPeticiones: 0.3, cpuMs: 30e6, precioCpu: 0.02 },
  d1: { lecturas: 25e9, precioLecturas: 0.001, escrituras: 50e6, precioEscrituras: 1, gb: 5, precioGb: 0.75 },
  kv: { lecturas: 10e6, precioLecturas: 0.5, escrituras: 1e6, precioEscrituras: 5 },
  r2: { gb: 10, precioGb: 0.015, claseA: 1e6, precioA: 4.5, claseB: 10e6, precioB: 0.36 },
  ia: { neuronasDia: 10_000, precioMilNeuronas: 0.011 },
  registros: { eventos: 20e6, precioEventos: 0.6 },
};

/**
 * Lo que consume una sesión típica (A = acciones por sesión) y lo que consume
 * la ingesta sola en un mes. «antes» es la versión 485b5ac; «despues», esta.
 */
const PERFILES = {
  antes: {
    // Documento + retrato, 1,5 peticiones dinámicas por acción y la campana cada minuto (~5 min visibles).
    peticionesSesion: (a) => 2 + 1.5 * a + 5,
    cpuMsPeticion: 20,
    // 6 filas por petición de armazón, ~2.000 por acción (templadas y frías repartidas) y
    // dos búsquedas de foto sin pista de índice (~43.000 filas cada una).
    filasLeidasSesion: (a, r) => 6 * r + 2000 * a + 2 * 43_000,
    filasEscritasUsuarioDia: 15,
    kvLecturasSesion: 4,
    kvEscriturasMes: 300_000,
    r2LecturasSesion: (a) => 0.5 * a,
    eventosRegistroPeticion: 2,
    fraccionNeon: 1,
    // Cadena nocturna medida el 7/10 (14.362 filas escritas) menos lo que ya corrigió 8c3e8aee.
    ingesta: { invocaciones: 840, cpuMs: 2e6, filasLeidas: 8.5e6, filasEscritas: 300_000, kvEscrituras: 10_000, r2Escrituras: 30, neuronasDia: 300 },
    d1Gb: 2.21,
  },
  despues: {
    // Campana cada 5 min; con 4G (~la mitad de sesiones) se precargan en reposo las otras 3 pestañas
    // y, al abrir una competición, sus otras dos vistas (~2 competiciones por sesión).
    peticionesSesion: (a) => 2 + 1.5 * a + 1 + 1.5 + 2,
    cpuMsPeticion: 20,
    // Sugerencias, cambio de tabla del ranking y feed repetido salen de caché; la foto lee 13 filas.
    filasLeidasSesion: (a, r) => 6 * r + 1100 * a + 2 * 13,
    filasEscritasUsuarioDia: 15,
    kvLecturasSesion: 4,
    kvEscriturasMes: 100_000,
    r2LecturasSesion: (a) => 0.5 * a,
    eventosRegistroPeticion: 2,
    fraccionNeon: 0.15,
    // Inscripciones, plazos y enlaces sólo cuando cambian; pasadas horarias vacías de 1 consulta.
    ingesta: { invocaciones: 840, cpuMs: 1.3e6, filasLeidas: 6e6, filasEscritas: 150_000, kvEscrituras: 3_000, r2Escrituras: 8, neuronasDia: 300 },
    d1Gb: 2.46,
  },
};

const R2_GB = 0.5;
const LOGINS_USUARIO_DIA = 0.15;

export function consumo(perfil, { dau, sesiones, acciones }) {
  const p = PERFILES[perfil];
  const sesionesMes = dau * sesiones * 30;
  const r = p.peticionesSesion(acciones);
  const peticionesUsuarios = sesionesMes * r;
  return {
    peticiones: peticionesUsuarios + p.ingesta.invocaciones,
    cpuMs: peticionesUsuarios * p.cpuMsPeticion + p.ingesta.cpuMs,
    d1Lecturas: sesionesMes * p.filasLeidasSesion(acciones, r) + p.ingesta.filasLeidas,
    d1Escrituras: dau * 30 * p.filasEscritasUsuarioDia + p.ingesta.filasEscritas,
    kvLecturas: sesionesMes * p.kvLecturasSesion,
    kvEscrituras: (dau > 0 ? p.kvEscriturasMes : 0) + p.ingesta.kvEscrituras,
    r2Lecturas: sesionesMes * p.r2LecturasSesion(acciones),
    r2Escrituras: p.ingesta.r2Escrituras,
    registros: (peticionesUsuarios + p.ingesta.invocaciones) * p.eventosRegistroPeticion,
    neuronasDia: p.ingesta.neuronasDia,
    d1Gb: p.d1Gb,
    r2Gb: R2_GB,
    neonDia: dau * sesiones * r * p.fraccionNeon,
    correosCodigoDia: dau * LOGINS_USUARIO_DIA,
  };
}

const exceso = (uso, incluido, precioMillon, unidad = 1e6) => (Math.max(0, uso - incluido) / unidad) * precioMillon;

export function coste(c) {
  const partes = {
    peticiones: exceso(c.peticiones, PRECIOS.workers.peticiones, PRECIOS.workers.precioPeticiones),
    cpu: exceso(c.cpuMs, PRECIOS.workers.cpuMs, PRECIOS.workers.precioCpu),
    d1Lecturas: exceso(c.d1Lecturas, PRECIOS.d1.lecturas, PRECIOS.d1.precioLecturas),
    d1Escrituras: exceso(c.d1Escrituras, PRECIOS.d1.escrituras, PRECIOS.d1.precioEscrituras),
    d1Almacen: Math.max(0, c.d1Gb - PRECIOS.d1.gb) * PRECIOS.d1.precioGb,
    kvLecturas: exceso(c.kvLecturas, PRECIOS.kv.lecturas, PRECIOS.kv.precioLecturas),
    kvEscrituras: exceso(c.kvEscrituras, PRECIOS.kv.escrituras, PRECIOS.kv.precioEscrituras),
    r2: Math.max(0, c.r2Gb - PRECIOS.r2.gb) * PRECIOS.r2.precioGb
      + exceso(c.r2Escrituras, PRECIOS.r2.claseA, PRECIOS.r2.precioA)
      + exceso(c.r2Lecturas, PRECIOS.r2.claseB, PRECIOS.r2.precioB),
    ia: (Math.max(0, c.neuronasDia - PRECIOS.ia.neuronasDia) * 30 / 1000) * PRECIOS.ia.precioMilNeuronas,
    registros: exceso(c.registros, PRECIOS.registros.eventos, PRECIOS.registros.precioEventos),
  };
  const extra = Object.values(partes).reduce((s, v) => s + v, 0);
  return { partes, total: PRECIOS.base + extra };
}

const entero = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const dolares = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

function cifra(n) {
  if (n >= 1e9) return `${decimal.format(n / 1e9)} mil M`;
  if (n >= 1e6) return `${decimal.format(n / 1e6)} M`;
  if (n >= 1e3) return `${decimal.format(n / 1e3)} k`;
  return entero.format(n);
}

const porcentaje = (uso, incluido) => `${decimal.format((uso / incluido) * 100)} %`;

const ESCENARIOS = [
  { nombre: 'Sólo ingesta, sin usuarios', dau: 0, sesiones: 0, acciones: 8 },
  { nombre: '100 usuarios/día × 4 sesiones', dau: 100, sesiones: 4, acciones: 8 },
  { nombre: '500 usuarios/día × 2 sesiones', dau: 500, sesiones: 2, acciones: 8 },
  { nombre: '500 usuarios/día × 4 sesiones', dau: 500, sesiones: 4, acciones: 8 },
  { nombre: '500 usuarios/día × 8 sesiones', dau: 500, sesiones: 8, acciones: 8 },
  { nombre: '2.000 usuarios/día × 4 sesiones', dau: 2000, sesiones: 4, acciones: 8 },
  { nombre: '5.000 usuarios/día × 4 sesiones', dau: 5000, sesiones: 4, acciones: 8 },
];

function tabla(perfil, escenarios) {
  const filas = [
    '| Escenario | Peticiones/mes | CPU/mes | Filas D1 leídas | Filas D1 escritas | KV lect./escr. | Coste Cloudflare/mes |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const e of escenarios) {
    const c = consumo(perfil, e);
    filas.push(`| ${e.nombre} | ${cifra(c.peticiones)} | ${cifra(c.cpuMs)} ms | ${cifra(c.d1Lecturas)} | ${cifra(c.d1Escrituras)} | ${cifra(c.kvLecturas)} / ${cifra(c.kvEscrituras)} | ${dolares.format(coste(c).total)} |`);
  }
  return filas.join('\n');
}

function margen(perfil, e) {
  const c = consumo(perfil, e);
  return [
    `| Recurso (${e.nombre}) | Uso/mes | Incluido | Ocupación |`,
    '|---|---:|---:|---:|',
    `| Peticiones dinámicas | ${cifra(c.peticiones)} | 10 M | ${porcentaje(c.peticiones, PRECIOS.workers.peticiones)} |`,
    `| CPU | ${cifra(c.cpuMs)} ms | 30 M ms | ${porcentaje(c.cpuMs, PRECIOS.workers.cpuMs)} |`,
    `| D1 filas leídas | ${cifra(c.d1Lecturas)} | 25 mil M | ${porcentaje(c.d1Lecturas, PRECIOS.d1.lecturas)} |`,
    `| D1 filas escritas | ${cifra(c.d1Escrituras)} | 50 M | ${porcentaje(c.d1Escrituras, PRECIOS.d1.escrituras)} |`,
    `| D1 almacenamiento | ${decimal.format(c.d1Gb)} GB | 5 GB | ${porcentaje(c.d1Gb, PRECIOS.d1.gb)} |`,
    `| KV lecturas | ${cifra(c.kvLecturas)} | 10 M | ${porcentaje(c.kvLecturas, PRECIOS.kv.lecturas)} |`,
    `| KV escrituras | ${cifra(c.kvEscrituras)} | 1 M | ${porcentaje(c.kvEscrituras, PRECIOS.kv.escrituras)} |`,
    `| R2 almacenamiento | ${decimal.format(c.r2Gb)} GB | 10 GB | ${porcentaje(c.r2Gb, PRECIOS.r2.gb)} |`,
    `| R2 lecturas | ${cifra(c.r2Lecturas)} | 10 M | ${porcentaje(c.r2Lecturas, PRECIOS.r2.claseB)} |`,
    `| Workers AI (neuronas/día) | ${cifra(c.neuronasDia)} | 10 k/día | ${porcentaje(c.neuronasDia, PRECIOS.ia.neuronasDia)} |`,
    `| Eventos de registro | ${cifra(c.registros)} | 20 M | ${porcentaje(c.registros, PRECIOS.registros.eventos)} |`,
    `| Comprobaciones de sesión en Neon/día | ${cifra(c.neonDia)} | — | — |`,
    `| Correos de código/día | ${cifra(c.correosCodigoDia)} | — | — |`,
  ].join('\n');
}

function argumento(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

const esPrincipal = Boolean(process.argv[1]?.endsWith('estimar-costes.mjs'));

if (esPrincipal) {
  const perfil = argumento('perfil', 'despues');
  if (!PERFILES[perfil]) {
    console.error('Perfiles válidos: antes, despues');
    process.exit(1);
  }
  const dau = argumento('dau', null);
  if (dau !== null) {
    const e = {
      nombre: `${dau} usuarios/día × ${argumento('sesiones', '4')} sesiones`,
      dau: Number(dau),
      sesiones: Number(argumento('sesiones', '4')),
      acciones: Number(argumento('acciones', '8')),
    };
    console.log(tabla(perfil, [e]));
    console.log();
    console.log(margen(perfil, e));
  } else {
    console.log(`Perfil: ${perfil}\n`);
    console.log(tabla(perfil, ESCENARIOS));
    console.log();
    console.log(margen(perfil, ESCENARIOS[3]));
  }
}
