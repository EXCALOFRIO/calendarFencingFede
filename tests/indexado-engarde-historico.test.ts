import { describe, expect, it } from 'vitest';
import {
  atributosPrueba,
  convertirEntrada,
  temporadaDeCarpeta,
  type EntradaPrueba,
} from '../scripts/indexado/engarde-historico-a-hechos';
import { compsDelIndice, fechaTorneoLista } from '../scripts/indexado/engarde-historico-descargar';
import { capturasDeDocumentos, rutaBajoPrefijo } from '../scripts/indexado/wayback-engarde-descargar';
import { parsearPaginaEngarde } from '../src/lib/ingest/sources/engarde';
import {
  armaDeTitulo,
  cabeceraDocumento,
  categoriaDeCodigo,
  categoriasDeTitulo,
  decodificarHtml,
  documentosDelMenu,
  esCuadroPrincipal,
  esEquiposDeTitulo,
  esTorneoDePrueba,
  fechaDeTituloTorneo,
  generoDeTitulo,
  normalizarClasificacionAntigua,
  normalizarCuadroAntiguo,
  tipoDocumentoEngarde,
} from '../src/lib/ingest/sources/engarde-antiguo';
import { parsearCuadroEngarde } from '../src/lib/ingest/sources/engarde-cuadro';
import { parsearPoulesEngarde } from '../src/lib/ingest/sources/engarde-poules';

// Fixtures recortados de exportaciones reales de Engarde (2010-2014) con nombres ficticios.

const INDICE_LEGADO = `<?xml version="1.0" ?><comps version="1.03">
<comp org="fce" evt="ccatm15x" compe="ff" sexe="m" arme="e" estindividuelle="1" etat="completed" date="0000 00 00" pays="" ville=""><categorie>m15</categorie><titre></titre><content>Campionat de Catalunya M15 Floret femení</content></comp>
<comp org="fce" evt="ccatm15x" compe="fmeq" sexe="m" arme="e" estindividuelle="1" etat="completed" date="0000 00 00" pays="" ville=""><categorie>m15</categorie><titre></titre><content>Campionat de Catalunya M15 Floret masculí equips</content></comp>
<comp org="fce" evt="ccatm15x" compe="buida" sexe="m" arme="e" estindividuelle="1" etat="empty" date="0000 00 00"><categorie>M10</categorie><titre></titre><content/></comp>
<pagination nbpages="1" nbresultats="3" /></comps>`;

const MENU = `<table class="liste0"><tbody>
<tr><td><a href="tireurs.htm" TARGET="cible">Tiradoras</a></td><td><a href="tireurs.htm" TARGET="_TOP">F5</a></td></tr>
<tr><td><a href="poules1.htm" TARGET="cible">Poules, vuelta No 1</a></td></tr>
<tr><td><a href="tableau_a8.htm" TARGET="cible">Tabla de 8</a></td></tr>
<tr><td><a href="tableau_b8.htm" TARGET="cible">Tabla 9-16</a></td></tr>
<tr><td><a href="clasfinal.htm" TARGET="cible">Clasificación general final</a></td><td><a href="clasfinal.htm" TARGET="_TOP">F5</a></td></tr>
</tbody></table>`;

const CLASFINAL = `<html><head><meta http-equiv="content-type" content="text/html; charset=iso-8859-1" /><title>Campionat de Catalunya m15 Floret Femení</title></head><body>
  <h1>
  Campionat de Catalunya m15 Floret Femení
  <br /><small><small>29/03/2014
  <br />CEM Pavelló
  </small></small></h1>
  <h3>Clasificación general final</h3>
<table class="liste" summary="Clasificación general final">
<tr><th class="HGBD">&nbsp;Cl.&nbsp;</th><th class="HBD">&nbsp;Apellido-nom&nbsp;</th><th class="HBD">&nbsp;Nombre&nbsp;</th><th class="HBD">&nbsp;Club&nbsp;</th></tr>
<tr><td>&nbsp;1&nbsp;</td><td>&nbsp;ALFA BETA&nbsp;</td><td>&nbsp;Ana&nbsp;</td><td>&nbsp;CLA&nbsp;</td></tr>
<tr><td>&nbsp;2&nbsp;</td><td>&nbsp;GAMMA DELTA&nbsp;</td><td>&nbsp;Berta&nbsp;</td><td>&nbsp;CLB&nbsp;</td></tr>
<tr><td>&nbsp;3&nbsp;</td><td>&nbsp;EPSILON&nbsp;</td><td>&nbsp;Carla&nbsp;</td><td>&nbsp;CLA&nbsp;</td></tr>
</table></body></html>`;

