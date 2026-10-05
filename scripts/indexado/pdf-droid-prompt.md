You are a data-extraction tool. Read the fencing results PDF at this path with your Read tool:

{{PDF_PATH}}

The document is published by the Spanish Fencing Federation (RFEE). It has {{PAGES}} pages. It may contain one or several competitions (weapon + gender + category + individual/team). Extract every competition it contains.

Completeness is the goal: read ALL {{PAGES}} pages before answering. If the Read tool returns only part of the document, call it again for the remaining pages until you have seen every page. Extract EVERY pool bout from EVERY pool matrix and EVERY elimination bout from EVERY tableau page; do not summarise, sample or stop early, even if the answer becomes long.

Rules (mandatory):
- Use only the Read tool, and only on the file above. Do not search the web or read any other file.
- Copy every person, team and club name EXACTLY as printed (same spelling, order, accents and capitalisation). Never translate, reorder, complete, correct or invent a name, score or position.
- If a section exists but you cannot read part of it, include only what you can read with certainty and mark that section "parcial". Never guess.
- If a section is not present in the document, return an empty list and mark it "sin_resultados".
- If the whole document is unreadable, return the competitions you can identify with status "ilegible".
- Answer with ONE JSON object and nothing else: no markdown fences, no comments, no explanation.

JSON shape:

{
  "documentTitle": string | null,
  "competitions": [
    {
      "headerLines": [string],
      "weapon": "FLORETE" | "ESPADA" | "SABLE",
      "gender": "M" | "F" | "MIXTO",
      "category": "M7" | "M9" | "M10" | "M11" | "M12" | "M13" | "M14" | "M15" | "M17" | "M20" | "M23" | "ABS" | "VET",
      "categoryRaw": string | null,
      "format": "INDIVIDUAL" | "EQUIPOS",
      "date": "YYYY-MM-DD" | null,
      "pages": [number],
      "publishedParticipants": number | null,
      "status": {
        "results": "completo" | "parcial" | "sin_resultados" | "ilegible",
        "pools": "completo" | "parcial" | "sin_resultados" | "ilegible",
        "tableau": "completo" | "parcial" | "sin_resultados" | "ilegible"
      },
      "results": [
        { "position": number | null, "positionRaw": string | null, "name": string, "club": string | null, "country": string | null }
      ],
      "pools": [
        { "pool": number, "fencers": [string], "bouts": [ { "aName": string, "bName": string, "scoreA": number, "scoreB": number, "winner": "A" | "B" | null } ] }
      ],
      "tableau": [
        { "round": string, "aName": string, "bName": string, "scoreA": number, "scoreB": number, "winner": "A" | "B" | null }
      ],
      "notes": [string]
    }
  ]
}

Field guidance:
- headerLines: the title lines of that competition copied verbatim, including the line that names the weapon (for example "ESPADA MASCULINA M-17 INDIVIDUAL" or "Florete Femenino Categoría 1"). If the weapon line carries extra text such as a birth year or "Categoría 0-1", keep it verbatim.
- category: M-17 / Cadete = M17, M-20 / Junior = M20, M-15 / Infantil = M15, M-23 / Sub-23 = M23, Absoluto / Senior = ABS, Veteranos = VET, M-13, M-14, M-12, M-11, M-10, M-9, M-7 as written. categoryRaw is the category text as printed.
- date: the competition date printed in the document, if any.
- pages: 1-based page numbers where the competition appears.
- publishedParticipants: the number of participants declared by the document, if declared.
- results: the FINAL classification only, in printed order. position is the numeric rank (ties keep the same number, e.g. 3 and 3). Rows without a numeric rank (DNS, abandono, excluido) have position null and positionRaw with the printed text. For team events, name is the team name. country is the 3-letter code if printed (e.g. ESP), else null. club as printed, else null.
- pools: one entry per pool (poule). fencers lists the fencers in printed order. From the pool matrix, list each bout ONCE (pair i<j): aName is the fencer in row i, bName the fencer in row j, scoreA = touches scored by A against B, scoreB = touches scored by B against A. A cell "V" or "V5" means a victory; "D3" means a defeat with 3 touches; a "V" without a number in a 5-touch pool means 5. winner is "A" or "B" from the V/D marks; use null only if not printed.
- tableau: elimination bouts. round is "T" + the table size: T256, T128, T64, T32, T16, T8 (quarter-finals), T4 (semi-finals), T2 (final); a bronze bout is "T2-3". scoreA/scoreB are the printed scores; winner is the fencer who advances. Skip byes (exento) and bouts without a printed score.
- status values describe how much of each section you could extract: "completo" only if you extracted every row of that section.
{{ALCANCE}}
