import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CabeceraFicha } from '@/components/explorar/ficha-deportiva';
import { CifrasPerfil } from '@/components/explorar/perfil/cifras-perfil';
import { ManoAMano } from '@/components/explorar/perfil/rivales-perfil';
import { AnioAAnio, serieTemporadas } from '@/components/explorar/perfil/temporadas-perfil';
import type { FilaAgregadoEstadistico } from '@/lib/sport/explorar/estadisticas';
import {
  clubLegible,
  construirPerfil,
  enlaceFie,
  esCodigoClub,
  etiquetaTemporadaDeportiva,
  porcentajeVictorias,
  temporadaDeportiva,
  temporadasPerfil,
  type FilasPerfil,
} from '@/lib/sport/explorar/perfil-modelo';
import type { FilaBalanceAsaltos } from '@/lib/sport/explorar/perfil-sql';
import type { FichaDeportiva } from '@/lib/sport/explorar/tipos';
import type { FichaConPerfil } from '@/lib/sport/explorar/tipos-perfil';
import { UUID_A, UUID_B } from './helpers/explorar';

const agregado = (extra: Partial<FilaAgregadoEstadistico>): FilaAgregadoEstadistico =>
  ({
    clase: 'total',
    tipo: null,
    categoria: null,
    arma: null,
    temporada: null,
    pruebas: 0,
    clasificaciones: 0,
    mejorPuesto: null,
    podios: 0,
    victorias: 0,
    platas: 0,
    bronces: 0,
    finales: 0,
    sinPuestoNumerico: 0,
    ...extra,
  }) as FilaAgregadoEstadistico;

const asalto = (extra: Partial<FilaBalanceAsaltos>): FilaBalanceAsaltos =>
  ({
    clase: 'total',
    fase: null,
    temporada: null,
    asaltos: 0,
    victorias: 0,
    derrotas: 0,
    empates: 0,
    tocadosDados: 0,
    tocadosRecibidos: 0,
    ...extra,
  }) as FilaBalanceAsaltos;

const filasVacias = (extra: Partial<FilasPerfil> = {}): FilasPerfil => ({
  estadisticas: [],
  asaltos: [],
  rivales: [],
  clubes: [],
  idsFie: [],
  mejorRanking: [],
  ...extra,
});

const fichaBase = (extra: Partial<FichaDeportiva> = {}): FichaDeportiva => ({
  id: UUID_A,
  nombre: 'PEREZ Ana',
  alias: [],
  pais: 'FRA',
  genero: 'F',
  anioNacimiento: 1990,
  esMenor: false,
  esPropia: false,
  estadisticas: { conjunto: 'clasificaciones_individuales', porTipo: [] },
  cobertura: { resultadosImportados: 0, pruebasConResultado: 0, ediciones: 0, lecturas: [], historiaCompleta: false },
  rankingOficial: { temporada: null, formato: 'INDIVIDUAL', temporadasDisponibles: [], entradas: [] },
  ...extra,
});

