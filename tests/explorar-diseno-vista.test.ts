import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Aclaracion, Celda, EnlaceFuente } from '@/components/explorar/piezas';
import {
  CabeceraFicha,
  CoberturaFichaVista,
  EstadisticasFicha,
  RankingOficialFicha,
} from '@/components/explorar/ficha-deportiva';
import {
  CabeceraCaraACara,
  CoberturaCaraACaraVista,
} from '@/components/explorar/cara-a-cara';
import { ClasificacionDePrueba, EdicionCompleta } from '@/components/explorar/ediciones';
import type { DatosCaraACara } from '@/lib/sport/explorar/cara-a-cara-pantalla';
import { CRITERIOS_CARA_A_CARA_VACIOS } from '@/lib/sport/explorar/cara-a-cara-url';
import { CRITERIOS_FICHA_VACIOS } from '@/lib/sport/explorar/ficha-url';
import type { EdicionDetalle, PruebaDeEdicion } from '@/lib/sport/explorar/edicion-modelo';
import type { FichaDeportiva } from '@/lib/sport/explorar/tipos';
import { UUID_A, UUID_B } from './helpers/explorar';

const html = (nodo: React.ReactElement) => renderToStaticMarkup(nodo);
const detalles = (salida: string) => salida.match(/<details\b[\s\S]*?<\/details>/g) ?? [];
const sinDetalles = (salida: string) => salida.replace(/<details\b[\s\S]*?<\/details>/g, '');

const ficha: FichaDeportiva = {
  id: UUID_A,
  nombre: 'Lucía García de la Torre Fernández',
  alias: [],
  pais: 'ESP',
  genero: 'F',
  anioNacimiento: null,
  esMenor: true,
  esPropia: false,
  estadisticas: {
    conjunto: 'clasificaciones_individuales',
    porTipo: [{ tipo: null, clasificaciones: 2, mejorPuesto: null, podios: 0, victorias: 0, sinPuestoNumerico: 2 }],
  },
  cobertura: {
    resultadosImportados: 2,
    pruebasConResultado: 2,
    ediciones: 1,
    lecturas: [{ hecho: 'tableau', estado: 'parcial', pruebas: 1 }],
    historiaCompleta: false,
  },
  rankingOficial: { temporada: null, formato: 'INDIVIDUAL', temporadasDisponibles: [], entradas: [] },
};

const prueba: PruebaDeEdicion = {
  id: UUID_B,
  arma: 'FLORETE',
  genero: 'F',
  categoria: { codigo: 'ABS', raw: 'Senior' },
  formato: 'INDIVIDUAL',
  fecha: null,
  fuente: 'fie',
  pruebaCalendarioId: null,
  resultados: { estado: 'parcial', importados: 2 },
  enlaces: [],
};

const edicion: EdicionDetalle = {
  id: UUID_A,
  nombre: 'CAMPEONATO DEL MEDITERRÁNEO',
  temporada: '2026',
  fuente: 'fie',
  ciudad: null,
  pais: null,
  inicio: null,
  fin: null,
  pruebas: 1,
  armas: ['FLORETE'],
  formatos: ['INDIVIDUAL'],
  serie: 'campeonato_mediterraneo',
  pruebasDetalle: [prueba],
  pruebaDesconocida: false,
  clasificacion: null,
};