const POULES = `<html><body><h1>Campionat de Catalunya m15 Floret Femení<br /><small><small>29/03/2014</small></small></h1>
<table class="poule" summary="Poule No 1">
<tr><th><b>&nbsp;&nbsp;Poule No 1</b></th><th></th><th></th><th></th><th></th><th></th><th></th><th>V/M</th><th>TD-TR</th><th>TD</th></tr>
<tr><td>ALFA BETA Ana</td><td>&nbsp;CLA</td><td></td><td class="HGBD" bgcolor="#CCCCCC">&nbsp;</td><td>V</td><td>V</td><td></td><td>1.000</td><td>7</td><td>10</td></tr>
<tr><td>GAMMA DELTA Berta</td><td>&nbsp;CLB</td><td></td><td>2</td><td bgcolor="#CCCCCC">&nbsp;</td><td>V</td><td></td><td>0.500</td><td>-1</td><td>7</td></tr>
<tr><td>EPSILON Carla</td><td>&nbsp;CLA</td><td></td><td>1</td><td>3</td><td bgcolor="#CCCCCC">&nbsp;</td><td></td><td>0.000</td><td>-6</td><td>4</td></tr>
</table></body></html>`;

// Cuadro de 4 sin las clases actuales: título en <b>, nombres en td.HBD y marcadores sueltos.
const CUADRO_ANTIGUO = `<html><body><h1>Campionat de Catalunya m15 Floret Femení<br /><small><small>29/03/2014</small></small></h1>
<table class="tableau" summary="Tabla de 4">
<tr><td>&nbsp;</td><td><b>&nbsp;&nbsp;Semi-finales</b></td><td>&nbsp;</td><td><b>&nbsp;&nbsp;Final</b></td></tr>
<tr><td class="D" align="right">1&nbsp;</td><td class="HBD" bgcolor="#B8D9DC">&nbsp;ALFA BETA Ana&nbsp;</td><td class="HBD" bgcolor="#B8D9DC">&nbsp;CLA</td><td>&nbsp;</td></tr>
<tr><td>&nbsp;</td><td>&nbsp;</td><td class="D">&nbsp;</td><td class="HBD" bgcolor="#FFCCCC">&nbsp;ALFA BETA Ana&nbsp;</td></tr>
<tr><td class="D" align="right">4&nbsp;</td><td class="HBD" bgcolor="#B8D9DC">&nbsp;ZETA ETA Dora&nbsp;</td><td class="HBD" bgcolor="#B8D9DC">&nbsp;CLC</td><td class="D">&nbsp;&nbsp;&nbsp;   15/4</td></tr>
<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class="D">&nbsp;</td><td class="HBD" bgcolor="#FFFFCC">&nbsp;ALFA BETA Ana&nbsp;</td></tr>
<tr><td class="D" align="right">3&nbsp;</td><td class="HBD" bgcolor="#B8D9DC">&nbsp;EPSILON Carla&nbsp;</td><td class="HBD" bgcolor="#B8D9DC">&nbsp;CLA</td><td class="D">&nbsp;</td><td>&nbsp;&nbsp;&nbsp;   15/11</td></tr>
<tr><td>&nbsp;</td><td>&nbsp;</td><td class="D">&nbsp;</td><td class="HBD" bgcolor="#FFCCCC">&nbsp;GAMMA DELTA Berta&nbsp;</td></tr>
<tr><td class="D" align="right">2&nbsp;</td><td class="HBD" bgcolor="#B8D9DC">&nbsp;GAMMA DELTA Berta&nbsp;</td><td class="HBD" bgcolor="#B8D9DC">&nbsp;CLB</td><td>&nbsp;&nbsp;&nbsp;   15/9</td></tr>
</table></body></html>`;

