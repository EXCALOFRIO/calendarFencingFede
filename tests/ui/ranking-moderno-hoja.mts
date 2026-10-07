/**
 * La hoja de filtros de /ranking abierta, para `ranking-moderno.mts`
 * (`$env:EXTRA='tests/ui/ranking-moderno-hoja.mts'`). Radix no pinta el portal
 * sin navegador, así que se pinta el cuerpo de la hoja en un marco con las
 * mismas clases que la `HojaInferior` del sistema.
 */
import React from 'react';
import { CuerpoHojaFiltros, OpcionesFiltro, PieHojaFiltros } from '@/components/filtros/chips';
import { ContenidoHoja } from '@/components/ranking/selectores-grupo';
import { ChipFiltro } from '@/components/sistema/chip-filtro';

type Documento = (cuerpo: React.ReactElement, consulta: string) => string;

export async function paginasExtra(documento: Documento) {
  const nada = () => {};
  const h = React.createElement;
  const hoja = h('div', { className: 'relative min-h-[760px]' },
    h('div', { className: 'fixed inset-0 bg-velo' }),
    h('div', {
      'data-slot': 'sistema-hoja',
      className: 'fixed inset-x-0 bottom-0 z-50 flex max-h-[min(88dvh,calc(100dvh-48px))] flex-col rounded-t-[16px] border-t border-filete-alto bg-popover text-popover-foreground sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[440px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[16px] sm:border',
    },
    h('div', { 'aria-hidden': true, className: 'mx-auto mt-[8px] h-[4px] w-[36px] rounded-full bg-muted-foreground sm:hidden' }),
    h('div', { className: 'grid h-[44px] place-items-center text-[16px] font-semibold sm:h-[52px]' }, 'Filtros'),
    h('div', { className: 'min-h-0 flex-1 overflow-y-auto px-[16px] pb-[16px]' },
      h(CuerpoHojaFiltros, null,
        h(OpcionesFiltro, {
          titulo: 'Clasificación', valor: 'INDIVIDUAL', onCambio: nada,
          opciones: [{ valor: 'INDIVIDUAL', etiqueta: 'Individual' }, { valor: 'EQUIPOS', etiqueta: 'Selecciones' }],
        }),
        h(ContenidoHoja, {
          antes: null,
          chips: h(ChipFiltro, { marcado: true, contador: 45, children: 'Solo España' }),
          grupo: { weapon: 'FLORETE', gender: 'M', category: 'ABS' },
          armas: ['ESPADA', 'FLORETE', 'SABLE'],
          generos: ['M', 'F'],
          categorias: ['ABS', 'M20', 'M17'],
          onElegir: nada,
        }))),
    h('div', { className: 'shrink-0 border-t border-filete px-[16px] py-[12px]' },
      h(PieHojaFiltros, { resultados: 'Ver 45 tiradores', onLimpiar: nada, onCerrar: nada }))));
  return [{ nombre: 'ranking-hoja-filtros', html: documento(hoja, '') }];
}
