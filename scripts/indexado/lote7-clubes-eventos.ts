/**
 * Pruebas nacionales cuyos resultados completos publicó el club organizador o la federación
 * territorial. Cada URL se ha encontrado en la página indicada (`paginaUrl`); las fechas son
 * las del calendario RFEE (las impresiones de Engarde llevan la fecha en que se imprimieron).
 */
import type { HechosPrueba } from '../../src/lib/ingest/hechos/formato';

type C = HechosPrueba['competition'];

export type PruebaClub = {
  arma: C['weapon'];
  genero: C['gender'];
  categoria: C['category'];
  categoriaRaw: string | null;
  formato: C['format'];
  fecha: string;
  clasificacion: string;
  poules?: string;
  cuadro?: string;
  /** Tocados de «V» en poule (5 si no se indica). */
  maxPoule?: number;
  /** Tope de tocados del cuadro (15 individual, 45 equipos, si no se indica). */
  maxCuadro?: number;
  notas?: string[];
};

export type EventoClub = {
  id: string;
  /** Página que publica los documentos: de ella sale el namespace `pdf:<docId>`. */
  paginaUrl: string;
  season: string;
  nombre: string;
  inicio: string;
  fin: string;
  ciudad: string;
  pruebas: PruebaClub[];
};

const ALAVA = 'https://alavaesgrima.wordpress.com/wp-content/uploads/2018/01/';

export const EVENTOS: EventoClub[] = [
  {
    id: 'tnr-m20-espada-vitoria-2018',
    paginaUrl: 'https://alavaesgrima.wordpress.com/2018/01/02/i-torneo-sancho-el-sabio-tnr-junior-20-21-de-enero-de-2018/',
    season: '2017-2018',
    nombre: 'I Torneo Sancho el Sabio - TNR Junior Espada',
    inicio: '2018-01-20',
    fin: '2018-01-21',
    ciudad: 'Vitoria-Gasteiz',
    pruebas: [
      {
        arma: 'ESPADA', genero: 'M', categoria: 'M20', categoriaRaw: 'JUNIOR', formato: 'INDIVIDUAL', fecha: '2018-01-20',
        clasificacion: `${ALAVA}em-clasificaciocc81n-final-individual.pdf`, poules: `${ALAVA}em-poules.pdf`, cuadro: `${ALAVA}em-cuadro-individual.pdf`,
      },
      {
        arma: 'ESPADA', genero: 'M', categoria: 'M20', categoriaRaw: 'JUNIOR', formato: 'EQUIPOS', fecha: '2018-01-20',
        clasificacion: `${ALAVA}em-clasificaciocc81n-final-equipos.pdf`, cuadro: `${ALAVA}em-cuadro-equipos.pdf`,
      },
      {
        arma: 'ESPADA', genero: 'F', categoria: 'M20', categoriaRaw: 'JUNIOR', formato: 'INDIVIDUAL', fecha: '2018-01-21',
        clasificacion: `${ALAVA}ef-clasificaciocc81n-final-individual.pdf`, poules: `${ALAVA}ef-poules.pdf`, cuadro: `${ALAVA}ef-cuadro-individual.pdf`,
      },
      {
        arma: 'ESPADA', genero: 'F', categoria: 'M20', categoriaRaw: 'JUNIOR', formato: 'EQUIPOS', fecha: '2018-01-21',
        clasificacion: `${ALAVA}ef-clasificaciocc81n-final-equipos.pdf`, cuadro: `${ALAVA}ef-cuadro-equipos.pdf`,
      },
    ],
  },
];