// fecv.es 2010: tabla sin clase, cabecera en td y título en párrafos.
const CLASIFICACION_2010 = `<html><head><Title>CAMPEONATO AUTONOMICO M20 FLORETE MASCULINO INDIVIDUAL 2010</Title></head>
<body bgcolor="#FFFFFF">
<p class=TresGros align=center>CAMPEONATO AUTONOMICO M-20</p>
<p class=TresGros align=center>FLORETE MASCULINO INDIVIDUAL</p>
<p class=TresGros align=center>PATERNA - VALENCIA</p>
<p class=TresGros align=center>12 de Junio de 2010</p>
<p class=gros>&nbsp;&nbsp;&nbsp;Classement général</p>
<table cellspacing=0 cellpadding=0>
<tr><td class=HGBD>&nbsp;Rg&nbsp;</td><td class=HBD>&nbsp;Nom&nbsp;</td><td class=HBD>&nbsp;Prénom&nbsp;</td><td class=HBD>&nbsp;Nation&nbsp;</td><td class=HBD>&nbsp;Club&nbsp;</td></tr>
<tr bgcolor="#F7F74C"><td class=GBD align=right>&nbsp;1&nbsp;</td><td class=BD>&nbsp;PRIMERO PEREZ&nbsp;</td><td class=BD>&nbsp;Juan&nbsp;</td><td class=BD>&nbsp;&nbsp;</td><td class=BD>&nbsp;CEA&nbsp;</td></tr>
<tr><td class=GBD align=right>&nbsp;2&nbsp;</td><td class=BD>&nbsp;SEGUNDO RUIZ&nbsp;</td><td class=BD>&nbsp;Luis&nbsp;</td><td class=BD>&nbsp;&nbsp;</td><td class=BD>&nbsp;CEB&nbsp;</td></tr>
</table></body></html>`;

describe('exportaciones estáticas de Engarde', () => {
  it('decodifica ISO-8859-1 declarado en <meta>', () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('<meta charset=iso-8859-1><p>Femen'), 0xed, ...new TextEncoder().encode('</p>')]);
    expect(decodificarHtml(bytes)).toContain('Femení');
    expect(decodificarHtml(new TextEncoder().encode('<p>Femení</p>'))).toContain('Femení');
  });

  it('lee los documentos del menú y reconoce los nombres antiguos', () => {
    expect(documentosDelMenu(MENU)).toEqual([
      { fichero: 'poules1.htm', tipo: 'poules' },
      { fichero: 'tableau_a8.htm', tipo: 'cuadro' },
      { fichero: 'tableau_b8.htm', tipo: 'cuadro' },
      { fichero: 'clasfinal.htm', tipo: 'clasificacion' },
    ]);
    expect(esCuadroPrincipal('tableau_a8.htm')).toBe(true);
    expect(esCuadroPrincipal('tableau16.htm')).toBe(true);
    expect(esCuadroPrincipal('tableau_b8.htm')).toBe(false);
    expect(tipoDocumentoEngarde('ClasGeneral.htm')).toBe('clasificacion');
    expect(tipoDocumentoEngarde('Tabla%20de%2064.htm')).toBe('cuadro');
    expect(tipoDocumentoEngarde('clasFinPoules.htm')).toBeNull();
    expect(tipoDocumentoEngarde('tireurs.htm')).toBeNull();
  });

  it('el índice migrado conserva título y contenido sin interpretar', () => {
    const r = compsDelIndice(INDICE_LEGADO)!;
    expect(r.paginas).toBe(1);
    expect(r.comps.map((c) => [c.compe, c.etat, c.categorie, c.content])).toEqual([
      ['ff', 'completed', 'm15', 'Campionat de Catalunya M15 Floret femení'],
      ['fmeq', 'completed', 'm15', 'Campionat de Catalunya M15 Floret masculí equips'],
      ['buida', 'empty', 'M10', ''],
    ]);
  });

  it('lee el cuadro antiguo con la geometría del actual', () => {
    const c = parsearCuadroEngarde(normalizarCuadroAntiguo(CUADRO_ANTIGUO), { individual: true });
    expect(c.estado).toBe('leido');
    expect(c.rondas).toEqual(['SF', 'F']);
    expect(c.asaltos.map((a) => [a.ronda, a.nombreA, a.puntosA, a.nombreB, a.puntosB])).toEqual([
      ['SF', 'ALFA BETA Ana', 15, 'ZETA ETA Dora', 4],
      ['SF', 'GAMMA DELTA Berta', 15, 'EPSILON Carla', 9],
      ['F', 'ALFA BETA Ana', 15, 'GAMMA DELTA Berta', 11],
    ]);
    expect(c.completo).toBe(true);
  });

  it('retitula «Tabla preliminar de N» de los cuadros actuales', () => {
    const html = '<table class="tableau"><tr><td class="tableTitle">Tabla preliminar de 256</td></tr></table>';
    expect(normalizarCuadroAntiguo(html)).toContain('>Tabla de 256<');
  });

  it('lee las poules estáticas con el lector actual', () => {
    const p = parsearPoulesEngarde(POULES, { pagina: 1 });
    expect(p.estado).toBe('leido');
    expect(p.asaltos).toHaveLength(3);
    expect(p.esperados).toBe(3);
  });

  it('convierte la clasificación de 2010 a la forma actual', () => {
    const html = normalizarClasificacionAntigua(CLASIFICACION_2010);
    const pagina = parsearPaginaEngarde(html);
    expect(pagina.tipo).toBe('clasificacion_provisional');
    expect(pagina.encabezado).toBe('Classement général');
    expect(pagina.filas.map((f) => [f.puesto, f.nombre, f.club])).toEqual([
      [1, 'PRIMERO PEREZ Juan', 'CEA'],
      [2, 'SEGUNDO RUIZ Luis', 'CEB'],
    ]);
    expect(cabeceraDocumento(CLASIFICACION_2010)).toEqual({
      titulo: 'CAMPEONATO AUTONOMICO M-20',
      lineas: ['FLORETE MASCULINO INDIVIDUAL', 'PATERNA - VALENCIA', '12 de Junio de 2010'],
    });
  });

  it('renombra la cabecera catalana Cognom/Nom', () => {
    const html = '<table class="liste"><tr><th>Cl.</th><th>Cognom</th><th>Nom</th><th>Club</th></tr><tr><td>1</td><td>ALFA</td><td>Ana</td><td>X</td></tr></table>';
    const p = parsearPaginaEngarde(`<h3>Classificació general final</h3>${normalizarClasificacionAntigua(html)}`);
    expect(p.filas[0].nombre).toBe('ALFA Ana');
  });
});

