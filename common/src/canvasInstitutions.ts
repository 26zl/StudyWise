/**
 * Kuratert liste over norske læresteder som kan velges i Canvas-oppsettet.
 * Listen holdes samlet i én eksport, og eventuell feil URL håndteres av
 * tokenverifisering og eksisterende feilmeldinger i backend/frontend.
 */
export interface CanvasInstitution {
  navn: string;
  /** Antatt Canvas base URL for institusjonen. */
  url: string;
}

/** Norske læresteder i alfabetisk rekkefølge. */
export const CANVAS_INSTITUSJONER_NORGE: readonly CanvasInstitution[] = [
  { navn: "Ansgar høyskole", url: "https://ansgar.instructure.com" },
  { navn: "Arkitektur- og designhøgskolen i Oslo", url: "https://aho.instructure.com" },
  { navn: "Dronning Mauds Minne Høgskole", url: "https://dmmh.instructure.com" },
  { navn: "Fjellhaug Internasjonale Høgskole", url: "https://fih.instructure.com" },
  { navn: "Forsvarets høgskoler", url: "https://fhs.instructure.com" },
  { navn: "Handelshøyskolen BI", url: "https://bi.instructure.com" },
  { navn: "Høgskolen i Molde", url: "https://himolde.instructure.com" },
  { navn: "Høgskolen i Østfold", url: "https://hiof.instructure.com" },
  { navn: "Høgskulen for grøn utvikling Stiftelse", url: "https://hgu.instructure.com" },
  { navn: "Høgskulen i Volda", url: "https://hivolda.instructure.com" },
  { navn: "Høgskulen på Vestlandet", url: "https://hvl.instructure.com" },
  { navn: "Høyskolen for ledelse og teologi", url: "https://hlt.instructure.com" },
  { navn: "Kristiania", url: "https://kristiania.instructure.com" },
  {
    navn: "Kriminalomsorgens høgskole og utdanningssenter KRUS",
    url: "https://krus.instructure.com",
  },
  { navn: "Kunsthøgskolen i Oslo", url: "https://khio.instructure.com" },
  { navn: "Lovisenberg diakonale høgskole", url: "https://ldh.instructure.com" },
  { navn: "MF vitenskapelig høyskole", url: "https://mf.instructure.com" },
  { navn: "Nord universitet", url: "https://nord.instructure.com" },
  { navn: "NMBU", url: "https://nmbu.instructure.com" },
  { navn: "Norges Handelshøyskole", url: "https://nhh.instructure.com" },
  { navn: "Norges idrettshøgskole", url: "https://nih.instructure.com" },
  { navn: "Norges musikkhøgskole", url: "https://nmh.instructure.com" },
  { navn: "Noroff", url: "https://noroff.instructure.com" },
  { navn: "NSKI Høyskole", url: "https://nski.instructure.com" },
  { navn: "NTNU", url: "https://ntnu.instructure.com" },
  { navn: "OsloMet", url: "https://oslomet.instructure.com" },
  { navn: "Oslo Nye Høyskole", url: "https://oslonye.instructure.com" },
  { navn: "Sámi allaskuvla / Samisk høgskole", url: "https://samas.instructure.com" },
  { navn: "Universitetet i Agder", url: "https://uia.instructure.com" },
  { navn: "Universitetet i Bergen", url: "https://mitt.uib.no" },
  { navn: "Universitetet i Innlandet", url: "https://inn.instructure.com" },
  { navn: "Universitetet i Oslo", url: "https://uio.instructure.com" },
  { navn: "Universitetet i Stavanger", url: "https://uis.instructure.com" },
  { navn: "Universitetet i Sørøst-Norge", url: "https://usn.instructure.com" },
  { navn: "UiT Norges arktiske universitet", url: "https://uit.instructure.com" },
  { navn: "VID vitenskapelige høgskole", url: "https://vid.instructure.com" },
] as const;