describe('Explorar: jerarquía y explicación progresiva', () => {
  it('la explicación usa details nativo cerrado, texto SSR y un summary táctil con foco', () => {
    const salida = html(React.createElement(Aclaracion, { titulo: 'Cómo se cuenta', children: 'Una prueba, un resultado.' }));
    expect(salida).toMatch(/<details\b[^>]*>/);
    expect(salida).not.toMatch(/<details[^>]*\bopen\b/);
    expect(salida).toContain('Una prueba, un resultado.');
    expect(salida).toMatch(/<summary[^>]*min-h-11[^>]*focus-visible:ring/);
  });

  it('las celdas conservan etiquetas visibles en escritorio y móvil', () => {
    const salida = html(React.createElement(Celda, { etiqueta: 'Puesto', children: '12' }));
    expect(salida).toContain('Puesto');
    expect(salida).not.toContain('sr-only');
  });

  it('la estrella sigue después del nombre completo, sin ocultar la protección de menores', () => {
    const salida = html(React.createElement(CabeceraFicha, {
      ficha,
      acciones: React.createElement('button', { 'aria-label': 'Guardar ficha' }, 'Estrella'),
    }));
    expect(salida.indexOf(ficha.nombre)).toBeLessThan(salida.indexOf('Guardar ficha'));
    expect(salida).not.toMatch(/truncate|line-clamp/);
    expect(sinDetalles(salida)).toContain('Posible menor de edad');
    expect(salida).toContain('No se muestra');
  });

  it('las cifras y la cobertura se leen antes de la metodología, sin inventar un mejor puesto', () => {
    const salida = html(React.createElement(EstadisticasFicha, { ficha, nivel: 'pagina' }));
    expect(salida.indexOf('<ul')).toBeLessThan(salida.indexOf('<details'));
    expect(sinDetalles(salida)).toContain('Sin dato');
    expect(sinDetalles(salida)).toContain('Conjunto cubierto: 2 pruebas');
    expect(salida).toMatch(/class="cifra text-4xl/);
    expect(detalles(salida)[0]).toContain('Una inscripción sin final no cuenta');
  });

  it('los estados parciales permanecen visibles y no se repliegan con la metodología', () => {
    const salida = html(React.createElement(CoberturaFichaVista, { cobertura: ficha.cobertura, nivel: 'pagina' }));
    expect(sinDetalles(salida)).toContain('Parcial: 1 prueba');
    expect(salida).toContain('nunca garantiza que estén todas las temporadas');
  });

  it('mantiene fuente y fecha de lectura visibles, sin disfrazar la fecha de publicación', () => {
    const salida = html(React.createElement(RankingOficialFicha, {
      ficha: {
        ...ficha,
        rankingOficial: {
          temporada: '2026',
          formato: 'INDIVIDUAL',
          temporadasDisponibles: ['2026'],
          entradas: [{
            fuente: 'fie_tiradores',
            temporada: '2026',
            arma: 'FLORETE',
            genero: 'F',
            categoria: { codigo: 'ABS', raw: 'Senior' },
            formato: 'INDIVIDUAL',
            puesto: 12,
            puntos: null,
            totalPublicado: null,
            fecha: { sourcePublishedOn: null, observedOn: '2026-09-30', baseLectura: true },
            enlace: 'https://example.test/lista',
          }],
        },
      },
      base: `/explorar/${UUID_A}`,
      criterios: CRITERIOS_FICHA_VACIOS,
      nivel: 'pagina',
    }));
    const visible = sinDetalles(salida);
    expect(visible).toContain('FIE (ranking mundial)');
    expect(visible).toContain('Leída el');
    expect(visible).toContain('Puntos no publicados');
    expect(visible).not.toContain('Publicada el');
    expect(visible).not.toMatch(/de \d+/);
    expect(salida).toContain('Fecha de lectura, no de publicación');
  });

  it('enlaces de fuente conservan 44 px también en escritorio y rechazan esquemas inseguros', () => {
    const salida = html(React.createElement(EnlaceFuente, { url: 'https://example.test/lista', etiqueta: 'Fuente' }));
    expect(salida).toContain('min-h-11');
    expect(salida).not.toContain('md:min-h-0');
    expect(salida).toContain('rel="noopener noreferrer"');
    expect(html(React.createElement(EnlaceFuente, { url: 'javascript:alert(1)', etiqueta: 'Fuente' }))).toBe('');
  });

  it('el cara a cara no repite nombres en el título y mantiene identificada la perspectiva', () => {
    const datos = {
      personas: {
        yo: { id: UUID_A, nombre: ficha.nombre, pais: 'ESP' },
        rival: { id: UUID_B, nombre: 'Marta Ruiz', pais: 'FRA' },
      },
    } as DatosCaraACara;
    const salida = html(React.createElement(CabeceraCaraACara, { datos, criterios: CRITERIOS_CARA_A_CARA_VACIOS }));
    expect(salida).toMatch(/<h1[^>]*>Cara a cara<\/h1>/);
    expect(salida).toContain('Visto desde');
    expect(salida).toContain(ficha.nombre);
    expect(salida).toContain('Invertir perspectiva');
    expect(salida).toContain('aria-label="Verlo desde Marta Ruiz"');
  });

  it('el aviso de cobertura parcial del cara a cara nunca queda dentro de details', () => {
    const salida = html(React.createElement(CoberturaCaraACaraVista, {
      hayAsaltos: true,
      cobertura: {
        estado: 'parcial',
        pruebasComunes: 2,
        pruebasConAsaltos: 1,
        pruebasSinAsaltosPublicados: 0,
        pruebasSinVerificar: 1,
        pendientes: [],
        pendientesTruncado: false,
        exhaustivo: false,
      },
    }));
    expect(sinDetalles(salida)).toContain('Cobertura parcial');
    expect(sinDetalles(salida)).toContain('El balance puede estar incompleto');
  });

  it('la edición presenta pares etiqueta/valor y mantiene ausencias y clasificación parcial', () => {
    const salida = html(React.createElement(EdicionCompleta, { edicion, criterios: { prueba: '', cursor: '' } }));
    expect(salida).toContain('<dl');
    expect(salida).toContain('Ciudad no publicada');
    expect(salida).toContain('País no publicado');
    expect(salida).toContain('No publicadas');
    expect(salida).toContain('Clasificación parcial');
    expect(salida).not.toContain('bg-accent/40');
  });

  it('país y club quedan bajo el nombre en móvil, y un puesto sin número no pasa a ser cero', () => {
    const salida = html(React.createElement(ClasificacionDePrueba, {
      edicion,
      prueba,
      criterios: { prueba: prueba.id, cursor: '' },
      clasificacion: {
        pruebaId: prueba.id,
        fuente: 'fie',
        siguiente: null,
        otrasFuentes: [],
        filas: [{
          id: 'fila',
          puesto: null,
          puestoPublicado: 'Abandono',
          nombre: ficha.nombre,
          pais: 'ESP',
          club: 'Sala de Armas',
          personaId: null,
        }],
      },
    }));
    expect(salida).toContain('col-start-2');
    expect(salida).toContain('md:col-start-3');
    expect(salida).toContain('Sin puesto numérico');
    expect(salida).toContain('Abandono');
    expect(salida).toContain('Sin ficha deportiva vinculada');
    expect(salida).not.toContain('>0<');
  });
});
