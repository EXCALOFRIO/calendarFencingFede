import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Aclaracion, Celda, EnlaceFuente } from '@/components/explorar/piezas';
import { CabeceraFicha, RankingCompacto } from '@/components/explorar/ficha-deportiva';
import { CabeceraCaraACara } from '@/components/explorar/cara-a-cara';
import { ClasificacionDePrueba, EdicionCompleta } from '@/components/explorar/ediciones';
import type { DatosCaraACara } from '@/lib/sport/explorar/cara-a-cara-pantalla';
import { CRITERIOS_CARA_A_CARA_VACIOS } from '@/lib/sport/explorar/cara-a-cara-url';
import type { EdicionDetalle, PruebaDeEdicion } from '@/lib/sport/explorar/edicion-modelo';
import type { FichaDeportiva } from '@/lib/sport/explorar/tipos';
import { UUID_A, UUID_B } from './helpers/explorar';

const html = (nodo: React.ReactElement) => renderToStaticMarkup(nodo);
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
    expect(salida).toMatch(/<summary[^>]*min-h-\[44px\][^>]*focus-visible:ring/);
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
    expect(salida).not.toMatch(/<h1[^>]*(truncate|line-clamp)/);
    // La protección sigue (sin retrato ni enlace FIE), pero ya no se rotula en la cabecera.
    expect(sinDetalles(salida)).not.toContain('Posible menor de edad');
  });

  it('la cabecera omite lo que no se publica y no explica de dónde salen los datos', () => {
    const salida = html(React.createElement(CabeceraFicha, { ficha }));
    expect(salida).not.toMatch(/No publicado|No se muestra|Sobre esta ficha|También publicado como|Foto FIE|<details/);
    expect(salida).not.toMatch(/Año de nacimiento|Club publicado/);
  });

  it('los datos personales salen como pastillas cortas, sin rótulos', () => {
    const salida = html(React.createElement(CabeceraFicha, {
      ficha: { ...ficha, esMenor: false },
      datos: { nombreCompleto: 'Lucía García Fernández', edad: 24, mano: 'L', alturaCm: 171, club: { nombre: null, codigo: 'SAMA-M' } },
    }));
    expect(salida).toContain('Lucía García Fernández');
    expect(salida).toContain('24 años');
    expect(salida).toContain('Zurda');
    expect(salida).toContain('171 cm');
    // El club no se enseña: el de una prueba suelta no es el de la persona.
    expect(salida).not.toContain('SAMA-M');
    expect(salida).not.toMatch(/Altura|Mano|Edad/);
  });

  it('el ranking oficial sólo sale si hay puesto, en una línea con fuente y temporada', () => {
    const conPuesto = html(React.createElement(RankingCompacto, {
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
      nivel: 'pagina',
    }));
    expect(conPuesto).toContain('Ranking internacional');
    expect(conPuesto).toMatch(/>12(<!-- -->)?º</);
    expect(conPuesto).not.toMatch(/Leída el|Qué representa|Modalidad|Ver equipos|de \d+/);
    expect(html(React.createElement(RankingCompacto, { ficha, nivel: 'pagina' }))).toBe('');
  });

  it('enlaces de fuente conservan 44 px también en escritorio y rechazan esquemas inseguros', () => {
    const salida = html(React.createElement(EnlaceFuente, { url: 'https://example.test/lista', etiqueta: 'Fuente' }));
    expect(salida).toContain('min-h-[44px]');
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
    // «Cara a cara» es el rótulo de la cabecera compacta; el h1 (sólo para el lector) son los nombres.
    expect(salida).not.toMatch(/<h1(?! class="sr-only")/);
    expect(salida).toContain('<h1 class="sr-only"');
    expect(salida).toContain(ficha.nombre);
    expect(salida).toContain('Invertir perspectiva');
    expect(salida).toContain('aria-label="Verlo desde Marta Ruiz"');
    // La persona consultada va siempre a la izquierda: su nombre antes que el del rival.
    expect(salida.indexOf(ficha.nombre)).toBeLessThan(salida.indexOf('>Marta Ruiz<'));
  });

  it('la edición no inventa sede ni fechas que no se publicaron y avisa de la clasificación parcial', () => {
    const salida = html(React.createElement(EdicionCompleta, {
      edicion: {
        ...edicion,
        pruebaElegida: prueba.id,
        clasificacion: {
          pruebaId: prueba.id, fuente: 'fie', siguiente: null, otrasFuentes: [],
          filas: [{ id: 'f1', puesto: 1, puestoPublicado: null, nombre: 'Ana', pais: null, club: null, personaId: null }],
        },
      },
      criterios: { prueba: '', cursor: '' },
    }));
    expect(salida).toContain('Campeonato del Mediterráneo');
    expect(salida).toContain('>Florete femenino<');
    expect(salida).toContain('>Absoluto<');
    expect(salida).not.toMatch(/Ciudad no publicada|lucide-map-pin|lucide-calendar-days/);
    expect(salida).toContain('Clasificación parcial');
    expect(salida).not.toContain('bg-accent/40');
  });

  it('sin club bajo el nombre, y un puesto sin número no pasa a ser cero', () => {
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
    expect(salida).toContain('>Abandono<');
    expect(salida).not.toContain('Sala de Armas');
    expect(salida).toContain('Sin puesto numérico');
    // Sin ficha no hay enlace a la persona; la bandera sí lleva a su país.
    expect(salida).not.toMatch(/<a (?![^>]*data-enlace="pais")/);
    expect(salida).not.toContain('>0<');
  });
});
