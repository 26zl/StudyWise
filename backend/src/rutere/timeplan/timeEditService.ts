/*
 * TimeEdit Service
 * Håndterer integrasjon med TimeEdit for å hente timeplan AUTOMATISK
 * basert på emnekoder fra Canvas.
 *
 * Flyt:
 * 1. Hent emnekoder fra Canvas (f.eks. "6105N", "BOP3000")
 * 2. Søk i TimeEdit API for å finne objekt-ID-er for gjeldende semester
 * 3. Hent CSV med timeplan-data for disse objektene
 */
import { logger } from "../../utils/logger.js";
import type { CanvasCourse } from "common/canvas";
import type { CalendarItem } from "common/calendar";

// Regex for å trekke ut emnekoder (f.eks. BOP3000, DAT2000, 6105N)
// Matcher 2-5 store bokstaver fulgt av 4-5 siffer, ELLER bare siffer+bokstav
// Også matcher koder som kan stå i UE_xxx_EMNEKODE format
const COURSE_CODE_REGEX = /\b([A-ZÆØÅ]{2,5}\d{4,5}[A-Z]?|\d{4,5}[A-Z])\b/gi;

// Ekstra regex for å finne emnekoder i UE-format som "UE_222_BOP3000_1_2026"
const UE_CODE_REGEX = /UE_\d+_([A-ZÆØÅ]{2,5}\d{4,5}[A-Z]?)_/i;

// TimeEdit konfigurasjon for USN
const TIMEEDIT_CONFIG = {
  baseUrl: "https://cloud.timeedit.net/usn/web/publikk",
  searchType: "199", // Type for undervisningsenheter/emner
  semesterSid: "1031", // Vårsemester 2026
};

// USN Campus-koder som brukes i TimeEdit
export const USN_CAMPUSES = {
  "bo": { code: "BO", name: "Bo", aliases: ["bo", "boe", "bø"] },
  "drammen": { code: "DR", name: "Drammen", aliases: ["drammen", "dr"] },
  "kongsberg": { code: "KO", name: "Kongsberg", aliases: ["kongsberg", "ko"] },
  "ringerike": { code: "RI", name: "Ringerike", aliases: ["ringerike", "ri", "honefoss", "hønefoss"] },
  "vestfold": { code: "VE", name: "Vestfold", aliases: ["vestfold", "ve", "bakkenteigen", "horten"] },
  "porsgrunn": { code: "PO", name: "Porsgrunn", aliases: ["porsgrunn", "po"] },
} as const;

export type CampusId = keyof typeof USN_CAMPUSES;

export interface TimeEditConfig {
  baseUrl: string;
  organization?: string;
}

export interface TimeEditReservation {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  location: string | null;
  teacher: string | null;
  courseCode: string | null;
  activityType: string | null;
}

export interface TimeEditResponse {
  reservations: TimeEditReservation[];
  semester: string;
  courseCodes: string[];
  lastUpdated: string;
}

interface TimeEditSearchResult {
  objectId: string;
  name: string;
  courseCode: string;
}

/**
 * Ekstraherer emnekoder fra Canvas-kurs
 * Ser etter koder i kursnavnet eller course_code-feltet
 */
export function extractCourseCodesFromCanvasCourses(courses: CanvasCourse[]): string[] {
  const codes = new Set<string>();

  for (const course of courses) {
    // Prøv course_code først (mest pålitelig)
    if (course.course_code) {
      const matches = course.course_code.match(COURSE_CODE_REGEX);
      if (matches) {
        matches.forEach((code) => codes.add(code.toUpperCase()));
      }
    }

    // Prøv også kursnavnet
    if (course.name) {
      const matches = course.name.match(COURSE_CODE_REGEX);
      if (matches) {
        matches.forEach((code) => codes.add(code.toUpperCase()));
      }
    }
  }

  return Array.from(codes).sort();
}

