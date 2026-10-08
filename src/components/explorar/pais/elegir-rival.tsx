import Link from 'next/link';
import { clasesChip, FilaChips } from '@/components/sistema/chip-filtro';
import { MenuEnlaces } from './menu-enlaces';

export type OpcionRival = {
  codigo: string;
  nombre: string;
  href: string;
  /** «1.738–3.420»: victorias y derrotas en individual, o encuentros si sólo hay equipos. */
  balance: string;
  /** La bandera, pintada en el servidor. */
  bandera: React.ReactNode;
};

const EN_FILA = 4;

/**
 * Selector del rival desde la ficha del país: un botón que abre la hoja con
 * todos los rivales (con buscador) y, debajo, los que más se han cruzado como
 * atajos. Cada opción es un enlace al cara a cara con los filtros de la ficha.
 */
export function ElegirRival({ opciones }: { opciones: readonly OpcionRival[] }) {
  if (opciones.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <MenuEnlaces
        titulo="Comparar con"
        rotulo="Comparar con otro país"
        elegido={null}
        boton
        mantenerScroll={false}
        buscar={opciones.length > 8}
        opciones={opciones.map((o) => ({ clave: o.codigo, texto: o.nombre, href: o.href, marcado: false, detalle: o.balance, icono: o.bandera }))}
      />
      <FilaChips etiqueta="Rivales más frecuentes">
        {opciones.slice(0, EN_FILA).map((o) => (
          <Link key={o.codigo} href={o.href} prefetch={false} className={clasesChip(false)}>
            {o.bandera}
            <span>{o.nombre}</span>
          </Link>
        ))}
      </FilaChips>
    </div>
  );
}
