import { describe, expect, it } from 'vitest';
import {
  CRITERIOS_VACIOS,
  alternarEspana,
  aEntrada,
  chipsActivos,
  construirUrl,
  hayCriterios,
  leerCriterios,
  rutaFicha,
  temporadasOfrecidas,
} from '@/lib/sport/explorar/url';

describe('criterios de Explorar en la URL', () => {
  it('lee los filtros, ignora claves ajenas y toma el primer valor repetido', () => {
    const { criterios, cursor } = leerCriterios({
      q: '  Ana  García ',
      arma: 'florete',
      genero: 'f',
      nacionalidad: 'esp',
      temporada: ['2025-2026', '2024-2025'],
      desde: '2026-01-10',
      hasta: '',
      cursor: 'abc',
      cualquierOtra: 'x',
    });
    expect(criterios).toEqual({
      ...CRITERIOS_VACIOS,
      q: 'Ana García',
      arma: 'FLORETE',
      genero: 'F',
      nacionalidad: 'ESP',
      temporada: '2025-2026',
      desde: '2026-01-10',
    });
    expect(cursor).toBe('abc');
  });

  it('serializa en orden estable, sin claves vacías, y reconstruye lo mismo', () => {
    const criterios = {
      ...CRITERIOS_VACIOS,
      torneo: 'Copa del Mundo',
      arma: 'ESPADA',
      q: 'perez',
    };
    const url = construirUrl(criterios);
    expect(url).toBe('/explorar?q=perez&arma=ESPADA&torneo=Copa+del+Mundo');
    const params = Object.fromEntries(new URL(url, 'http://x').searchParams);
    expect(leerCriterios(params).criterios).toEqual(criterios);
  });

  it('sin criterios la URL es la pantalla limpia', () => {
    expect(construirUrl(CRITERIOS_VACIOS)).toBe('/explorar');
    expect(hayCriterios(CRITERIOS_VACIOS)).toBe(false);
    expect(hayCriterios({ ...CRITERIOS_VACIOS, ambito: 'NACIONAL' })).toBe(true);
  });

  it('el cursor sólo viaja cuando se pide y cambiar un filtro lo descarta', () => {
    const base = { ...CRITERIOS_VACIOS, nacionalidad: 'ESP' };
    expect(construirUrl(base, 'tok')).toBe('/explorar?nacionalidad=ESP&cursor=tok');
    const cambiado = { ...base, arma: 'SABLE' };
    expect(construirUrl(cambiado)).not.toContain('cursor');
  });

  it('la entrada de búsqueda sólo lleva lo rellenado y el cursor', () => {
    const entrada = aEntrada({ ...CRITERIOS_VACIOS, q: 'ana', categoria: 'M17' }, 'tok');
    expect(entrada).toEqual({ q: 'ana', categoria: 'M17', cursor: 'tok' });
    expect(aEntrada(CRITERIOS_VACIOS, undefined)).toEqual({});
  });

  it('el atajo España activa y desactiva sólo la nacionalidad', () => {
    const con = alternarEspana({ ...CRITERIOS_VACIOS, arma: 'SABLE' });
    expect(con).toMatchObject({ nacionalidad: 'ESP', arma: 'SABLE' });
    expect(alternarEspana(con).nacionalidad).toBe('');
    expect(alternarEspana({ ...CRITERIOS_VACIOS, nacionalidad: 'FRA' }).nacionalidad).toBe('ESP');
  });

  it('cada criterio activo tiene un chip que lo quita y conserva los demás', () => {
    const criterios = {
      ...CRITERIOS_VACIOS,
      arma: 'FLORETE',
      desde: '2026-01-10',
      nacionalidad: 'ESP',
    };
    const chips = chipsActivos(criterios);
    expect(chips.map((c) => c.clave)).toEqual(['nacionalidad', 'arma', 'desde']);
    const arma = chips.find((c) => c.clave === 'arma');
    expect(arma).toMatchObject({ etiqueta: 'Arma', valor: 'Florete' });
    expect(arma?.quitar).toBe('/explorar?nacionalidad=ESP&desde=2026-01-10');
  });

  it('la ficha de un deportista se abre por su identificador, no por el nombre', () => {
    expect(rutaFicha('11111111-1111-4111-8111-111111111111')).toBe(
      '/explorar/11111111-1111-4111-8111-111111111111',
    );
  });

  it('las temporadas ofrecidas empiezan en la vigente y cruzan año civil', () => {
    expect(temporadasOfrecidas('2026-10-02', 3)).toEqual(['2026-2027', '2025-2026', '2024-2025']);
    expect(temporadasOfrecidas('2026-03-02', 2)).toEqual(['2025-2026', '2024-2025']);
  });
});
