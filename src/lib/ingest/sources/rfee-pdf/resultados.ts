import type { EstadoCobertura } from '../fie-resultados';
import { exclusionesVacias } from './asaltos';
import { dividirPaginaPorPruebas } from './bloques';
import { metadatosDeCabecera, type MetadatosCabecera } from './cabecera';
import { leerClasificacion } from './clasificacion';
import { leerCuadro } from './cuadro';
import { leerClasificacionIntermedia, nombreEnIntermedia } from './intermedia';
import { analizarPagina, type PaginaAnalizada } from './paginas';
import { leerPoules } from './poules';
import type {
  Arma,
  AsaltoPdf,
  Genero,
  CoberturaPdf,
  ExclusionesPdf,
  Formato,
  LecturaPdf,
  PaginaClasificada,
  PaginaTexto,
  PruebaPdf,
  Rechazo,
} from './tipos';

/**
 * Del texto posicionado de un PDF de Engarde a pruebas con puestos y asaltos.
 *
 * Una prueba es el conjunto de páginas con la MISMA cabecera, no un trozo del
 * texto: un PDF con varias armas, géneros o edades se parte por cabecera y
 * cada fila se atribuye a la suya. Lo que no se atribuye con seguridad queda
 * en `rechazos` (con página y región) y la lectura no se da por completa.
 */

const PRIORIDAD: EstadoCobertura[] = ['error', 'conflicto', 'pendiente', 'parcial', 'completo', 'sin_resultados'];

function peor(estados: EstadoCobertura[]): EstadoCobertura {
  for (const e of PRIORIDAD) if (estados.includes(e)) return e;
  return 'sin_resultados';
}

const slug = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 24);

function coberturaAsaltos(
  rechazos: Rechazo[],
  ex: ExclusionesPdf,
  publicado: number,
  importado: number,
  hayPaginas: boolean,
): CoberturaPdf {
  if (!hayPaginas) return { estado: 'sin_resultados', publicado: null, importado: 0, motivo: 'El documento no publica estas páginas para la prueba' };
  const dudosos = ex.incoherente + ex.identidadNoConfirmada + ex.conflicto + ex.sinMarcador + ex.sinGanador;
  if (ex.conflicto > 0) return { estado: 'conflicto', publicado, importado, motivo: 'Un mismo asalto con marcadores distintos' };
  if (rechazos.length > 0 || dudosos > 0) {
    return { estado: 'parcial', publicado, importado, motivo: `${rechazos.length} regiones y ${dudosos} cruces sin atribuir con seguridad` };
  }
  // Una sección reconocida que no aporta ni un cruce, ni un BYE ni un duplicado no se da por leída.
  if (importado === 0 && ex.bye === 0 && ex.duplicado === 0) {
    return { estado: 'parcial', publicado, importado, motivo: 'Sección reconocida sin ningún cruce legible' };
  }
  return { estado: 'completo', publicado, importado, motivo: null };
}

/**
 * Arma y género que el llamante ya conoce de la prueba (la auditoría, por la competición guardada).
 * Sólo cubren lo que la cabecera no determina, y nunca contra lo que nombra: con «masculino y
 * femenino» la pista tiene que ser uno de los dos.
 */
export type PistasPrueba = { arma?: Arma | null; genero?: Genero | null };

function aplicarPistas(meta: MetadatosCabecera, pistas: PistasPrueba | undefined): MetadatosCabecera {
  if (!pistas) return meta;
  let { arma, genero, errores } = meta;
  if (arma === null && pistas.arma && (meta.armasDeclaradas.length === 0 || meta.armasDeclaradas.includes(pistas.arma))) {
    arma = pistas.arma;
    errores = errores.filter((e) => !/ arma$/.test(e));
  }
  if (genero === null && pistas.genero && (meta.generosDeclarados.length === 0 || meta.generosDeclarados.includes(pistas.genero))) {
    genero = pistas.genero;
    errores = errores.filter((e) => !/ género$/.test(e));
  }
  return { ...meta, arma, genero, errores };
}

