import { Swords } from 'lucide-react';
import { BotonIcono } from '@/components/sistema/boton';
import { EnlacePrecarga } from '@/components/sistema/enlace-precarga';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { FilaPersona } from '@/components/sistema/fila-persona';
import { construirUrlCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import type { TiradorSugerido } from '@/lib/sport/explorar/tipos-perfil';
import { rutaFicha } from '@/lib/sport/explorar/url';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { Bloque, type Nivel } from '../piezas';

/**
 * El porqué de una sugerencia en una frase corta, sin afirmar nada que no esté
 * importado. El perfil no enseña clubes: «mismo club» se cuenta por lo que
 * comparten en pista.
 */
export function textoMotivo(s: TiradorSugerido): string {
  const motivo = s.motivo === 'mismo_club' ? (s.asaltos > 0 ? 'asaltos' : 'pruebas') : s.motivo;
  switch (motivo) {
    case 'rival_frecuente':
      return 'Rival frecuente';
    case 'asaltos':
      return s.asaltos === 1 ? 'Un asalto entre los dos' : `${s.asaltos} asaltos entre los dos`;
    default:
      return `Coinciden en ${s.pruebas} pruebas`;
  }
}

/** Motivo corto para la pastilla: «Rival frecuente · 17–3». */
export function pastillaMotivo(s: TiradorSugerido): string {
  const balance = s.asaltos > 0 ? `${s.victorias}–${s.derrotas}` : null;
  const motivo = s.motivo === 'mismo_club' ? (s.asaltos > 0 ? 'asaltos' : 'pruebas') : s.motivo;
  switch (motivo) {
    case 'rival_frecuente':
      return balance ? `Rival frecuente · ${balance}` : 'Rival frecuente';
    case 'asaltos':
      return balance ? `Rival · ${balance}` : 'Rival';
    default:
      return `${s.pruebas} en común`;
  }
}

function FilaSugerido({ personaId, s }: { personaId: string; s: TiradorSugerido }) {
  const nombre = nombreVisible(s.nombre) || s.nombre;
  return (
    <li className="px-3 sm:px-4">
      <FilaPersona
        persona={{ id: s.id, nombre, pais: s.pais }}
        href={rutaFicha(s.id)}
        meta={<span title={textoMotivo(s)}>{pastillaMotivo(s)}</span>}
        insignias={
          <BotonIcono asChild variante="secundario" tamano="md" etiqueta={`Cara a cara con ${nombre}`}>
            <EnlacePrecarga href={construirUrlCaraACara(personaId, { rival: s.id })} title="Cara a cara">
              <Swords aria-hidden />
            </EnlacePrecarga>
          </BotonIcono>
        }
      />
    </li>
  );
}

/**
 * Tiradores sugeridos, en filas: la fila abre su ficha y el botón de
 * espadas, el duelo directo. Salen de hechos importados (asaltos entre los
 * dos, pruebas recientes compartidas), nunca de un parecido de nombre. La
 * foto la veta el servidor para posibles menores.
 */
export function SugeridosPerfil({
  personaId,
  sugeridos,
  nivel,
}: {
  personaId: string;
  sugeridos: TiradorSugerido[] | null | undefined;
  nivel: Nivel;
}) {
  if (sugeridos === undefined || (sugeridos && sugeridos.length === 0)) return null;
  return (
    <Bloque id="ficha-sugeridos" titulo="Sugeridos" nivel={nivel}>
      {sugeridos === null ? (
        <EstadoVacio tipo="error" titulo="No se han podido cargar" />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card" aria-label="Tiradores sugeridos">
          {sugeridos.slice(0, 6).map((s) => <FilaSugerido key={s.id} personaId={personaId} s={s} />)}
        </ul>
      )}
    </Bloque>
  );
}
