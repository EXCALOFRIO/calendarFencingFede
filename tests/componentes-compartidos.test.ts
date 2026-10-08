import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('lucide-react', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('lucide-react');
});
vi.mock('radix-ui', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('radix-ui');
});
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, replace() {}, back() {}, refresh() {}, prefetch() {} }),
}));

const { Euro } = await import('lucide-react');
const { SelectorSegmentado } = await import('@/components/sistema/selector-segmentado');
const { SelectorNiveles } = await import('@/components/sistema/selector-niveles');
const { Pastilla, PastillaRanking, Puesto, MarcaPropia } = await import('@/components/sistema/pastilla');
const { ListaDatos, ParDato } = await import('@/components/sistema/lista-datos');
const { CabeceraSeccion, VerMas } = await import('@/components/sistema/cabecera-seccion');
const { EstadoVacio } = await import('@/components/sistema/estado-vacio');
const { BloqueFecha } = await import('@/components/sistema/bloque-fecha');
const { Avatar } = await import('@/components/sistema/avatar');
const { FilaPersona } = await import('@/components/sistema/fila-persona');
const { FilaHorario, MarcaDia, horaEnMadrid } = await import('@/components/sistema/hora-doble');
const { BarraFiltros, OpcionesFiltro } = await import('@/components/filtros/barra-filtros');
const { FilaChips, ChipFiltro } = await import('@/components/sistema/chip-filtro');
const { filasSelectorPruebas } = await import('@/lib/sport/selector-pruebas');

const h = React.createElement;
const pintar = (el: React.ReactElement) => renderToStaticMarkup(el);
const SIN_SCROLL = /overflow-x-(auto|scroll)|snap-x/;

const OPCIONES = [
  { valor: 'INDIVIDUAL', etiqueta: 'Individual' },
  { valor: 'EQUIPOS', etiqueta: 'Equipos', cuenta: 4 },
];

describe('SelectorSegmentado', () => {
  it('botones: radiogroup con una sola parada de tabulador', () => {
    const html = pintar(h(SelectorSegmentado, { etiqueta: 'Modalidad', opciones: OPCIONES, valor: 'EQUIPOS', onCambio: () => {} }));
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Modalidad"');
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-checked="true"[^>]*tabindex="0"/);
    expect(html).toMatch(/aria-checked="false"[^>]*tabindex="-1"/);
    expect(html).toContain('auto-fit');
    expect(html).toContain('>4<');
    expect(html).not.toMatch(SIN_SCROLL);
  });

  it('enlaces: nav con aria-current en la activa', () => {
    const html = pintar(
      h(SelectorSegmentado, {
        etiqueta: 'Vista',
        valor: 'mes',
        variante: 'subrayado',
        opciones: [
          { valor: 'mes', etiqueta: 'Mes', href: '/?v=mes' },
          { valor: 'lista', etiqueta: 'Lista', href: '/?v=lista' },
        ],
      }),
    );
    expect(html).toMatch(/^<nav aria-label="Vista"/);
    expect(html).toContain('href="/?v=mes"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).not.toContain('role="radio"');
    expect(html).toContain('transition-[opacity,scale]');
    expect(html).toContain('motion-reduce:transition-none');
  });
});

describe('SelectorNiveles', () => {
  const filas = filasSelectorPruebas(
    [
      { id: 'a', href: '/p/a', arma: 'ESPADA', genero: 'M', categoria: 'ABS' },
      { id: 'b', href: '/p/b', arma: 'FLORETE', genero: 'F', categoria: 'ABS' },
    ],
    'a',
  );
  it('una fila con nombre accesible por dimensión; enlaces si hay href', () => {
    const html = pintar(h(SelectorNiveles, { filas }));
    expect(html).toContain('aria-label="Arma"');
    expect(html).toContain('aria-label="Género"');
    expect(html).toContain('href="/p/b"');
    expect(html).toContain('>Florete<');
    expect(html).toContain('>Masc.<');
  });
  it('con onSeleccion son botones', () => {
    const html = pintar(h(SelectorNiveles, { filas, onSeleccion: () => {} }));
    expect(html).not.toContain('href=');
    expect(html.match(/role="radiogroup"/g)).toHaveLength(2);
  });
});

