import { SinAcceso, exigirRol } from '@/components/admin/guardia';
import { Cabecera, Cifra, TiraCifras } from '@/components/admin/piezas';
import { UsuariosPanel } from '@/components/admin/usuarios-panel';
import { contarCuentas, listarAltasRecientes, listarClubesParaAlta } from '../consultas';
import { SolicitudesVinculo } from '@/components/admin/solicitudes-vinculo';
import { listarSolicitudesVinculo } from '@/lib/altas/solicitudes';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Usuarios' };

export default async function Pagina() {
  const acceso = await exigirRol('admin');
  if (!acceso.ok) {
    return (
      <SinAcceso
        titulo="Usuarios"
        motivo={acceso.motivo}
        autenticado={acceso.autenticado}
      />
    );
  }

  const [clubes, altas, recuento, solicitudes] = await Promise.all([
    listarClubesParaAlta(),
    listarAltasRecientes(),
    contarCuentas(),
    listarSolicitudesVinculo(),
  ]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Cabecera
        titulo="Usuarios"
        contexto="Quién tiene cuenta, y cómo se da de alta a alguien más."
      />

      {/*
        La chapa de cifras va ANTES del formulario.

        Antes esta pantalla abría con un campo «Nombre» vacío: en un iPhone se
        veían tres campos en blanco y nada más, y para saber cuántas cuentas
        había que bajar dos mil píxeles hasta el final. El estado se lee
        primero y se actúa después, que es el orden en que se mira una
        pantalla de gestión.
      */}
      <TiraCifras>
        <Cifra valor={recuento.total} palabra="cuentas" detalle="con acceso creado" />
        <Cifra
          valor={recuento.athlete}
          palabra="tiradores"
          detalle="entran a ver su ranking y sus plazos"
        />
        <Cifra
          valor={recuento.coach}
          palabra="seleccionadores"
          detalle="uno por arma, con su género"
        />
        {/*
          Solo cuando hay algo que arreglar. Una cifra en cero con la palabra
          «revocadas» al lado invita a buscar un problema que no existe.
        */}
        {recuento.sinAcceso > 0 ? (
          <Cifra
            valor={recuento.sinAcceso}
            palabra="con el acceso revocado"
            detalle="siguen en la base, no pueden entrar"
            tono="aviso"
          />
        ) : null}
        {recuento.retirados > 0 ? (
          <Cifra
            valor={recuento.retirados}
            palabra="con un papel retirado"
            detalle="el club ya no es un papel: hay que reasignarlas"
            tono="aviso"
          />
        ) : null}
      </TiraCifras>

      <SolicitudesVinculo solicitudes={solicitudes} />
      <UsuariosPanel clubes={clubes} altas={altas} />
    </div>
  );
}
