import { CIRCUIT_LABEL } from '@/lib/utils';
import type { EstadoCoberturaDto } from './tipos';

/**
 * Nombres visibles de lo que guarda el modelo deportivo. Un valor que no se
 * conoce se muestra tal cual: inventar un nombre bonito para una fuente
 * desconocida sería atribuirle algo que no se ha comprobado.
 */

const FUENTE_RANKING: Record<string, string> = {
  skermo_ranking: 'RFEE (ranking nacional en Skermo)',
  fie_tiradores: 'FIE (ranking mundial)',
};

export function fuenteRanking(fuente: string): string {
  return FUENTE_RANKING[fuente] ?? fuente;
}

export function fuenteResultado(fuente: string): string {
  if (fuente === 'fie') return 'FIE';
  if (fuente === 'rfee_pdf') return 'RFEE (PDF de resultados)';
  if (fuente.startsWith('skermo')) return 'RFEE o federación autonómica (Skermo)';
  if (fuente === 'engarde') return 'Engarde';
  if (fuente === 'fww') return 'Fencing Worldwide';
  return fuente;
}

/** Tipo de torneo sólo si lo documenta el calendario; `null` no es «ningún tipo». */
export function etiquetaTipo(tipo: string | null): string {
  if (tipo === null) return 'Sin tipo documentado';
  return CIRCUIT_LABEL[tipo] ?? tipo;
}

/** Fase de un asalto; una fase desconocida se muestra tal cual. */
export function etiquetaFase(fase: string): string {
  if (fase === 'POULE') return 'Poule';
  if (fase === 'TABLEAU') return 'Eliminación directa';
  return fase;
}

const HECHO: Record<string, string> = {
  results: 'Puestos finales',
  ranking: 'Puestos finales',
  pools: 'Asaltos de poule',
  tableau: 'Asaltos de cuadro',
  link: 'Enlaces a otras fuentes',
  pdf: 'PDF de resultados',
  competitions: 'Índice de pruebas',
  index: 'Índice de la fuente',
};

export function etiquetaHecho(hecho: string): string {
  return HECHO[hecho] ?? hecho;
}

export const ESTADO_COBERTURA: Record<EstadoCoberturaDto, { texto: string; ayuda: string }> = {
  completo: {
    texto: 'Leído completo',
    ayuda: 'La fuente se leyó entera para estas pruebas. No garantiza que no haya otras fuentes o años.',
  },
  parcial: { texto: 'Parcial', ayuda: 'Se leyó sólo una parte; pueden faltar filas.' },
  pendiente: { texto: 'Pendiente de leer', ayuda: 'Todavía no se ha procesado: no hay datos, pero tampoco ausencia.' },
  sin_resultados: {
    texto: 'La fuente no publica resultados',
    ayuda: 'La fuente respondió sin resultados para estas pruebas.',
  },
  error: { texto: 'Error al leer', ayuda: 'La lectura falló; lo mostrado puede estar incompleto.' },
  conflicto: { texto: 'Datos en conflicto', ayuda: 'Las fuentes se contradicen y está pendiente de revisión.' },
};

const MOTIVO_SIN_FICHA = {
  sin_ficha: {
    titulo: 'Tu cuenta no tiene una ficha de tirador',
    texto:
      'Sin ficha de tirador no se puede saber cuál es tu historial. La dirección técnica la vincula desde Gestión › Usuarios.',
  },
  sin_vinculo: {
    titulo: 'Tu ficha todavía no está vinculada a una persona deportiva',
    texto:
      'No hay una identidad deportiva confirmada por licencia o por identificador de federación. No se asigna por parecido de nombre, porque podría ser un homónimo.',
  },
  ambigua: {
    titulo: 'Tu cuenta gestiona más de una persona deportiva',
    texto: 'No se elige una por ti. Ábrelas una a una desde Explorar.',
  },
  conflicto: {
    titulo: 'Las pruebas de identidad se contradicen',
    texto:
      'Hay datos que apuntan a personas distintas, así que no se muestra ningún historial como tuyo hasta que la dirección técnica lo revise.',
  },
} as const;

export function explicacionSinVinculo(motivo: keyof typeof MOTIVO_SIN_FICHA) {
  return MOTIVO_SIN_FICHA[motivo];
}