/**
 * Beregner semesterperiode basert på dagens dato
 * Returnerer start- og sluttdato for gjeldende semester
 */
export function getSemesterPeriod(): { start: string; end: string; semester: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12

  // Norsk akademisk kalender:
  // Vår: Januar - Juni (uke 1-25)
  // Høst: August - Desember (uke 33-52)
  
  let start: Date;
  let end: Date;
  let semester: string;

  if (month >= 1 && month <= 6) {
    // Vårsemester
    start = new Date(year, 0, 1); // 1. januar
    end = new Date(year, 5, 30); // 30. juni
    semester = `Vår ${year}`;
  } else if (month >= 7 && month <= 7) {
    // Sommerferie - vis neste høstsemester
    start = new Date(year, 7, 1); // 1. august
    end = new Date(year, 11, 31); // 31. desember
    semester = `Høst ${year}`;
  } else {
    // Høstsemester
    start = new Date(year, 7, 1); // 1. august
    end = new Date(year, 11, 31); // 31. desember
    semester = `Høst ${year}`;
  }

  // Format: YYYY-MM-DD
  const formatDate = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  return {
    start: formatDate(start),
    end: formatDate(end),
    semester,
  };
}

/**
 * Henter gjeldende semester-suffix for TimeEdit-søk
 * F.eks. "2026_VÅR" eller "2025_HØST"
 */
function getCurrentSemesterSuffix(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  
  if (month >= 1 && month <= 7) {
    return `${year}_VÅR`;
  } else {
    return `${year}_HØST`;
  }
}

/**
 * Søker i TimeEdit etter emner basert på emnekode
 * Returnerer objekt-ID-er for gjeldende semester, filtrert på campus hvis oppgitt
 */
async function searchTimeEditObjects(courseCode: string, campus?: CampusId): Promise<TimeEditSearchResult[]> {
  const semesterSuffix = getCurrentSemesterSuffix();
  const searchUrl = `${TIMEEDIT_CONFIG.baseUrl}/objects.html?max=20&partajax=t&sid=${TIMEEDIT_CONFIG.semesterSid}&l=nb&types=${TIMEEDIT_CONFIG.searchType}&fe=132.0&search_text=${encodeURIComponent(courseCode)}`;
  
  // Hent campus-kode for filtrering
  const campusCode = campus ? USN_CAMPUSES[campus]?.code : null;
  
  try {
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "StudyWise/1.0",
        "Accept": "text/html",
      },
    });
    
    if (!response.ok) {
      logger.warn({ status: response.status, courseCode }, "TimeEdit søk feilet");
      return [];
    }
    
    const html = await response.text();
    
    // Parse HTML for å finne objekt-ID-er
    // Matcher: data-id="420049.199" data-name="Windows server og datanett, BO, ØIT, UE_222_6105N_1_2026_VÅR_1"
    const results: TimeEditSearchResult[] = [];
    const regex = /data-id="([^"]+)"[^>]*data-[^>]*data-name="([^"]+)"/g;
    let match;
    
    while ((match = regex.exec(html)) !== null) {
      const objectId = match[1];
      const name = match[2];
      
      // Filtrer kun resultater for gjeldende semester
      if (!name.includes(semesterSuffix)) {
        continue;
      }
      
      // Filtrer på campus hvis oppgitt
      // TimeEdit-navn inneholder campus-kode, f.eks. "Windows server og datanett, BO, ØIT, ..."
      // Format: "Emnenavn, CAMPUS, INSTITUTT, UE_xxx_EMNEKODE_..."
      if (campusCode) {
        // Normaliser navnet for sammenligning (fjern mellomrom rundt komma)
        const normalizedName = name.replace(/\s*,\s*/g, ",").toUpperCase();
        const parts = normalizedName.split(",");
        
        // Campus-koden er vanligvis i posisjon 1 (etter emnenavnet)
        // Sjekk om campus-koden finnes som en egen del i navnet
        const hasCampus = parts.some((part, index) => {
          // Ignorer første del (emnenavn) og siste del (UE_xxx...)
          if (index === 0 || index === parts.length - 1) return false;
          return part.trim() === campusCode;
        });
        
        if (!hasCampus) {
          logger.debug({ courseCode, campusCode, name, parts }, "Filtrerer bort (feil campus)");
          continue; // Hopp over hvis feil campus
        }
        logger.debug({ courseCode, campusCode, name }, "Beholder (riktig campus)");
      }
      
      results.push({
        objectId,
        name,
        courseCode: courseCode.toUpperCase(),
      });
    }
    
    logger.info({ courseCode, campus, campusCode, resultCount: results.length, semesterSuffix }, "TimeEdit søkeresultater");
    return results;
  } catch (error) {
    logger.error({ err: error, courseCode }, "Feil ved TimeEdit-søk");
    return [];
  }
}

