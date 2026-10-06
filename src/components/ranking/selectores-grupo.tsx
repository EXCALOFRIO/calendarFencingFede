'use client';

import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { RankingGroupKey } from '@/lib/queries/ranking';
import { CATEGORY_LABEL, GENDER_LABEL, WEAPON_LABEL } from '@/lib/utils';

/**
 * Arma, género, categoría y buscador. Los mismos controles para las dos
 * clasificaciones.
 *
 * Están en su propio fichero porque **hay dos tablas y no puede haber dos
 * juegos de selectores**: la de la RFEE y la del ranking mundial de la FIE se
 * eligen igual, y con el bloque escrito dos veces el día que se cambie uno
 * quedarían distintos sin que nadie se entere. Es el mismo motivo por el que
 * `PANTALLAS_ADMIN` es una sola lista.
 *
 * Las opciones salen de los grupos QUE TIENEN DATOS, no de la lista completa
 * de armas y categorías: ofrecer «sable M9 femenino» para que al tocarlo salga
 * vacío es una promesa incumplida en cada toque.
 *
 * El buscador es opcional y filtra por nombre. Lo pidió el usuario para la
 * tabla del mundial —*«y con buscador y tal»*— y se le pone también a la de la
 * RFEE, que tiene grupos de 259 filas: buscarse a mano en esa lista es peor.
 */
export function SelectoresGrupo({
  grupos,
  grupo,
  onElegir,
  busqueda,
  onBuscar,
  etiquetaBusqueda = 'Buscar un tirador',
  antes = null,
  despues = null,
}: {
  grupos: RankingGroupKey[];
  grupo: RankingGroupKey;
  onElegir: (parcial: Partial<RankingGroupKey>) => void;
  busqueda?: string;
  onBuscar?: (v: string) => void;
  etiquetaBusqueda?: string;
  /** Primer filtro de la fila (la temporada del ranking nacional). */
  antes?: React.ReactNode;
  /** Interruptores al final de la fila («Solo España», «Solo JJOO»). */
  despues?: React.ReactNode;
}) {
  const armas = [...new Set(grupos.map((g) => g.weapon))];
  const generos = [...new Set(grupos.filter((g) => g.weapon === grupo.weapon).map((g) => g.gender))];
  const categorias = [
    ...new Set(
      grupos
        .filter((g) => g.weapon === grupo.weapon && g.gender === grupo.gender)
        .map((g) => g.category),
    ),
  ];

  return (
    <div className="flex min-w-0 flex-wrap items-end gap-2">
      {antes}
      <label className="min-w-0 flex-[1_1_7rem] sm:max-w-44">
        <span className="mb-1 block text-xs text-muted-foreground">Arma</span>
        <Select
          value={grupo.weapon}
          onValueChange={(v) => onElegir({ weapon: v as RankingGroupKey['weapon'] })}
        >
          <SelectTrigger className="w-full" aria-label="Arma">
            <SelectValue>{WEAPON_LABEL[grupo.weapon]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {armas.map((a) => (
              <SelectItem key={a} value={a}>{WEAPON_LABEL[a]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <label className="min-w-0 flex-[1_1_7rem] sm:max-w-44">
        <span className="mb-1 block text-xs text-muted-foreground">Género</span>
        <Select
          value={grupo.gender}
          onValueChange={(v) => onElegir({ gender: v as RankingGroupKey['gender'] })}
        >
          <SelectTrigger className="w-full" aria-label="Género">
            <SelectValue>{GENDER_LABEL[grupo.gender]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {generos.map((g) => (
              <SelectItem key={g} value={g}>{GENDER_LABEL[g]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <label className="min-w-0 flex-[1_1_7rem] sm:max-w-44">
        <span className="mb-1 block text-xs text-muted-foreground">Categoría</span>
        <Select
          value={grupo.category}
          onValueChange={(v) => onElegir({ category: v as RankingGroupKey['category'] })}
        >
          <SelectTrigger className="w-full" aria-label="Categoría">
            <SelectValue>{CATEGORY_LABEL[grupo.category]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {categorias.map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      {onBuscar ? (
        /*
          El buscador al final de la fila y estrecho: la tabla es a lo que se
          viene y los selectores son lo que más se toca. En el móvil la fila
          envuelve y el campo se queda a lo ancho, que es donde teclear con el
          pulgar tiene sentido.
        */
        <label className="min-w-0 flex-[1_1_7rem] sm:max-w-56">
          <span className="mb-1 block text-xs text-muted-foreground">Buscar</span>
          <span className="relative block">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={busqueda ?? ''}
              onChange={(e) => onBuscar(e.target.value)}
              placeholder="Buscar"
              aria-label={etiquetaBusqueda}
              className="pl-8"
            />
          </span>
        </label>
      ) : null}
      {despues ? <div className="flex min-w-0 basis-full flex-wrap items-center gap-x-4 gap-y-1">{despues}</div> : null}
    </div>
  );
}

/*
  `nombreCasa` vivía aquí y se ha subido a `src/lib/nombres.ts`.

  Motivo: este fichero lleva `'use client'`, y la búsqueda por nombre de
  `/alta` —que corre en el servidor— necesitaba la misma idea. Importarla
  desde aquí se habría llevado por delante media biblioteca de React al
  servidor. Allí está, junto con la versión que además perdona erratas.
*/