describe('Pastillas', () => {
  it('dos alturas y sin salto de línea', () => {
    expect(pintar(h(Pastilla, { children: 'Abierta' }))).toMatch(/h-5[^"]*whitespace-nowrap|whitespace-nowrap[^"]*h-5/);
    expect(pintar(h(Pastilla, { tamano: 'md', tono: 'aviso', children: 'x' }))).toContain('h-6');
  });
  it('ranking, puesto y «Tú»', () => {
    const r = pintar(h(PastillaRanking, { fuente: 'FIE', puesto: 126 }));
    expect(r).toContain('FIE #126');
    expect(r).toContain('tabular-nums');
    expect(r).toContain('Puesto 126 del ranking FIE');
    expect(pintar(h(Puesto, { puesto: 1 }))).toContain('Oro, puesto');
    expect(pintar(h(Puesto, { puesto: 9 }))).toContain('Puesto ');
    expect(pintar(h(MarcaPropia))).toContain('>Tú<');
  });
});

describe('ListaDatos', () => {
  it('dt antes de dd y la fuente como botón aparte', () => {
    const html = pintar(
      h(ListaDatos, { disposicion: 'linea' },
        h(ParDato, { etiqueta: 'Inscripción', icono: Euro, fuente: { etiqueta: 'Ver en la convocatoria', href: '#c' }, children: '80 €' })),
    );
    expect(html).toMatch(/^<dl[^>]*data-disposicion="linea"/);
    expect(html.indexOf('<dt')).toBeLessThan(html.indexOf('<dd'));
    expect(html).toMatch(/<span class="[^"]*">80 €<\/span><a[^>]*aria-label="Ver en la convocatoria"/);
  });
});

describe('Cabecera, vacío, fecha y horario', () => {
  it('cabecera con nivel y «Ver más (N)»', () => {
    const html = pintar(h(CabeceraSeccion, { titulo: 'Próximos', nivel: 'seccion', accion: h(VerMas, { href: '/x', cuenta: 12 }) }));
    expect(html).toContain('<h2');
    expect(html).toContain('Ver más (12)');
    expect(pintar(h(VerMas, { href: '/x' }))).toContain('>Ver más<');
  });
  it('estado vacío y error', () => {
    expect(pintar(h(EstadoVacio, { titulo: 'Nada' }))).toContain('role="status"');
    expect(pintar(h(EstadoVacio, { tipo: 'error', titulo: 'Falló' }))).toContain('role="alert"');
  });
  it('bloque de fecha estrecho con el rango entero para el lector', () => {
    const html = pintar(h(BloqueFecha, { desde: '2026-09-30', hasta: '2026-10-02' }));
    expect(html).toMatch(/datetime="2026-09-30"/i);
    expect(html).toContain('30–2');
    expect(html).toContain('SEPT–OCT');
    expect(html).toContain('w-12');
    expect(html).toContain('30 sept–2 oct 2026');
  });
  it('fila de horario con la marca de día', () => {
    const local = horaEnMadrid('2026-10-16', '09:00', 'America/Lima');
    expect(local).toEqual({ hora: '16:00', dias: 0 });
    expect(horaEnMadrid('2026-10-16', '20:00', 'America/Lima')).toEqual({ hora: '03:00', dias: 1 });
    expect(horaEnMadrid('2026-10-16', '09:00', 'Europe/Paris')).toBeNull();
    const html = pintar(h(FilaHorario, { hora: '20:00', titulo: 'Final', local: { hora: '03:00', dias: 1 } }));
    expect(html).toContain('py-3');
    expect(html).toContain('+1 día');
    expect(pintar(h(MarcaDia, { dias: -1 }))).toContain('−1 día');
    expect(pintar(h(MarcaDia, { dias: 0 }))).toBe('');
  });
});