describe('reglas del perfil', () => {
  it('la temporada FIE AAAA es la deportiva AAAA-1-AAAA y se etiqueta corta', () => {
    expect(temporadaDeportiva('2025')).toBe('2024-2025');
    expect(temporadaDeportiva('2024-2025')).toBe('2024-2025');
    expect(etiquetaTemporadaDeportiva('2024-2025')).toBe('2024-25');
    expect(etiquetaTemporadaDeportiva('otra')).toBe('otra');
  });

  it('un código de Skermo no se presenta como club; el primer nombre legible sí', () => {
    expect(esCodigoClub('FED-M-C')).toBe(true);
    expect(esCodigoClub('100TO-C')).toBe(true);
    expect(esCodigoClub('Club Esgrima Madrid')).toBe(false);
    expect(
      clubLegible([
        { club: 'FED-M-C', fuente: 'skermo', fecha: '2026-03-01' },
        { club: '  Sala   de Armas  Valencia ', fuente: 'rfee', fecha: '2026-01-10' },
      ]),
    ).toEqual({ nombre: 'Sala de Armas Valencia', fuente: 'rfee', fecha: '2026-01-10' });
    expect(clubLegible([{ club: 'FED-M-C', fuente: 'skermo', fecha: null }])).toBeNull();
  });

  it('el enlace FIE exige un único ID válido y nunca sale para un posible menor', () => {
    expect(enlaceFie([{ valor: '12345' }], false)).toBe('https://fie.org/athletes/12345');
    expect(enlaceFie([{ valor: '12345' }], true)).toBeNull();
    expect(enlaceFie([{ valor: '1' }, { valor: '2' }], false)).toBeNull();
    expect(enlaceFie([{ valor: '../x' }], false)).toBeNull();
    expect(enlaceFie([], false)).toBeNull();
  });

  it('sin asaltos decididos no hay porcentaje (no es 0 %)', () => {
    expect(porcentajeVictorias({ victorias: 0, derrotas: 0 })).toBeNull();
    expect(porcentajeVictorias(null)).toBeNull();
    expect(porcentajeVictorias({ victorias: 2, derrotas: 1 })).toBe(67);
  });

  it('junta la temporada FIE y la RFEE equivalente y ordena de más reciente a más antigua', () => {
    const t = temporadasPerfil(
      [
        agregado({ clase: 'temporada', temporada: '2025', pruebas: 2, clasificaciones: 2, mejorPuesto: 5, finales: 1 }),
        agregado({ clase: 'temporada', temporada: '2024-2025', pruebas: 3, clasificaciones: 3, mejorPuesto: 2, platas: 1, finales: 1 }),
        agregado({ clase: 'temporada', temporada: '2023-2024', pruebas: 1, clasificaciones: 1, mejorPuesto: 12 }),
      ],
      [asalto({ clase: 'temporada', temporada: '2024-2025', asaltos: 4, victorias: 3, derrotas: 1 })],
    );
    expect(t.map((x) => x.temporada)).toEqual(['2024-2025', '2023-2024']);
    expect(t[0]).toMatchObject({ pruebas: 5, conPuesto: 5, mejorPuesto: 2, medallero: { platas: 1, finales: 2 } });
    expect(t[0].asaltos).toMatchObject({ asaltos: 4, victorias: 3 });
    expect(t[1].asaltos).toBeNull();
  });

  it('construirPerfil distingue fallo de consulta (null) de ausencia ([])', () => {
    const fallo = construirPerfil(filasVacias({ asaltos: null, rivales: null }), fichaBase());
    expect(fallo.asaltos).toBeNull();
    expect(fallo.rivales).toBeNull();
    const vacio = construirPerfil(filasVacias(), fichaBase());
    expect(vacio.asaltos?.total.asaltos).toBe(0);
    expect(vacio.rivales).toEqual([]);
    expect(vacio.ranking).toEqual({ actual: null, mejor: null });
  });

  it('las armas salen de más a menos pruebas y el resumen lleva el medallero', () => {
    const p = construirPerfil(
      filasVacias({
        estadisticas: [
          agregado({ clase: 'total', pruebas: 9, clasificaciones: 9, mejorPuesto: 1, victorias: 1, platas: 2, bronces: 3, finales: 6 }),
          agregado({ clase: 'categoria', arma: 'SABLE', pruebas: 2 }),
          agregado({ clase: 'categoria', arma: 'ESPADA', pruebas: 7 }),
        ],
      }),
      fichaBase(),
    );
    expect(p.armas).toEqual(['ESPADA', 'SABLE']);
    expect(p.resumen).toEqual({ pruebas: 9, conPuesto: 9, mejorPuesto: 1, oros: 1, platas: 2, bronces: 3, finales: 6 });
  });
});

const perfilCompleto = () =>
  construirPerfil(
    filasVacias({
      estadisticas: [
        agregado({ clase: 'total', pruebas: 4, clasificaciones: 4, mejorPuesto: 2, platas: 1, finales: 2 }),
        agregado({ clase: 'categoria', arma: 'FLORETE', pruebas: 4 }),
        agregado({ clase: 'temporada', temporada: '2025', pruebas: 3, clasificaciones: 3, mejorPuesto: 2 }),
        agregado({ clase: 'temporada', temporada: '2024', pruebas: 1, clasificaciones: 1, mejorPuesto: 9 }),
      ],
      asaltos: [
        asalto({ clase: 'total', asaltos: 10, victorias: 6, derrotas: 4, tocadosDados: 40, tocadosRecibidos: 30 }),
        asalto({ clase: 'fase', fase: 'POULE', asaltos: 6, victorias: 4, derrotas: 2 }),
        asalto({ clase: 'fase', fase: 'TABLEAU', asaltos: 4, victorias: 2, derrotas: 2 }),
        asalto({ clase: 'temporada', temporada: '2025', asaltos: 6, victorias: 4, derrotas: 2 }),
        asalto({ clase: 'temporada', temporada: '2024', asaltos: 4, victorias: 2, derrotas: 2 }),
      ],
      rivales: [
        {
          id: UUID_B,
          nombreRival: 'MARTIN Laura',
          paisRival: 'ITA',
          asaltos: 3,
          victorias: 2,
          derrotas: 1,
          ultimaFecha: '2025-03-02',
          ultimoFavor: 15,
          ultimoContra: 12,
          ultimoTorneo: 'Copa del Mundo',
        },
      ],
      clubes: [{ club: 'Cercle d\'Escrime de Paris', fuente: 'fie_tiradores', fecha: '2025-03-02' }],
      idsFie: [{ valor: '4242' }],
    }),
    fichaBase(),
  );