describe('atributos de títulos', () => {
  it('arma, género y categoría en castellano, catalán y francés', () => {
    expect(armaDeTitulo('Campionat de Catalunya M15 Floret femení')).toBe('FLORETE');
    expect(armaDeTitulo("Lliga Catalana d'Espasa M15")).toBe('ESPADA');
    expect(armaDeTitulo('Sabre Femenino Junior')).toBe('SABLE');
    expect(armaDeTitulo('Lligues catalanes sènior de sabre i floret')).toBeNull();
    expect(generoDeTitulo('Floret masculí equips')).toBe('M');
    expect(generoDeTitulo("M17 d'Espasa femenina")).toBe('F');
    expect(generoDeTitulo('Epee mas cadet')).toBe('M');
    expect(generoDeTitulo('Florete M-23 Mixto')).toBe('MIXTO');
    expect(generoDeTitulo('Más tiradores')).toBeNull();
    expect(categoriasDeTitulo('Campionat de Catalunya Absolut')).toEqual(['ABS']);
    expect(categoriasDeTitulo('CAMPEONATO AUTONOMICO M-20')).toEqual(['M20']);
    expect(categoriasDeTitulo('Lliga Catalana de Sabre M10 i M12')).toEqual(['M12', 'M10']);
    expect(categoriasDeTitulo('Sabre Mas Minime')).toEqual(['M15']);
    expect(categoriasDeTitulo('FLORETE MASCULINO M-17-20')).toEqual(['M20', 'M17']);
    expect(categoriasDeTitulo('SABLE MASCULINO M15-17')).toEqual(['M17', 'M15']);
    expect(categoriasDeTitulo('RANKING M17-M20 01-11-2009')).toEqual(['M20', 'M17']);
    expect(categoriasDeTitulo('TNR M20 - 27/09/2014')).toEqual(['M20']);
    expect(esTorneoDePrueba('CURS DE DT')).toBe(true);
    expect(esTorneoDePrueba('dt')).toBe(true);
    expect(esTorneoDePrueba('Competicion de Formacion')).toBe(false);
    expect(esTorneoDePrueba('Campionat de Catalunya Absolut')).toBe(false);
    expect(categoriaDeCodigo('m15')).toBe('M15');
    expect(categoriaDeCodigo('M-11')).toBe('M11');
    expect(categoriaDeCodigo('Junior')).toBe('M20');
    expect(esEquiposDeTitulo('Floret masculí equips')).toBe(true);
    expect(esEquiposDeTitulo('Equipes Feminin')).toBe(true);
  });

  it('en el índice migrado ignora sexo, arma y modalidad por defecto', () => {
    const c = { sexe: 'm', arme: 'e', estindividuelle: '1', categorie: 'm15' };
    expect(atributosPrueba(c, ['Campionat de Catalunya M15 Floret femení'], true, false)).toEqual({
      arma: 'FLORETE', genero: 'F', categoria: 'M15', individual: true,
    });
    expect(atributosPrueba(c, ['Campionat de Catalunya M15 Floret masculí equips'], true, false)).toMatchObject({ individual: false });
    // Sin título que lo diga, no hay arma ni género.
    expect(atributosPrueba(c, [''], true, false)).toMatchObject({ arma: null, genero: null });
    // Categoría del índice contradicha por el título: no se elige.
    expect(atributosPrueba({ ...c, categorie: 'minime' }, ['fleuret fem cadet'], true, false).categoria).toBeNull();
    // Índice actual: manda el índice si el título no lo contradice.
    expect(atributosPrueba({ sexe: 'f', arme: 's', estindividuelle: '1', categorie: 'M17' }, [''], false, false)).toEqual({
      arma: 'SABLE', genero: 'F', categoria: 'M17', individual: true,
    });
    expect(atributosPrueba({ sexe: 'f', arme: 's', estindividuelle: '1', categorie: 'M17' }, ['Espada femenina'], false, false).arma).toBeNull();
  });

  it('fechas de títulos y carpetas', () => {
    expect(fechaDeTituloTorneo('2015.02.22 Lliga Catalana de Floret ABS')).toBe('2015-02-22');
    expect(fechaDeTituloTorneo('27 -28/09/2014 TNR Amposta Espasa M20')).toBe('2014-09-27');
    expect(fechaDeTituloTorneo('10-11/01/2015 Lliga Catalana')).toBe('2015-01-10');
    expect(fechaDeTituloTorneo('17.01.2015 Lliga Catalana')).toBe('2015-01-17');
    expect(fechaDeTituloTorneo('2014.04.12/13 Campionat de Catalunya')).toBe('2014-04-12');
    expect(fechaDeTituloTorneo("Lliga Catalana d'Espasa M10 i M12")).toBeNull();
    expect(fechaTorneoLista({ date: '2012-01-01', Titre: '2015.02.22 Lliga' })).toBe('2015-02-22');
    expect(fechaTorneoLista({ date: '2012-01-01', Titre: 'Lliga' })).toBeNull();
    expect(fechaTorneoLista({ date: '2016-03-19', Titre: 'Torneo' })).toBe('2016-03-19');
    expect(temporadaDeCarpeta('02015-16/Segovia/SFJ-in')).toBe('2015-2016');
    expect(temporadaDeCarpeta('2014-2015/Aranda')).toBe('2014-2015');
    expect(temporadaDeCarpeta('20130427/HTMLs2')).toBeNull();
  });
});

