import { SinAcceso, exigirRol } from '@/components/admin/guardia';
import { Cabecera, Cifra, TiraCifras } from '@/components/admin/piezas';
import { PanelTiradores } from '@/components/tiradores/panel-tiradores';
import type { TiradorVista } from '@/components/tiradores/tipos';
import { getCurrentSeason } from '@/lib/queries/calendar';
import { getAthleteOverview } from '@/lib/queries/coach';
import { WEAPON_LABEL } from '@/lib/utils';
import { puestosDeRanking, solicitudesEnClub } from './consultas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tiradores' };

/**
 * Tiradores.
 *
 * Es la pantalla del seleccionador y la ve también la dirección técnica. Un
 * tirador o un club NO: para ellos se explica el motivo en vez de devolver un
 * 500, que es lo que pasaba cuando nadie recogía la excepción de
 * `requireRole`.
 *
 * Se piden SIEMPRE todos los tiradores, no solo los del arma del
 * seleccionador, y el filtro se aplica en la pantalla. Es una decisión
 * consciente: un seleccionador puede mirar cualquier arma con un clic, y
 * traer los 60 tiradores de la federación en la misma consulta cuesta lo
 * mismo que traer 20.
 */
export default async function Pagina() {
  const acceso = await exigirRol('coach', 'admin');
  if (!acceso.ok) {
    return (
      <SinAcceso
        titulo="Tiradores"
        motivo={acceso.motivo}
        autenticado={acceso.autenticado}
      />
    );
  }

  const temporada = await getCurrentSeason();
  const [tiradores, ranking] = await Promise.all([
    getAthleteOverview([], temporada?.categories ?? []),
    puestosDeRanking(),
  ]);

  const enClub = await solicitudesEnClub(tiradores.map((t) => t.id));

  const porTirador = new Map<string, TiradorVista['enClub']>();
  for (const s of enClub) {
    const lista = porTirador.get(s.athleteId) ?? [];
    lista.push({
      eventId: s.eventId,
      name: s.name,
      date: s.date,
      city: s.city,
      weapon: s.weapon,
      category: s.category,
    });
    porTirador.set(s.athleteId, lista);
  }

  const vista: TiradorVista[] = tiradores.map((t) => ({
    ...t,
    ranking: ranking.get(t.id) ?? [],
    enClub: (porTirador.get(t.id) ?? []).sort((a, b) => a.date.localeCompare(b.date)),
  }));

  const armasPropias = acceso.perfil.weapons;
  const esAdmin = acceso.perfil.role === 'admin';

  const conInscripciones = vista.filter(
    (t) => t.upcoming.length > 0 || t.enClub.length > 0,
  ).length;
  const esperandoClub = vista.reduce((total, t) => total + t.enClub.length, 0);
  const conAvisos = vista.filter((t) => t.warnings.length > 0).length;
  const competiciones = new Set(
    vista.flatMap((t) => [...t.upcoming, ...t.enClub].map((u) => u.eventId)),
  ).size;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Cabecera
        titulo="Tiradores"
        contexto={
          esAdmin
            ? 'Todos los tiradores de la federación, con a qué van y cómo van.'
            : armasPropias.length > 0
              ? `Los de ${armasPropias.map((a) => WEAPON_LABEL[a].toLowerCase()).join(' y ')} primero; el resto, a un clic.`
              : 'Tu cuenta no tiene ningún arma asignada, así que se enseñan todas. Pídele a la dirección técnica que te asigne la tuya.'
        }
      />

      <TiraCifras>
        <Cifra
          valor={vista.length}
          palabra="tiradores en activo"
          detalle="con ficha y licencia al día o no"
        />
        <Cifra
          valor={conInscripciones}
          palabra="van a algo"
          detalle="tienen inscripción viva"
          tono={conInscripciones > 0 ? 'ok' : 'apagado'}
        />
        <Cifra
          valor={competiciones}
          palabra="competiciones por delante"
          detalle="a las que va alguien"
        />
        <Cifra
          valor={esperandoClub}
          palabra="esperan a su club"
          detalle="solicitadas, sin validar"
          tono={esperandoClub > 0 ? 'aviso' : 'apagado'}
        />
        <Cifra
          valor={conAvisos}
          palabra="con algo que arreglar"
          detalle="licencia o consentimiento"
          tono={conAvisos > 0 ? 'aviso' : 'apagado'}
        />
      </TiraCifras>

      <PanelTiradores
        tiradores={vista}
        armasPropias={armasPropias}
        esAdmin={esAdmin}
      />
    </div>
  );
}
