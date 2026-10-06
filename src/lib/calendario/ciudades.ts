/**
 * Una sede escrita de dos formas es la misma sede. El calendario de la RFEE
 * escribe las ciudades en castellano («TESALÓNICA», «VARSOVIA») y la FIE y la
 * EFC en inglés o en su lengua («Thessaloniki», «Warszawa»): sin esto, una
 * prueba del circuito europeo ya celebrada no se ata a su evento del
 * calendario y sale dos veces.
 *
 * Recibe la ciudad ya plegada (minúsculas, sin acentos ni puntuación) y
 * devuelve una forma canónica. Sólo exónimos conocidos: lo que no está aquí se
 * devuelve igual, y dos sedes distintas nunca se juntan por parecido.
 */
const FORMAS: Record<string, readonly string[]> = {
  atenas: ['athens', 'athina', 'athen'],
  basilea: ['basel', 'bale'],
  belgrado: ['belgrade', 'beograd'],
  berna: ['bern', 'berne'],
  bruselas: ['brussels', 'bruxelles', 'brussel'],
  bucarest: ['bucharest', 'bucuresti'],
  colonia: ['koln', 'cologne', 'koeln'],
  copenhague: ['copenhagen', 'kobenhavn'],
  cracovia: ['krakow', 'cracow', 'krakau'],
  dresde: ['dresden'],
  esmirna: ['izmir'],
  estambul: ['istanbul'],
  estocolmo: ['stockholm'],
  estrasburgo: ['strasbourg'],
  florencia: ['firenze', 'florence'],
  francfort: ['frankfurt', 'frankfurt am main'],
  ginebra: ['geneve', 'geneva', 'genf'],
  gotemburgo: ['goteborg', 'gothenburg'],
  hamburgo: ['hamburg'],
  helsinki: ['helsingfors'],
  kiev: ['kyiv', 'kiew'],
  lisboa: ['lisbon'],
  londres: ['london'],
  luxemburgo: ['luxembourg', 'luxemburg'],
  liubliana: ['ljubljana'],
  milan: ['milano'],
  modling: ['moedling', 'mödling'],
  moscu: ['moscow', 'moskva'],
  munich: ['munchen', 'muenchen'],
  napoles: ['napoli', 'naples'],
  nuremberg: ['nurnberg', 'nurenberg', 'nuernberg', 'nuremberga'],
  praga: ['praha', 'prague'],
  roma: ['rome'],
  tesalonica: ['thessaloniki', 'salonica', 'salonika'],
  tiflis: ['tbilisi'],
  turin: ['torino'],
  varsovia: ['warszawa', 'warsaw'],
  venecia: ['venezia', 'venice'],
  viena: ['wien', 'vienna'],
  vilna: ['vilnius'],
};

const CANONICA = new Map<string, string>();
for (const [es, otras] of Object.entries(FORMAS)) {
  CANONICA.set(es, es);
  for (const o of otras) CANONICA.set(o.normalize('NFD').replace(/[\u0300-\u036f]/g, ''), es);
}

export function ciudadCanonica(plegada: string): string {
  return CANONICA.get(plegada) ?? plegada;
}
