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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
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
}: {
  grupos: RankingGroupKey[];
  grupo: RankingGroupKey;
  onElegir: (parcial: Partial<RankingGroupKey>) => void;
  busqueda?: string;
  onBuscar?: (v: string) => void;
  etiquetaBusqueda?: string;
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
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        value={grupo.weapon}
        onValueChange={(v) => v && onElegir({ weapon: v as RankingGroupKey['weapon'] })}
        aria-label="Arma"
      >
        {armas.map((a) => (
          <ToggleGroupItem key={a} value={a}>
            {WEAPON_LABEL[a]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <ToggleGroup
        type="single"
        variant="outline"
        value={grupo.gender}
        onValueChange={(v) => v && onElegir({ gender: v as RankingGroupKey['gender'] })}
        aria-label="Género"
      >
        {generos.map((g) => (
          <ToggleGroupItem key={g} value={g}>
            {GENDER_LABEL[g]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Select
        value={grupo.category}
        onValueChange={(v) => onElegir({ category: v as RankingGroupKey['category'] })}
      >
        <SelectTrigger className="w-40" aria-label="Categoría">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {categorias.map((c) => (
            <SelectItem key={c} value={c}>
              {CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {onBuscar ? (
        /*
          El buscador al final de la fila y estrecho: la tabla es a lo que se
          viene y los selectores son lo que más se toca. En el móvil la fila
          envuelve y el campo se queda a lo ancho, que es donde teclear con el
          pulgar tiene sentido.
        */
        <div className="relative min-w-40 flex-1 sm:max-w-56">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={busqueda ?? ''}
            onChange={(e) => onBuscar(e.target.value)}
            placeholder={etiquetaBusqueda}
            aria-label={etiquetaBusqueda}
            className="pl-8"
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * ¿El nombre casa con lo que se ha escrito?
 *
 * Sin acentos y sin importar el orden de las palabras, porque las dos fuentes
 * escriben los nombres distinto y al revés entre sí: Skermo publica «JORGE
 * CASAUS PIELAGO» y la FIE «CASAUS PIELAGO Jorge». Buscar «jorge casaus»
 * tiene que encontrarlo en las dos.
 */
export function nombreCasa(nombre: string, busqueda: string): boolean {
  const limpio = (t: string) =>
    t
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  const aguja = limpio(busqueda).trim();
  if (!aguja) return true;
  const pajar = limpio(nombre);
  return aguja.split(/\s+/).every((palabra) => pajar.includes(palabra));
}