/**
 * Hovedfunksjon: Søker automatisk etter alle emnekoder og henter timeplan
 * @param courseCodes - Liste med emnekoder fra Canvas
 * @param campus - Valgfri campus-ID for å filtrere resultater (f.eks. "bo", "drammen")
 */
export async function fetchTimeEditAutomatic(courseCodes: string[], campus?: CampusId): Promise<TimeEditResponse> {
  const period = getSemesterPeriod();
  const campusName = campus ? USN_CAMPUSES[campus]?.name : "alle";
  
  logger.info({ courseCodes, campus, campusName, semester: period.semester }, "Starter automatisk TimeEdit-søk");
  
  // Søk etter objekt-ID-er for hver emnekode
  const allObjectIds: string[] = [];
  const foundCodes: string[] = [];
  
  for (const code of courseCodes) {
    const results = await searchTimeEditObjects(code, campus);
    for (const result of results) {
      if (!allObjectIds.includes(result.objectId)) {
        allObjectIds.push(result.objectId);
        foundCodes.push(result.courseCode);
      }
    }
  }
  
  if (allObjectIds.length === 0) {
    logger.info({ courseCodes }, "Ingen TimeEdit-objekter funnet for emnekodene");
    return {
      reservations: [],
      semester: period.semester,
      courseCodes,
      lastUpdated: new Date().toISOString(),
    };
  }
  
  logger.info({ objectCount: allObjectIds.length, objectIds: allObjectIds }, "Fant TimeEdit-objekter");
  
  // Hent CSV med alle objektene
  const csvUrl = `${TIMEEDIT_CONFIG.baseUrl}/ri.csv?sid=${TIMEEDIT_CONFIG.semesterSid}&p=0.w,20.w&objects=${allObjectIds.join(",")}`;
  
  try {
    const response = await fetch(csvUrl, {
      headers: {
        "Accept": "text/csv",
        "User-Agent": "StudyWise/1.0",
      },
    });
    
    if (!response.ok) {
      logger.warn({ status: response.status }, "TimeEdit CSV-henting feilet");
      return {
        reservations: [],
        semester: period.semester,
        courseCodes: foundCodes,
        lastUpdated: new Date().toISOString(),
      };
    }
    
    const csvContent = await response.text();
    const reservations = parseTimeEditCsv(csvContent);
    
    logger.info({ reservationCount: reservations.length }, "Hentet TimeEdit-timeplan automatisk");
    
    return {
      reservations,
      semester: period.semester,
      courseCodes: foundCodes,
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    logger.error({ err: error }, "Feil ved henting av TimeEdit CSV");
    return {
      reservations: [],
      semester: period.semester,
      courseCodes: foundCodes,
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * Bygger TimeEdit CSV URL for å hente timeplan (legacy)
 * Bruker ri.csv-formatet som er tilgjengelig for offentlige TimeEdit-sider
 */
function buildTimeEditCsvUrl(
  baseUrl: string,
  objectIds: string[],
  _period: { start: string; end: string }
): string {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const objectsParam = objectIds.join(",");
  return `${cleanBase}/ri.csv?sid=${TIMEEDIT_CONFIG.semesterSid}&p=0.w,20.w&objects=${objectsParam}`;
}

/**
 * Parser CSV-respons fra TimeEdit
 * CSV-format varierer mellom institusjoner, men vanlige kolonner:
 * Startdato,Starttid,Sluttdato,Sluttid,Emne,Aktivitet,Rom,Lærer
 */
function parseTimeEditCsv(csvContent: string): TimeEditReservation[] {
  const reservations: TimeEditReservation[] = [];
  const lines = csvContent.split("\n");

  // Finn header-linje (første linje som inneholder "Startdato" eller lignende)
  let headerIndex = -1;
  let headers: string[] = [];

  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const line = lines[i].toLowerCase();
    if (
      line.includes("startdato") ||
      line.includes("start date") ||
      line.includes("datum") ||
      line.includes("emne")
    ) {
      headerIndex = i;
      headers = lines[i].split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));
      break;
    }
  }

  if (headerIndex === -1) {
    logger.warn({ firstLines: lines.slice(0, 3) }, "Kunne ikke finne header i TimeEdit CSV");
    return [];
  }

  // Logg header-kolonner for debugging
  logger.debug({ headers, headerIndex }, "TimeEdit CSV headers funnet");

  // Definer kolonneindekser basert på header
  const getColumnIndex = (possibleNames: string[]): number => {
    for (const name of possibleNames) {
      const idx = headers.findIndex((h) => h.includes(name));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const startDateCol = getColumnIndex(["startdato", "start date", "dato"]);
  const startTimeCol = getColumnIndex(["starttid", "start time", "tid"]);
  const endDateCol = getColumnIndex(["sluttdato", "end date"]);
  const endTimeCol = getColumnIndex(["sluttid", "end time"]);
  const subjectCol = getColumnIndex(["emne", "subject", "kurs", "course"]);
  const activityCol = getColumnIndex(["aktivitet", "activity", "type"]);
  const roomCol = getColumnIndex(["rom", "room", "lokale", "location"]);
  const teacherCol = getColumnIndex(["lærer", "teacher", "foreleser", "underviser"]);

  // Parser data-linjer
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Håndter CSV med komma inni anførselstegn
    const values = parseCSVLine(line);
    if (values.length < 4) continue;

    // Ekstraher data fra kolonner
    const startDate = values[startDateCol]?.replace(/"/g, "") || "";
    const startTime = values[startTimeCol]?.replace(/"/g, "") || "";
    const endDate = values[endDateCol]?.replace(/"/g, "") || startDate;
    const endTime = values[endTimeCol]?.replace(/"/g, "") || "";
    const subject = values[subjectCol]?.replace(/"/g, "") || "";
    const activity = values[activityCol]?.replace(/"/g, "") || "";
    const room = values[roomCol]?.replace(/"/g, "") || null;
    const teacher = values[teacherCol]?.replace(/"/g, "") || null;

    // Valider at vi har nødvendig data
    if (!startDate || !startTime) continue;

    // Finn emnekode fra subject-feltet
    // Prøv først standard emnekode-format
    let courseCode: string | null = null;
    const codeMatch = subject.match(COURSE_CODE_REGEX);
    if (codeMatch) {
      courseCode = codeMatch[0].toUpperCase();
    }
    
    // Hvis ikke funnet, prøv UE-format (f.eks. "UE_222_BOP3000_1_2026")
    if (!courseCode) {
      const ueMatch = subject.match(UE_CODE_REGEX);
      if (ueMatch && ueMatch[1]) {
        courseCode = ueMatch[1].toUpperCase();
      }
    }
    
    // Prøv også å finne i aktivitetsfeltet
    if (!courseCode && activity) {
      const activityMatch = activity.match(COURSE_CODE_REGEX);
      if (activityMatch) {
        courseCode = activityMatch[0].toUpperCase();
      }
    }
    
    // Logg hvis vi ikke finner emnekode
    if (!courseCode) {
      logger.debug({ subject, activity, startDate, startTime }, "Kunne ikke finne emnekode i TimeEdit-rad");
    }
    
    // Logg de første radene for debugging
    if (reservations.length < 3) {
      logger.debug({ 
        subject, 
        activity, 
        courseCode, 
        values: values.slice(0, 8) 
      }, "TimeEdit CSV rad (debug)");
    }

    // Lag ISO-datostrenger
    const startDateTime = combineDateAndTime(startDate, startTime);
    const endDateTime = endTime ? combineDateAndTime(endDate, endTime) : null;

    if (!startDateTime) continue;

    reservations.push({
      id: `timeedit-${startDateTime}-${courseCode || subject}`,
      title: subject || "Ukjent aktivitet",
      startTime: startDateTime,
      endTime: endDateTime || startDateTime,
      location: room,
      teacher,
      courseCode,
      activityType: activity || null,
    });
  }

  return reservations;
}

/**
 * Parser en CSV-linje med respekt for anførselstegn
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());

  return result;
}

/**
 * Kombinerer dato og tid til ISO-streng
 */
function combineDateAndTime(date: string, time: string): string | null {
  try {
    // Håndter forskjellige datoformater
    // DD.MM.YYYY, YYYY-MM-DD, DD/MM/YYYY
    let year: number, month: number, day: number;

    if (date.includes(".")) {
      // DD.MM.YYYY
      const parts = date.split(".");
      day = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10);
      year = parseInt(parts[2], 10);
    } else if (date.includes("-")) {
      // YYYY-MM-DD
      const parts = date.split("-");
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10);
      day = parseInt(parts[2], 10);
    } else if (date.includes("/")) {
      // DD/MM/YYYY
      const parts = date.split("/");
      day = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10);
      year = parseInt(parts[2], 10);
    } else {
      return null;
    }

    // Håndter tid (HH:MM eller HH:MM:SS)
    const timeParts = time.split(":");
    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);
    const seconds = timeParts[2] ? parseInt(timeParts[2], 10) : 0;

    const dateObj = new Date(year, month - 1, day, hours, minutes, seconds);
    return dateObj.toISOString();
  } catch {
    return null;
  }
}

/**
 * Henter timeplan fra TimeEdit via CSV-eksport
 * Dette er hovedfunksjonen som brukes av API-rutene
 */
export async function fetchTimeEditSchedule(
  baseUrl: string,
  courseCodes: string[]
): Promise<TimeEditResponse> {
  const period = getSemesterPeriod();

  logger.info(
    {
      url: `${baseUrl.substring(0, 60)}...`,
      courseCodes,
      semester: period.semester,
    },
    "Henter TimeEdit-timeplan"
  );

  // Bygg CSV URL
  const csvUrl = buildTimeEditCsvUrl(baseUrl, courseCodes, period);

  try {
    const response = await fetch(csvUrl, {
      headers: {
        Accept: "text/csv",
        "User-Agent": "StudyWise/1.0",
      },
    });

    if (!response.ok) {
      logger.warn(
        {
          status: response.status,
          statusText: response.statusText,
          url: csvUrl,
        },
        "TimeEdit CSV-forespørsel feilet"
      );

      // Returner tom respons i stedet for å kaste feil
      return {
        reservations: [],
        semester: period.semester,
        courseCodes,
        lastUpdated: new Date().toISOString(),
      };
    }

    const csvContent = await response.text();

    // Parser CSV
    const reservations = parseTimeEditCsv(csvContent);

    logger.info(
      {
        reservationCount: reservations.length,
        courseCodes,
      },
      "Hentet TimeEdit-timeplan"
    );

    return {
      reservations,
      semester: period.semester,
      courseCodes,
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    logger.error({ err: error, url: csvUrl }, "Feil ved henting av TimeEdit-timeplan");

    // Returner tom respons ved feil
    return {
      reservations: [],
      semester: period.semester,
      courseCodes,
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * Henter timeplan fra en full TimeEdit-URL (fra brukerens nettleser)
 * Konverterer .html URL til .csv for maskinlesbar data
 */
export async function fetchTimeEditFromUrl(url: string): Promise<TimeEditResponse> {
  const period = getSemesterPeriod();
  
  logger.info({ url: url.substring(0, 80) + "..." }, "Henter TimeEdit fra bruker-URL");
  
  // Konverter URL fra .html til .csv format
  // Eksempel: ri1Q5075.html -> ri1Q5075.csv
  // eller: ri.html?... -> ri.csv?...
  let csvUrl = url
    .replace(/\.html(\?|$)/, '.csv$1')
    .replace(/\.html#.*/, '.csv');
  
  // Hvis URL ikke inneholder .csv, legg til
  if (!csvUrl.includes('.csv')) {
    // Prøv å legge til .csv til enden av path
    const urlObj = new URL(csvUrl);
    if (!urlObj.pathname.endsWith('.csv')) {
      urlObj.pathname = urlObj.pathname.replace(/\/?$/, '.csv');
      csvUrl = urlObj.toString();
    }
  }
  
  try {
    const response = await fetch(csvUrl, {
      headers: {
        Accept: "text/csv",
        "User-Agent": "StudyWise/1.0",
      },
    });
    
    if (!response.ok) {
      logger.warn({
        status: response.status,
        statusText: response.statusText,
        csvUrl,
      }, "TimeEdit URL-forespørsel feilet");
      
      return {
        reservations: [],
        semester: period.semester,
        courseCodes: [],
        lastUpdated: new Date().toISOString(),
      };
    }
    
    const csvContent = await response.text();
    const reservations = parseTimeEditCsv(csvContent);
    
    // Ekstraher emnekoder fra reservasjonene
    const courseCodes = [...new Set(
      reservations
        .map(r => r.courseCode)
        .filter((code): code is string => !!code)
    )];
    
    logger.info({
      reservationCount: reservations.length,
      courseCodes,
    }, "Hentet TimeEdit fra URL");
    
    return {
      reservations,
      semester: period.semester,
      courseCodes,
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    logger.error({ err: error, csvUrl }, "Feil ved henting av TimeEdit fra URL");
    
    return {
      reservations: [],
      semester: period.semester,
      courseCodes: [],
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * Konverterer TimeEdit-reservasjoner til kalender-format (CalendarItem)
 * Brukes for å kombinere med Canvas-kalender
 */
export function convertToCalendarItems(
  reservations: TimeEditReservation[]
): CalendarItem[] {
  return reservations.map((reservation) => {
    // Prøv å finne emnekode fra ulike kilder
    let courseCode = reservation.courseCode;
    
    // Hvis courseCode mangler, prøv å ekstrahere fra tittelen
    if (!courseCode && reservation.title) {
      const titleMatch = reservation.title.match(COURSE_CODE_REGEX);
      if (titleMatch) {
        courseCode = titleMatch[0].toUpperCase();
      } else {
        // Prøv UE-format i tittelen
        const ueMatch = reservation.title.match(UE_CODE_REGEX);
        if (ueMatch && ueMatch[1]) {
          courseCode = ueMatch[1].toUpperCase();
        }
      }
    }
    
    return {
      id: `timeedit-${reservation.id}`,
      title: reservation.title,
      due_at: reservation.startTime,
      end_at: reservation.endTime,
      source: "timetable" as const,
      course_id: null,
      course_name: courseCode || reservation.title || "Timeplan",
      course_code: courseCode || undefined,
      html_url: null,
      location: reservation.location || undefined,
      teacher: reservation.teacher || undefined,
      activity_type: reservation.activityType || undefined,
    };
  });
}