function construirPrueba(
  docId: string,
  grupo: PaginaAnalizada[],
  existentes: Set<string>,
  pistas?: PistasPrueba,
): PruebaPdf {
  const cabecera = grupo[0].cabecera;
  const meta = aplicarPistas(metadatosDeCabecera(cabecera), pistas);
  const rechazos: Rechazo[] = [];
  const porTipo = (t: PaginaAnalizada['tipo']) => grupo.filter((p) => p.tipo === t);

  const clasificacion = leerClasificacion(porTipo('clasificacion_final'));
  rechazos.push(...clasificacion.rechazos);

  let formato: Formato | null = meta.formato;
  let conflictoFormato = false;
  if (formato && clasificacion.unidad && formato !== clasificacion.unidad) {
    conflictoFormato = true;
    rechazos.push({ seccion: 'prueba', region: null, motivo: 'La cabecera y la clasificación declaran modalidades distintas' });
  } else if (!formato) {
    formato = clasificacion.unidad;
  }

  const atribuible = meta.arma !== null && meta.genero !== null && formato !== null && !conflictoFormato;
  if (!atribuible && !conflictoFormato) {
    // La categoría no impide atribuir: si sólo falta la modalidad, el motivo debe decirlo.
    const motivos = [...meta.errores];
    if (formato === null && !motivos.some((m) => /individual y equipos/.test(m))) motivos.push('Modalidad no declarada');
    rechazos.push({ seccion: 'prueba', region: null, motivo: motivos.join('; ') });
  }
  if (atribuible && meta.categoria === null) {
    rechazos.push({ seccion: 'prueba', region: null, motivo: meta.errores.find((e) => /categor/i.test(e)) ?? 'Categoría sin equivalencia' });
  }

  const clave = (() => {
    const base = [docId, meta.arma ?? '?', meta.genero ?? '?', formato ?? '?', meta.categoria ?? '?', slug(meta.cohorte ?? '')].join(':');
    let k = base;
    for (let i = 2; existentes.has(k); i += 1) k = `${base}~${i}`;
    existentes.add(k);
    return k;
  })();

  let excluidos = exclusionesVacias();
  let asaltos: AsaltoPdf[] = [];
  const puestos = atribuible ? clasificacion.puestos : [];

  const paginasPoules = porTipo('poules');
  const paginasCuadro = porTipo('cuadro');
  let publicadoPoules = 0;
  let publicadoCuadro = 0;
  let rechazosPoules: Rechazo[] = [];
  let rechazosCuadro: Rechazo[] = [];
  let exPoules = exclusionesVacias();
  let exCuadro = exclusionesVacias();
  let motivoEquipos: string | null = null;

  if (atribuible && formato === 'INDIVIDUAL') {
    const registro = puestos.map((p) => ({ ref: p.ref, nombre: p.nombre, club: p.club, pais: p.pais ?? null, posicion: p.posicion }));
    const intermedia = leerClasificacionIntermedia(porTipo('clasificacion_intermedia'));
    const poules = leerPoules(paginasPoules, registro, intermedia);
    // Quien quedó eliminado tras las poules no tira el cuadro: no compite por un nombre truncado con su homónimo.
    const eliminados = new Set(registro.filter((p) => intermedia.some((x) => x.eliminado === true && x.posicion === p.posicion && nombreEnIntermedia(p.nombre, x))).map((p) => p.ref));
    const cuadro = leerCuadro(paginasCuadro, eliminados.size > 0 ? registro.filter((p) => !eliminados.has(p.ref)) : registro);
    asaltos = [...poules.asaltos, ...cuadro.asaltos];
    exPoules = poules.excluidos;
    exCuadro = cuadro.excluidos;
    rechazosPoules = poules.rechazos;
    rechazosCuadro = cuadro.rechazos;
    publicadoPoules = poules.publicado;
    publicadoCuadro = cuadro.publicado;
  } else if (atribuible) {
    exPoules.equipo = paginasPoules.length;
    exCuadro.equipo = paginasCuadro.length;
    motivoEquipos = 'Prueba por equipos: sus poules y cuadros no son asaltos individuales';
  }
  for (const k of Object.keys(excluidos) as (keyof ExclusionesPdf)[]) excluidos[k] = exPoules[k] + exCuadro[k];
  rechazos.push(...rechazosPoules, ...rechazosCuadro);
  if (!atribuible) excluidos = exclusionesVacias();

  const hayFinal = porTipo('clasificacion_final').length > 0;
  const importadoPoules = asaltos.filter((a) => a.fase === 'POULE').length;
  const importadoCuadro = asaltos.filter((a) => a.fase === 'TABLEAU').length;
  const estadoPuestos: CoberturaPdf = !atribuible
    ? { estado: 'pendiente', publicado: null, importado: 0, motivo: 'La prueba no se puede atribuir: revisión pendiente' }
    : !hayFinal
      ? { estado: 'sin_resultados', publicado: null, importado: 0, motivo: 'El documento no publica clasificación final para esta prueba' }
      : clasificacion.totalesContradictorios
        ? { estado: 'conflicto', publicado: null, importado: puestos.length, motivo: 'El documento declara totales distintos de participantes' }
        : clasificacion.rechazos.length > 0 || (clasificacion.publicado !== null && clasificacion.publicado !== puestos.length)
          ? { estado: 'parcial', publicado: clasificacion.publicado, importado: puestos.length, motivo: `${clasificacion.rechazos.length} filas sin atribuir con seguridad` }
          : { estado: 'completo', publicado: clasificacion.publicado, importado: puestos.length, motivo: null };

  const sinAtribuir: CoberturaPdf = { estado: 'pendiente', publicado: null, importado: 0, motivo: 'La prueba no se puede atribuir: revisión pendiente' };
  const noIndividual: CoberturaPdf = { estado: 'sin_resultados', publicado: null, importado: 0, motivo: motivoEquipos };
  const coberturaPoules = !atribuible ? sinAtribuir : motivoEquipos ? noIndividual : coberturaAsaltos(rechazosPoules, exPoules, publicadoPoules, importadoPoules, paginasPoules.length > 0);
  const coberturaCuadro = !atribuible ? sinAtribuir : motivoEquipos ? noIndividual : coberturaAsaltos(rechazosCuadro, exCuadro, publicadoCuadro, importadoCuadro, paginasCuadro.length > 0);

  const partes = [estadoPuestos.estado, coberturaPoules.estado, coberturaCuadro.estado];
  let estado = peor(partes);
  if (atribuible && meta.categoria === null && (estado === 'completo' || estado === 'sin_resultados')) estado = 'parcial';
  if (conflictoFormato) estado = 'conflicto';

  return {
    clave,
    cabecera,
    arma: meta.arma,
    genero: meta.genero,
    formato,
    categoria: meta.categoria,
    categoriaOriginal: meta.categoriaOriginal,
    cohorte: meta.cohorte,
    categoriaPublicada: meta.categoriaPublicada,
    fecha: meta.fecha,
    paginas: grupo.map((p) => p.numero),
    puestos,
    asaltos,
    excluidos,
    rechazos,
    cobertura: { puestos: estadoPuestos, poules: coberturaPoules, cuadro: coberturaCuadro },
    estado,
  };
}