describe('Personas', () => {
  it('iniciales sin persona', () => {
    expect(pintar(h(Avatar, { nombre: 'GARCÍA LÓPEZ, Ana', tamano: 28 }))).toContain('size-7');
  });
  it('con persona delega en FotoDeportista y la caja manda sobre su medida', () => {
    const html = pintar(h(Avatar, { personaId: '11111111-2222-4333-8444-555555555555', nombre: 'Ana García', tamano: 56 }));
    expect(html).toContain('size-14');
    expect(html).toContain('[&amp;_[data-slot=avatar]]:size-full!');
    expect(html).toContain('data-slot="avatar"');
  });
  it('fila con nombre recortado, bandera e insignias a la derecha', () => {
    const html = pintar(
      h(FilaPersona, {
        persona: { nombre: 'Ana García', pais: 'ES' },
        href: '/explorar/deportistas/1',
        propia: true,
        insignias: h(PastillaRanking, { fuente: 'FIE', puesto: 3 }),
      }),
    );
    expect(html).toContain('title="Ana García"');
    expect(html).toContain('href="/explorar/deportistas/1"');
    expect(html).toContain('truncate');
    expect(html).toContain('/banderas/es.png');
    expect(html).toContain('>Tú<');
    expect(html).toMatch(/flex-nowrap items-center justify-end gap-1/);
    expect(html).not.toMatch(SIN_SCROLL);
  });
  it('fila con dos puestos apilados en móvil, foto apagada y atributos del enlace', () => {
    const html = pintar(
      h(FilaPersona, {
        persona: { id: '11111111-2222-4333-8444-555555555555', nombre: 'Ana García' },
        href: '/explorar/1',
        propia: true,
        apilar: true,
        apagado: true,
        enlace: { id: 'fila-ana', 'data-fila': 'ana' },
        insignias: h(React.Fragment, null, h(PastillaRanking, { fuente: 'FIE', puesto: 126 }), h(PastillaRanking, { fuente: 'RFEE', puesto: 2 })),
      }),
    );
    expect(html).toMatch(/data-apiladas="true" class="flex flex-col items-end gap-1 sm:flex-row/);
    expect(html.indexOf('FIE #')).toBeLessThan(html.indexOf('RFEE #'));
    expect(html).toContain('[&amp;_img]:grayscale');
    expect(html).toMatch(/<a [^>]*id="fila-ana"/);
    expect(html).toContain('data-fila="ana"');
  });
  it('fila de equipo conserva el hueco del avatar', () => {
    const html = pintar(h(FilaPersona, { persona: { nombre: 'España' }, equipo: true }));
    expect(html).toContain('size-10');
    expect(html).toContain('lucide-users');
  });
});

describe('Filtros', () => {
  it('barra con botón «Filtros» y chips puestos que saltan de línea', () => {
    const html = pintar(
      h(BarraFiltros, {
        activos: [
          { clave: 'arma', etiqueta: 'Espada', onQuitar: () => {} },
          { clave: 'cat', etiqueta: 'M17', onQuitar: () => {} },
        ],
        resultados: 'Ver 12',
        onLimpiar: () => {},
        children: h(OpcionesFiltro, { titulo: 'Arma', valor: 'ESPADA', opciones: [{ valor: 'ESPADA', etiqueta: 'Espada' }], onCambio: () => {} }),
      }),
    );
    expect(html).toContain('Filtros');
    expect(html).toContain('aria-label="Quitar Espada"');
    expect(html).toContain('aria-label="Quitar M17"');
    expect(html).toContain('Quitar todos');
    expect(html).toContain('flex-wrap');
    expect(html).not.toMatch(SIN_SCROLL);
  });
  it('FilaChips salta de línea por defecto', () => {
    const html = pintar(h(FilaChips, { etiqueta: 'x', children: h(ChipFiltro, { children: 'A' }) }));
    expect(html).toContain('flex-wrap');
    expect(html).not.toMatch(SIN_SCROLL);
  });
});
