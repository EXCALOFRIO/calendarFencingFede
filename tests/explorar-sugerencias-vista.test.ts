import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import type { KeyboardEvent, ChangeEvent } from 'react';

// Ejercita el árbol y los manejadores del componente, no un navegador/DOM.
// Los efectos de red se cubren por separado con temporizadores y AbortSignal.
const arnes = vi.hoisted(() => ({
  cursor: 0, celdas: [] as unknown[], push: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: arnes.push }) }));
vi.mock('react', async (importOriginal) => {
  const real = await importOriginal<typeof import('react')>();
  return {
    ...real,
    useState: <T,>(inicial: T | (() => T)) => {
      const indice = arnes.cursor++;
      if (!(indice in arnes.celdas)) arnes.celdas[indice] = typeof inicial === 'function' ? (inicial as () => T)() : inicial;
      return [arnes.celdas[indice], (valor: T | ((anterior: T) => T)) => {
        arnes.celdas[indice] = typeof valor === 'function'
          ? (valor as (anterior: T) => T)(arnes.celdas[indice] as T) : valor;
      }];
    },
    useRef: <T,>(inicial: T) => {
      const indice = arnes.cursor++;
      if (!(indice in arnes.celdas)) arnes.celdas[indice] = { current: inicial };
      return arnes.celdas[indice];
    },
    useEffect: () => {},
  };
});
vi.mock('@/components/ui/button', () => ({ Button: 'button' }));
vi.mock('@/components/ui/input', () => ({ Input: 'input' }));
vi.mock('@/components/ui/label', () => ({ Label: 'label' }));
import { BuscadorPersonas } from '@/components/explorar/buscador-personas';
import { rutaFicha } from '@/lib/sport/explorar/url';
import { UUID_A as A, UUID_B as B } from './helpers/explorar';

type Nodo = React.ReactElement<Record<string, unknown>>;
function recorrer(nodo: React.ReactNode, salida: Nodo[] = []): Nodo[] {
  if (React.isValidElement<Record<string, unknown>>(nodo)) {
    salida.push(nodo);
    React.Children.toArray(nodo.props.children as React.ReactNode).forEach((hijo) => recorrer(hijo, salida));
  }
  return salida;
}
const por = (arbol: Nodo[], clave: string, valor: unknown) => {
  const nodo = arbol.find((n) => n.props[clave] === valor);
  if (!nodo) throw new Error(`Nodo no encontrado: ${clave}`);
  return nodo;
};
function tecla(nodo: Nodo, key: string, isComposing = false) {
  const preventDefault = vi.fn();
  (nodo.props.onKeyDown as (e: KeyboardEvent<HTMLInputElement>) => void)(
    { key, preventDefault, nativeEvent: { isComposing } } as unknown as KeyboardEvent<HTMLInputElement>,
  );
  return preventDefault;
}

beforeEach(() => { arnes.cursor = 0; arnes.celdas = []; arnes.push.mockReset(); });
function campo(valor = 'carlos', cambiar = vi.fn()) {
  arnes.cursor = 0;
  return { arbol: recorrer(BuscadorPersonas({ valor, onChange: cambiar })), cambiar };
}
function abierto() {
  const primero = campo();
  (por(primero.arbol, 'role', 'combobox').props.onFocus as () => void)();
  // Resultado controlado del solicitante. Ref, ref, foco, cerrado, activo, resultado.
  arnes.celdas[5] = {
    estado: 'ok', items: [
      { id: A, nombre: 'Carlos Llavador', alias: null, pais: 'ESP', genero: 'M', anioNacimiento: 1998 },
      { id: B, nombre: 'Carlos Llavador', alias: null, pais: 'FRA', genero: 'M', anioNacimiento: 2001 },
    ],
  };
  return campo().arbol;
}

