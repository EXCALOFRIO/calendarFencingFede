/**
 * Qué se filtra de cada cosa en Buscar. Un tirador se filtra por arma,
 * género, categoría y país; temporada, fechas, torneo, ámbito y organizador
 * son de las competiciones (su pestaña los tiene) y en Tiradores sólo siguen
 * valiendo si llegan en la URL de un enlace antiguo, como chips quitables. Un
 * país no tiene filtros.
 */
export const CLAVES_FILTRO_TIRADOR = ['arma', 'genero', 'categoria', 'nacionalidad'] as const;