const SIN_PRUEBA: PaginaAnalizada['tipo'][] = ['sin_texto', 'ilegible', 'desconocida'];

export function leerResultadosPdf(
  paginas: readonly PaginaTexto[],
  contexto: { url: string; docId: string; pistas?: PistasPrueba },
): LecturaPdf {
  const analizadas = paginas.flatMap(dividirPaginaPorPruebas).map(analizarPagina);
  const grupos = new Map<string, PaginaAnalizada[]>();
  const clasificadas: PaginaClasificada[] = [];
  const rechazos: Rechazo[] = [];
  const paginasOcr: number[] = [];

  for (const p of analizadas) {
    if (SIN_PRUEBA.includes(p.tipo) || p.firma === '') {
      if (p.tipo === 'sin_texto' || p.tipo === 'ilegible') paginasOcr.push(p.numero);
      const motivo = p.motivo ?? 'Página sin cabecera de prueba: no se atribuye a ninguna';
      clasificadas.push({ pagina: p.numero, tipo: p.tipo, prueba: null, motivo });
      rechazos.push({ seccion: 'pagina', region: { pagina: p.numero, yMax: p.alto, yMin: 0 }, motivo });
      continue;
    }
    const g = grupos.get(p.firma) ?? [];
    g.push(p);
    grupos.set(p.firma, g);
  }

  const claves = new Set<string>();
  const pruebas: PruebaPdf[] = [];
  for (const g of grupos.values()) {
    const prueba = construirPrueba(contexto.docId, g, claves, contexto.pistas);
    pruebas.push(prueba);
    for (const p of g) clasificadas.push({ pagina: p.numero, tipo: p.tipo, prueba: prueba.clave, motivo: null });
  }
  clasificadas.sort((a, b) => a.pagina - b.pagina);

  const sinNada = analizadas.length === 0 || analizadas.every((p) => p.tipo === 'sin_texto' || p.tipo === 'ilegible');
  let estado: EstadoCobertura;
  if (sinNada) estado = 'pendiente';
  else if (pruebas.length === 0) estado = 'pendiente';
  else {
    estado = peor(pruebas.map((p) => p.estado));
    if (rechazos.length > 0 && (estado === 'completo' || estado === 'sin_resultados')) estado = 'parcial';
  }

  return {
    url: contexto.url,
    docId: contexto.docId,
    sha256: null,
    perfil: null,
    paginas: clasificadas,
    pruebas,
    rechazos,
    ocr: {
      necesario: paginasOcr.length > 0,
      paginas: paginasOcr,
      ejecutado: false,
      motivo: paginasOcr.length > 0 ? 'Páginas sin texto utilizable: OCR no ejecutado, pendientes de revisión' : null,
    },
    estado,
    error: null,
  };
}