describe('Wayback', () => {
  it('sólo documentos de prueba bajo el prefijo', () => {
    expect(rutaBajoPrefijo('http://www.esgrimacyl.es:80/resultados/2016-17/X/poules1.htm', 'esgrimacyl.es/resultados/')).toBe('2016-17/X/poules1.htm');
    expect(rutaBajoPrefijo('http://esgrimacyl.es/resultados-3/', 'esgrimacyl.es/resultados/')).toBeNull();
    const filas = [
      ['k', '1', 'http://www.fecv.es/esgrima/resultado/TAM20/FMM20.htm'],
      ['k', '2', 'http://www.fecv.es/esgrima/resultado/TAM20/FMM20.pdf'],
      ['k', '3', 'http://www.fecv.es/esgrima/resultado/TAM20/index.html'],
      ['k', '4', 'http://www.fecv.es/esgrima/resultado/TAM20/tireurs.htm'],
    ];
    expect(capturasDeDocumentos('fecv', 'fecv.es/esgrima/resultado/', filas).map((c) => c.ruta)).toEqual(['TAM20/FMM20.htm']);
  });
});

describe('conversión a hechos', () => {
  const base: EntradaPrueba = {
    org: 'fce', evt: 'ccatm15x', compe: 'ff', claveTorneo: 'engarde:fce/ccatm15x', claveCompeticion: 'engarde:fce/ccatm15x/ff',
    nombreTorneo: '2014.03.29 Campionat de Catalunya M15',
    comp: { sexe: 'm', arme: 'e', estindividuelle: '1', categorie: 'm15', etat: 'completed', ville: '', pays: '' },
    legado: true, titulos: ['', 'Campionat de Catalunya M15 Floret femení'], fechaIndice: null, fechaTorneo: '2014-03-29',
    temporadaCarpeta: null,
    clasificacion: { fichero: 'clasfinal.htm', html: CLASFINAL, url: 'https://engarde-service.com/files/fce/ccatm15x/ff/clasfinal.htm' },
    poules: [{ fichero: 'poules1.htm', html: POULES, url: 'https://engarde-service.com/files/fce/ccatm15x/ff/poules1.htm', pagina: 1 }],
    cuadros: [],
    faltan: [],
    extractor: 'lector_engarde_estatico',
  };

  it('prueba completa del sistema antiguo', () => {
    const r = convertirEntrada(base, '2018-09-01');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.hechos;
    expect(h.source).toBe('engarde');
    expect(h.sourceUrl).toBe('https://engarde-service.com/files/fce/ccatm15x/ff/clasfinal.htm');
    expect(h.edition).toMatchObject({ season: '2013-2014', tournamentKey: 'engarde:fce/ccatm15x', startDate: '2014-03-29' });
    expect(h.competition).toMatchObject({ weapon: 'FLORETE', gender: 'F', category: 'M15', format: 'INDIVIDUAL', date: '2014-03-29' });
    expect(h.status).toMatchObject({ results: 'completo', pools: 'completo', tableau: 'sin_resultados' });
    expect(h.results.map((x) => [x.position, x.name, x.club, x.license])).toEqual([
      [1, 'ALFA BETA Ana', 'CLA', null],
      [2, 'GAMMA DELTA Berta', 'CLB', null],
      [3, 'EPSILON Carla', 'CLA', null],
    ]);
    const refs = new Set(h.results.map((x) => x.factKey));
    expect(h.bouts.every((b) => refs.has(b.aRef) && refs.has(b.bRef))).toBe(true);
  });

  it('descarta sin fecha, fuera de corte o con atributos ambiguos', () => {
    expect(convertirEntrada({ ...base, fechaTorneo: null, clasificacion: { ...base.clasificacion!, html: CLASFINAL.replace('29/03/2014', '') }, poules: [] }, '2018-09-01')).toEqual({ ok: false, motivo: 'sin_fecha' });
    expect(convertirEntrada(base, '2014-01-01')).toEqual({ ok: false, motivo: 'posterior_al_corte' });
    expect(convertirEntrada({ ...base, titulos: ['Lliga de sabre i floret'], poules: [], clasificacion: { ...base.clasificacion!, html: CLASFINAL.replace(/Floret Femení/g, '') } }, '2018-09-01')).toEqual({ ok: false, motivo: 'atributos_incompletos' });
    expect(convertirEntrada({ ...base, clasificacion: null, poules: [] }, '2018-09-01')).toEqual({ ok: false, motivo: 'sin_documentos' });
  });

  it('clasificación de 2010 publicada sola: final, con temporada por su fecha', () => {
    const r = convertirEntrada({
      ...base, org: 'fecv', evt: 'TAM20', compe: 'TAM20/FMM20', claveTorneo: 'engarde-wayback:fecv/TAM20',
      claveCompeticion: 'engarde-wayback:fecv/TAM20/FMM20', titulos: [], fechaTorneo: null, poules: [],
      comp: { sexe: '', arme: '', estindividuelle: '', categorie: '', etat: 'completed', ville: '', pays: '' },
      clasificacion: { fichero: 'FMM20.htm', html: CLASIFICACION_2010, url: 'https://web.archive.org/web/20100622155947/http://www.fecv.es/esgrima/resultado/TAM20/FMM20.htm' },
      extractor: 'lector_engarde_wayback',
    }, '2018-09-01');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hechos.edition.season).toBe('2009-2010');
    expect(r.hechos.competition).toMatchObject({ weapon: 'FLORETE', gender: 'M', category: 'M20', date: '2010-06-12' });
    expect(r.hechos.status.results).toBe('completo');
    expect(r.hechos.results).toHaveLength(2);
  });
});
