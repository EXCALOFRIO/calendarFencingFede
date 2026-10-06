import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PestanaRanking } from '@/components/explorar/ficha-deportiva';
import { RankingAmbitoPerfil } from '@/components/explorar/perfil/ranking-ambito';
import { conClasificacionFie } from '@/components/ranking/armar-ficha';
import { FilaLinea } from '@/components/ranking/fila-linea';
import { chipsRanking } from '@/lib/sport/explorar/chips-ranking';
import { construirBloque, type PuestoInternacional } from '@/lib/sport/explorar/ranking-internacional';
import { bloquesRankingPerfil, conClasificacionVigente, tieneRanking } from '@/lib/sport/explorar/ranking-ambitos';
import type { ResumenMundial } from '@/lib/sport/explorar/ranking-nacional';

const html = (e: React.ReactElement) => renderToStaticMarkup(e);

const puesto = (p: Partial<PuestoInternacional>): PuestoInternacional => ({
  fuente: 'fie_historico', organismo: 'FIE', ambito: 'mundial', temporada: '2022', anioFin: 2022, arma: 'FLORETE', genero: 'M',
  categoria: 'ABS', categoriaRaw: 'S', puesto: 13, puntos: null, de: null, publicadoEl: '2022-07-01', url: null, ...p,
});

const VIGENTE_25: ResumenMundial = {
  vigente: '2027', mejores: [], actuales: [{ arma: 'FLORETE', genero: 'M', categoria: 'ABS', puesto: 25, temporada: '2027' }],
};

describe('pestaña Ranking del perfil: misma fuente que la cabecera', () => {
  it('sin listas por temporada cargadas, la pestaña enseña el puesto vigente de la cabecera', () => {
    const bloque = conClasificacionVigente(null, VIGENTE_25);
    expect(bloque).toMatchObject({ organismos: ['FIE'], vigente: 2027, series: [] });
    const [chip] = chipsRanking({ resumenMundial: VIGENTE_25 });
    expect(bloque?.actual.map((p) => p.puesto)).toEqual([chip.puesto]);
    const b = bloquesRankingPerfil({ resumenMundial: VIGENTE_25, rankingAmbitos: { pais: 'FRA', internacional: null, nacionalFuera: null } });
    expect(b.hay).toBe(true);
    const salida = html(React.createElement(PestanaRanking, { bloques: b, nivel: 'pagina' }));
    expect(salida).toContain('data-bloque-ranking="Internacional"');
    expect(salida).toContain('25º');
    // Sin temporadas no queda una lista vacía con borde.
    expect(salida).not.toContain('aria-label="Temporadas"');
  });

  it('un retirado sin puesto vigente lleva su mejor puesto FIE, el mismo que la cabecera', () => {
    const resumen: ResumenMundial = {
      vigente: '2027', actuales: [], mejores: [
        { arma: 'ESPADA', genero: 'M', categoria: 'M20', puesto: 2, temporada: '2004' },
        { arma: 'ESPADA', genero: 'M', categoria: 'ABS', puesto: 9, temporada: '2009' },
      ],
    };
    const bloque = conClasificacionVigente(null, resumen)!;
    const [chip] = chipsRanking({ resumenMundial: resumen });
    expect([bloque.mejor?.puesto, bloque.mejor?.categoria]).toEqual([chip.puesto, chip.categoria]);
    const salida = html(React.createElement(RankingAmbitoPerfil, { titulo: 'Internacional', bloque, nivel: 'pagina' }));
    expect(salida).toContain('data-mejor-ranking');
    expect(salida).toContain('08-09');
  });

  it('con la lista por temporada sin la vigente se añade el puesto de la clasificación', () => {
    const bloque = construirBloque('mundial', [puesto({})], 2027)!;
    expect(conClasificacionVigente(bloque, VIGENTE_25)?.actual.map((p) => p.puesto)).toEqual([25]);
  });

  it('sin nada de nada no hay pestaña, y la vista de la pestaña vacía es una línea', () => {
    const b = bloquesRankingPerfil({
      rankingAmbitos: { pais: 'ESP', internacional: null, nacionalFuera: null },
      resumenMundial: { vigente: '2027', mejores: [], actuales: [] },
      rankingNacional: { vigente: '2026-2027', temporadas: [], actuales: [], listas: [], mejor: null, top10: 0 },
      rankingMundial: [],
    });
    expect(b).toMatchObject({ hay: false, internacional: null, nacional: null, nacionalFuera: null, mundial: null });
    expect(html(React.createElement(PestanaRanking, { bloques: b, nivel: 'pagina' }))).toBe('<p role="status" class="text-sm text-muted-foreground">Sin puestos en ningún ranking.</p>');
    expect(tieneRanking(construirBloque('mundial', [puesto({ puesto: null })], 2027))).toBe(false);
  });

  it('el extranjero sin federación leída no tiene bloque nacional vacío', () => {
    const b = bloquesRankingPerfil({ resumenMundial: VIGENTE_25, rankingAmbitos: { pais: 'USA', internacional: null, nacionalFuera: null } });
    expect(b.nacionalFuera).toBeNull();
    expect(b.nacional).toBeNull();
  });
});

describe('/ranking: la tarjeta del tirador', () => {
  const vacio = { federacion: 'FIE' as const, etiqueta: 'Internacional', mejor: null };

  it('toma el puesto de la clasificación FIE vigente cruzada por persona, absoluto primero', () => {
    const lado = conClasificacionFie(vacio, [
      { arma: 'FLORETE', genero: 'M', categoria: 'M20', puesto: 3, temporada: '2027' },
      { arma: 'FLORETE', genero: 'M', categoria: 'ABS', puesto: 25, temporada: '2027' },
    ]);
    expect(lado.mejor).toEqual({ etiqueta: 'Florete absoluto', puesto: 25 });
    expect(conClasificacionFie(vacio, [])).toBe(vacio);
  });

  it('los puntos van sin decimales por debajo de 360 px y con ellos por encima', () => {
    const fila = html(React.createElement('ol', null, React.createElement(FilaLinea, { puesto: 3, nombre: 'Carlos Llavador', puntos: 1387.77 })));
    expect(fila).toContain('max-[359px]:hidden">1387,77</span>');
    expect(fila).toContain('min-[360px]:hidden" title="1387,77">1388</span>');
  });
});
