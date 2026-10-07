import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PuntoEvolucion, TemporadaRendimiento } from '@/lib/sport/explorar/rendimiento';

const { TramosPuestos, contarTramos, frasesTramos, tramoDe } = await import('@/components/explorar/graficos/tramos-puestos');
const f = await import('@/components/explorar/graficos/frases');

const registro = (asaltos: number, victorias: number, dados = asaltos * 4, recibidos = asaltos * 3) => ({
  asaltos, victorias, derrotas: asaltos - victorias, dados, recibidos, porcentaje: asaltos ? victorias / asaltos : null,
});

function temporada(t: string, extra: Partial<TemporadaRendimiento> = {}): TemporadaRendimiento {
  return {
    temporada: t, corta: `${t.slice(2, 4)}-${t.slice(7, 9)}`, internacionales: 0, nacionales: 0,
    competiciones: 0, conPuesto: 0, mejor: null, mediana: null, percentilMediano: null,
    oros: 0, platas: 0, bronces: 0, medallas: 0, finales: 0,
    asaltos: registro(0, 0), poule: registro(0, 0), directa: registro(0, 0),
    ...extra,
  };
}

let n = 0;
function punto(t: string, puesto: number, participantes: number | null = 64): PuntoEvolucion {
  n += 1;
  return {
    pruebaId: `p${n}`, edicionId: null, fecha: `${t.slice(0, 4)}-11-01`, fechaOrden: `${t.slice(0, 4)}-11-01`,
    temporada: t, torneo: `Copa ${n}`, tipo: 'COPA_MUNDO' as never, tono: 'org-fie', ambito: 'internacional',
    categoria: 'ABS', puesto, participantes, percentil: participantes ? puesto / participantes : null,
  };
}

describe('gráfica de tramos de puesto', () => {
  const ts = [temporada('2022-2023'), temporada('2023-2024'), temporada('2024-2025')];
  const puntos = [
    punto('2022-2023', 1), punto('2022-2023', 3), punto('2022-2023', 2), punto('2022-2023', 40),
    punto('2024-2025', 5), punto('2024-2025', 12), punto('2024-2025', 20), punto('2024-2025', 70, 120),
  ];

  it('cuenta cada competición en su tramo y deja la temporada vacía como hueco', () => {
    expect([1, 3, 4, 8, 9, 16, 17, 32, 33].map(tramoDe)).toEqual(['podio', 'podio', 'top8', 'top8', 'top16', 'top16', 'top32', 'top32', 'resto']);
    expect(contarTramos(puntos, ts)).toEqual([
      { podio: 3, top8: 0, top16: 0, top32: 0, resto: 1 },
      { podio: 0, top8: 0, top16: 0, top32: 0, resto: 0 },
      { podio: 0, top8: 1, top16: 1, top32: 1, resto: 1 },
    ]);
  });

  it('explica la gráfica en una o dos frases cortas', () => {
    const frases = frasesTramos(contarTramos(puntos, ts), ts);
    expect(frases).toEqual(['En 24-25 llegó al top 8 en 1 de 4 (25 %).', 'Su mejor temporada: 22-23, con 3 podios.']);
    for (const x of frases) expect(x.length).toBeLessThanOrEqual(70);
  });

  it('pinta una barra por temporada, sin un punto por competición, con resumen accesible', () => {
    const marcado = renderToStaticMarkup(React.createElement(TramosPuestos, { puntos, temporadas: ts }));
    expect(marcado).toContain('role="img"');
    expect(marcado).toContain('Hasta dónde llegó en cada temporada. En total, de 8 competiciones: 3 en el podio, 1 en el top 8, 1 en el top 16, 1 en el top 32, 2 más allá del 32');
    expect(marcado).toContain('2024-2025: 1 en el top 8, 1 en el top 16, 1 en el top 32, 1 más allá del 32');
    for (const r of ['Podio', 'Top 8', 'Top 16', 'Top 32', 'Resto']) expect(marcado).toContain(`>${r}<`);
    expect(marcado.match(/data-lectura=/g)).toHaveLength(2);
  });
});

describe('frases de las gráficas de Estadísticas', () => {
  const ts = [
    temporada('2022-2023', { competiciones: 12, medallas: 2, asaltos: registro(50, 26) }),
    temporada('2023-2024', { competiciones: 8, medallas: 3, asaltos: registro(40, 20) }),
    temporada('2024-2025', { competiciones: 5, asaltos: registro(30, 18), percentilMediano: 0.3 }),
  ];

  it('dicen lo que se ve con números de los datos', () => {
    expect(f.fraseCompeticiones(ts)).toBe('Su temporada más activa: 22-23, con 12 competiciones.');
    expect(f.fraseMedallas(ts, { medallas: 5 } as never)).toBe('Su mejor temporada: 23-24, con 3 medallas.');
    expect(f.fraseAsaltos(ts)).toBe('En 24-25 ganó el 60 % de sus asaltos, más que en 23-24 (50 %).');
    expect(f.fraseTocados(ts)).toBe('En 24-25 dio 4,0 tocados por asalto y recibió 3,0.');
    const puntos = [punto('2024-2025', 9, 33), punto('2024-2025', 17, 33), punto('2024-2025', 25, 33)];
    expect(f.frasePuestoRelativo(ts, puntos)).toBe('En 24-25 suele acabar por delante del 50 % del cuadro.');
    expect(f.fraseMejorGrupo([
      { etiqueta: 'Copa del Mundo', competiciones: 6, asaltos: { asaltos: 40, porcentaje: 0.58 } },
      { etiqueta: 'Satélite', competiciones: 4, asaltos: { asaltos: 30, porcentaje: 0.52 } },
    ])).toBe('Donde más gana: Copa del Mundo, con el 58 % de asaltos.');
  });

  it('no escriben nada si no hay con qué', () => {
    expect(f.fraseMedallas(ts, { medallas: 0 } as never)).toBeNull();
    expect(f.fraseCompeticiones([ts[0]])).toBeNull();
    expect(f.fraseMejorGrupo([{ etiqueta: 'TNR', competiciones: 9, asaltos: { asaltos: 80, porcentaje: 0.5 } }])).toBeNull();
    expect(f.frasePuestoRelativo([temporada('2024-2025')], [])).toBeNull();
  });
});