describe('vistas del perfil', () => {
  it('la cabecera de un adulto enseña armas, edad y enlace FIE, nunca el club; la de un menor no', () => {
    const adulto: FichaConPerfil = { ...fichaBase(), perfil: perfilCompleto() };
    const html = renderToStaticMarkup(React.createElement(CabeceraFicha, { ficha: adulto }));
    expect(html).toContain('Ana Perez');
    expect(html).toContain('Florete');
    expect(html).not.toMatch(/Cercle d(&#x27;|')Escrime de Paris/i);
    expect(html).toMatch(new RegExp(`>${new Date().getFullYear() - 1990}(<!-- -->)? años<`));
    expect(html).toContain('https://fie.org/athletes/4242');
    expect(html).toContain('Cara a cara');

    const perfilMenor = construirPerfil(filasVacias({ idsFie: [{ valor: '4242' }] }), { esMenor: true, rankingOficial: fichaBase().rankingOficial });
    const menor: FichaConPerfil = { ...fichaBase({ esMenor: true, anioNacimiento: null }), perfil: perfilMenor };
    const salida = renderToStaticMarkup(React.createElement(CabeceraFicha, { ficha: menor }));
    expect(salida).not.toContain('fie.org/athletes');
    // La única imagen permitida es la bandera del país.
    expect(salida).not.toMatch(/<img(?![^>]*\/banderas\/)/);
    expect(salida).not.toContain('1990');
    expect(salida).not.toContain('Posible menor de edad');
  });

  it('las cifras enseñan balance y porcentaje sólo con asaltos, y «sin dato» cuando faltan', () => {
    const html = renderToStaticMarkup(React.createElement(CifrasPerfil, { perfil: perfilCompleto() }));
    expect(html).toMatch(/>10</);
    expect(html).toContain('6 V · 4 D');
    expect(html).toMatch(/>67<span[^>]*>%/);
    expect(html).toMatch(/>50<span[^>]*>%/);
    const vacio = renderToStaticMarkup(
      React.createElement(CifrasPerfil, { perfil: construirPerfil(filasVacias(), fichaBase()) }),
    );
    expect(vacio).not.toMatch(/0\s*%/);
  });

  it('año a año dibuja una barra por temporada y no inventa gráfica sin datos', () => {
    const p = perfilCompleto();
    expect(serieTemporadas(p.temporadas)).toEqual({
      medida: 'victorias',
      puntos: [
        { temporada: '2023-2024', valor: 50, texto: '50%' },
        { temporada: '2024-2025', valor: 67, texto: '67%' },
      ],
    });
    const html = renderToStaticMarkup(React.createElement(AnioAAnio, { perfil: p, nivel: 'pagina' }));
    expect(html).toContain('Año a año');
    expect(html).toContain('2024-25');
    expect(html).toContain('<svg');
    const vacio = construirPerfil(filasVacias(), fichaBase());
    expect(serieTemporadas(vacio.temporadas)).toBeNull();
    expect(renderToStaticMarkup(React.createElement(AnioAAnio, { perfil: vacio, nivel: 'pagina' }))).not.toContain('<svg');
  });

  it('mano a mano enlaza al cara a cara con el rival elegido y distingue fallo de vacío', () => {
    const html = renderToStaticMarkup(
      React.createElement(ManoAMano, { personaId: UUID_A, nombre: 'PEREZ Ana', perfil: perfilCompleto(), nivel: 'pagina' }),
    );
    expect(html).toContain(`rival=${UUID_B}`);
    expect(html).toContain('Laura Martin');
    expect(html).toContain('2–1');

    const fallo = renderToStaticMarkup(
      React.createElement(ManoAMano, {
        personaId: UUID_A,
        nombre: 'PEREZ Ana',
        perfil: construirPerfil(filasVacias({ rivales: null }), fichaBase()),
        nivel: 'pagina',
      }),
    );
    expect(fallo).toContain('role="alert"');
    expect(fallo).not.toContain('Sin asaltos importados');
  });
});