describe('combobox de personas: manejadores y contrato accesible sin browser', () => {
  it('expone etiqueta, formulario GET compatible, nombre q, ayudas, foco y objetivos de 44 px', () => {
    const { arbol } = campo();
    const entrada = por(arbol, 'role', 'combobox');
    expect(entrada.props).toMatchObject({
      id: 'explorar-q', name: 'q', type: 'search', maxLength: 80,
      'aria-expanded': false, 'aria-autocomplete': 'list',
      'aria-describedby': 'explorar-q-ayuda explorar-q-estado',
    });
    expect(por(arbol, 'htmlFor', 'explorar-q').props.children).toBe('Nombre o alias');
    expect(String(entrada.props.className)).toContain('min-h-11');
    expect(String(por(arbol, 'aria-label', 'Borrar nombre').props.className)).toContain('min-w-11');
    expect(por(arbol, 'id', 'explorar-q-estado').props).toMatchObject({ role: 'status', 'aria-live': 'polite' });
    expect(String(por(arbol, 'id', 'explorar-q-ayuda').props.children)).toContain('no una confirmación de identidad');
  });

  it('listbox/options no generan pestañas extra y los homónimos mantienen metadatos distintos', () => {
    const arbol = abierto();
    expect(por(arbol, 'role', 'combobox').props['aria-expanded']).toBe(true);
    expect(por(arbol, 'role', 'listbox').props.id).toBe('explorar-sugerencias');
    const opciones = arbol.filter((n) => n.props.role === 'option');
    expect(opciones).toHaveLength(2);
    for (const opcion of opciones) {
      expect(opcion.props.tabIndex).toBe(-1);
      expect(String(opcion.props.className)).toContain('min-h-11');
    }
    const texto = arbol.flatMap((n) => React.Children.toArray(n.props.children as React.ReactNode)).filter((h) => typeof h === 'string').join(' ');
    expect(texto).toContain('ESP');
    expect(texto).toContain('FRA');
  });

  it('Intro sin opción no impide búsqueda ordinaria; las flechas activan e Intro abre la ficha canónica', () => {
    let arbol = abierto();
    expect(tecla(por(arbol, 'role', 'combobox'), 'Enter')).not.toHaveBeenCalled();
    expect(arnes.push).not.toHaveBeenCalled();
    arnes.celdas[3] = false;
    arbol = campo().arbol;
    expect(tecla(por(arbol, 'role', 'combobox'), 'ArrowUp')).toHaveBeenCalledTimes(1);
    arbol = campo().arbol;
    expect(por(arbol, 'role', 'combobox').props['aria-activedescendant']).toBe('explorar-sugerencia-1');
    expect(tecla(por(arbol, 'role', 'combobox'), 'Enter')).toHaveBeenCalledTimes(1);
    expect(arnes.push).toHaveBeenCalledWith(rutaFicha(B));
    expect(por(campo().arbol, 'role', 'combobox').props['aria-expanded']).toBe(false);
  });

  it('Escape cierra, la composición no navega y Borrar conserva el foco y vacía el campo', () => {
    const arbol = abierto();
    expect(tecla(por(arbol, 'role', 'combobox'), 'ArrowDown', true)).not.toHaveBeenCalled();
    expect(arnes.celdas[4]).toBe(-1);
    expect(tecla(por(arbol, 'role', 'combobox'), 'Escape')).toHaveBeenCalledTimes(1);
    expect(por(campo().arbol, 'role', 'combobox').props['aria-expanded']).toBe(false);
    const focus = vi.fn();
    (arnes.celdas[0] as { current: unknown }).current = { focus };
    const cambiar = vi.fn();
    (por(campo('carlos', cambiar).arbol, 'aria-label', 'Borrar nombre').props.onClick as () => void)();
    expect(cambiar).toHaveBeenCalledWith('');
    expect(focus).toHaveBeenCalledTimes(1);
    expect(arnes.celdas[4]).toBe(-1);
  });

  it('editar descarta resultados antes del próximo efecto y un fallo muestra cómo seguir buscando', () => {
    abierto();
    const cambiar = vi.fn();
    const entrada = por(campo('carlos', cambiar).arbol, 'role', 'combobox');
    (entrada.props.onChange as (e: ChangeEvent<HTMLInputElement>) => void)({
      target: { value: 'mateo' },
    } as ChangeEvent<HTMLInputElement>);
    expect(cambiar).toHaveBeenCalledWith('mateo');
    expect(arnes.celdas[5]).toEqual({ estado: 'reposo', items: [] });
    arnes.celdas[5] = { estado: 'error', items: [] };
    expect(String(por(campo('mateo').arbol, 'id', 'explorar-q-estado').props.children)).toContain('Puedes pulsar Buscar');
  });
});
