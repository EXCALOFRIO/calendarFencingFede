'use client';

import { CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import type { CompeticionElegible } from '@/app/(app)/estado/consultas';
import { Button } from '@/components/ui/button';
import {
  CATEGORY_LABEL,
  GENDER_LABEL,
  WEAPON_LABEL,
  cn,
  formatDateRangeEs,
  formatEur,
  titular,
} from '@/lib/utils';
import { Rotulos, Seccion, tamanoCifra } from './piezas';

export type Solicitar = (
  competitionId: string,
  athleteId: string,
) => Promise<{ ok: true; message: string } | { ok: false; error: string }>;

/** El semáforo de plazos, con su palabra: el color nunca va solo. */
const TONO = {
  verde: 'text-ok',
  ambar: 'text-warn',
  rojo: 'text-danger',
  cerrado: 'text-muted-foreground',
  sin_datos: 'text-muted-foreground',
} as const;

/**
 * «Todavía no te has inscrito».
 *
 * La pregunta que esta aplicación no sabía contestar: no «cómo va lo que
 * pedí» sino «qué me estoy perdiendo». Salen solo las pruebas de su arma, su
 * género y su categoría con el plazo abierto, ordenadas por la que antes
 * cierra, y con la cuenta atrás en grande porque esa es la única cifra que
 * hace que alguien actúe hoy en vez de la semana que viene.
 *
 * La solicitud se hace desde aquí mismo. Obligar a abrir el calendario,
 * buscar el torneo y desplegar la ficha para pedir algo que la aplicación ya
 * sabe que te corresponde es tres clics de más.
 */
export function SinInscribir({
  competiciones,
  solicitar,
  conNombre,
  hayTiradorSinArma,
}: {
  competiciones: CompeticionElegible[];
  solicitar: Solicitar;
  /** El nombre del tirador solo hace falta si se están viendo varios. */
  conNombre: boolean;
  /** Sin arma ni categoría no se puede decidir nada, y hay que decirlo. */
  hayTiradorSinArma: boolean;
}) {
  return (
    <Seccion
      titulo="Todavía no te has inscrito"
      contexto={
        competiciones.length > 0
          ? `${competiciones.length} con el plazo abierto`
          : undefined
      }
    >
      {competiciones.length > 0 ? (
        <ul className="flex flex-col divide-y">
          {competiciones.map((c) => (
            <FilaElegible
              key={`${c.athleteId}-${c.competitionId}`}
              competicion={c}
              solicitar={solicitar}
              conNombre={conNombre}
            />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-start gap-3 py-4">
          <p className="medida text-sm text-muted-foreground">
            {hayTiradorSinArma
              ? 'Para saber en qué competiciones puedes entrar hace falta tener ' +
                'un arma y una categoría en la ficha. En cuanto estén, aquí ' +
                'aparecerá cada prueba que te corresponda con los días que ' +
                'quedan de plazo.'
              : 'No queda ninguna prueba de tu arma y tu categoría con el plazo ' +
                'abierto a la que no te hayas apuntado ya. Aquí aparecerán en ' +
                'cuanto se abra la inscripción de la siguiente.'}
          </p>
          <Button variant="outline" asChild>
            <Link href="/">Ver el calendario completo</Link>
          </Button>
        </div>
      )}
    </Seccion>
  );
}

function FilaElegible({
  competicion: c,
  solicitar,
  conNombre,
}: {
  competicion: CompeticionElegible;
  solicitar: Solicitar;
  conNombre: boolean;
}) {
  const router = useRouter();
  const [enviando, empezar] = React.useTransition();
  const [aviso, setAviso] = React.useState<{
    ok: boolean;
    texto: string;
  } | null>(null);

  const categoria =
    CATEGORY_LABEL[c.category as keyof typeof CATEGORY_LABEL] ?? c.category;
  const estimado = c.estado.next?.origin === 'CALCULADO';

  return (
    <li className="flex gap-4 py-4">
      {/* La cuenta atrás manda. Es la razón entera de que esta sección
          exista, así que es lo único grande de la fila. */}
      <div className="w-20 shrink-0">
        <span
          className={cn(
            'cifra block',
            tamanoCifra(c.diasRestantes),
            TONO[c.estado.state],
          )}
        >
          {c.diasRestantes}
        </span>
        <span className="mt-1 block text-xs leading-tight text-muted-foreground">
          {c.diasRestantes === 1 ? 'día para' : 'días para'} inscribirte
          {estimado ? ' (estimado)' : ''}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <h3 className="text-lg">{titular(c.eventName)}</h3>

        <Rotulos
          disposicion="linea"
          datos={[
            ['Cuándo', formatDateRangeEs(c.startDate, c.endDate)],
            ['Dónde', c.city ? titular(c.city) : 'sin sede publicada'],
            ['Prueba', `${WEAPON_LABEL[c.weapon]} ${GENDER_LABEL[c.gender]}`],
            ['Categoría', categoria],
            ['Cuota', formatEur(c.feeEur)],
            ...(conNombre
              ? ([['Tirador', c.athleteName]] as [string, string][])
              : []),
          ]}
        />

        {aviso ? (
          <p
            className={cn('text-sm', aviso.ok ? 'text-ok' : 'text-danger')}
            role="status"
          >
            {aviso.ok ? (
              <CircleCheck className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />
            ) : null}
            {aviso.texto}
          </p>
        ) : (
          /*
            Sin relleno carmesí: son seis botones iguales en una lista, y la
            acción principal de la pantalla es una sola. La urgencia ya la da
            la cuenta atrás de la izquierda; si además cada fila gritase en
            rojo no habría forma de saber cuál corre prisa.
          */
          <Button
            variant="outline"
            size="sm"
            disabled={enviando}
            className="mt-1 cursor-pointer"
            onClick={() =>
              empezar(async () => {
                const r = await solicitar(c.competitionId, c.athleteId);
                setAviso({ ok: r.ok, texto: r.ok ? r.message : r.error });
                if (r.ok) router.refresh();
              })
            }
          >
            {enviando ? 'Enviando…' : 'Solicitar inscripción'}
          </Button>
        )}
      </div>
    </li>
  );
}
