import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { AREA_TACTIL, FOCO } from '@/components/sistema/tactil';
import { nombrePaisFie, paisParaBandera } from '@/lib/sport/explorar/pais-codigos';
import { COLOR_MEDALLA, type Medalla } from '@/lib/sport/explorar/presentacion';
import { cn } from '@/lib/utils';

/** Piezas comunes de la ficha de país y del cara a cara de selecciones. */

export function Bandera({ codigo, className }: { codigo: string; className?: string }) {
  return <BanderaPais pais={paisParaBandera(codigo)} tamaño="ficha" soloBandera className={className} />;
}

/** El país con su bandera y su código, para filas y chips. */
export function PaisCorto({ codigo }: { codigo: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-[6px]">
      <Bandera codigo={codigo} />
      <span className="truncate">{nombrePaisFie(codigo)}</span>
    </span>
  );
}

export function TituloSeccion({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-[16px] leading-[20px] font-semibold">
      {children}
    </h2>
  );
}

/** Frases que cuentan los datos; ninguna si no hay nada que contar. */
export function Frases({ frases }: { frases: readonly string[] }) {
  if (frases.length === 0) return null;
  return (
    <ul className="flex flex-col gap-[6px] text-[14px] leading-[20px] text-foreground">
      {frases.map((f) => (
        <li key={f}>{f}</li>
      ))}
    </ul>
  );
}

export function PuntoMedalla({ medalla, className }: { medalla: Medalla; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-[10px] shrink-0 rounded-full', className)}
      style={{ backgroundColor: COLOR_MEDALLA[medalla] }}
    />
  );
}

/** Cifra con su rótulo debajo, en una baldosa. */
export function Baldosa({ valor, rotulo, medalla }: { valor: string; rotulo: string; medalla?: Medalla }) {
  return (
    <div className="flex min-w-0 flex-col gap-[2px] rounded-[12px] bg-card px-[12px] py-[10px]">
      <span className="cifra flex items-center gap-[6px] text-[28px] leading-[32px] tabular-nums">
        {medalla ? <PuntoMedalla medalla={medalla} /> : null}
        {valor}
      </span>
      <span className="truncate text-[12px] leading-[16px] text-muted-foreground">{rotulo}</span>
    </div>
  );
}

/** Estados sin datos de las dos pantallas: un título corto y una línea. */
export function EstadoPais({ titulo, linea, volver }: { titulo: string; linea: string; volver?: { href: string; texto: string } }) {
  return (
    <div className="flex flex-col items-start gap-[8px] rounded-[12px] bg-card px-[16px] py-[20px]">
      <p className="text-[16px] leading-[20px] font-semibold">{titulo}</p>
      <p className="text-[14px] leading-[20px] text-muted-foreground">{linea}</p>
      {volver ? (
        <Link
          href={volver.href}
          className={cn('mt-[4px] inline-flex h-[32px] items-center rounded-full bg-secondary px-[14px] text-[13px] font-medium', AREA_TACTIL, FOCO)}
        >
          {volver.texto}
        </Link>
      ) : null}
    </div>
  );
}

/** Fecha corta en español («12 oct 2026»), siempre con año: son históricos. */
export function fechaCorta(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(d)
    .replace(/\./g, '');
}
