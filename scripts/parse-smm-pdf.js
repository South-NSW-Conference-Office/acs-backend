/**
 * Parse SMM PDF data into JSON
 * Run with: node scripts/parse-smm-pdf.js > smm-churches.json
 */

const fs = require('fs');
const PDFParser = require('pdf2json');

const pdfPath = 'C:\\Users\\BEM ORCHESTRATOR\\Downloads\\Churches entire SMM.pdf';

const pdfParser = new PDFParser(null, 1);

pdfParser.on('pdfParser_dataError', errData => {
  console.error('Error:', errData.parserError);
  process.exit(1);
});

pdfParser.on('pdfParser_dataReady', pdfData => {
  // Get raw text from all pages
  let text = '';
  
  if (pdfData.Pages) {
    for (const page of pdfData.Pages) {
      if (page.Texts) {
        for (const textItem of page.Texts) {
          if (textItem.R) {
            for (const r of textItem.R) {
              text += decodeURIComponent(r.T) + ' ';
            }
          }
        }
        text += '\n';
      }
    }
  }

  // Parse the text
  const churches = parseChurchData(text);
  
  // Output as JSON
  console.log(JSON.stringify(churches, null, 2));
  
  // Also write to file
  fs.writeFileSync(
    'D:\\Adventist Community Services\\backend\\scripts\\smm-churches.json',
    JSON.stringify(churches, null, 2)
  );
  console.error(`\nParsed ${churches.length} churches. Saved to smm-churches.json`);
  
  process.exit(0);
});

function parseChurchData(text) {
  const churches = [];
  let currentSector = null;
  let currentPastor = null;

  // Clean up text and split into tokens
  const tokens = text.split(/\s+/);
  
  let i = 0;
  while (i < tokens.length) {
    // Look for sector pattern: "SMM" followed by sector name
    if (tokens[i] === 'SMM' && i + 1 < tokens.length) {
      // Build sector name until we hit a number (member count)
      let sectorName = 'SMM';
      i++;
      while (i < tokens.length && !/^\d/.test(tokens[i])) {
        sectorName += ' ' + tokens[i];
        i++;
      }
      // Clean up sector name
      sectorName = sectorName.trim();
      if (sectorName !== 'SMM' && !sectorName.includes('Southern Mindanao Mission')) {
        currentSector = sectorName;
      }
      continue;
    }

    // Look for church pattern: number followed by name, then Church/Company, then city
    if (/^\d/.test(tokens[i])) {
      const memberCount = parseInt(tokens[i].replace(/[.,]/g, ''), 10);
      
      // Skip if this looks like a total or page number
      if (isNaN(memberCount) || memberCount > 10000) {
        i++;
        continue;
      }

      // Collect church name until we hit "Church" or "Company"
      let churchName = '';
      i++;
      while (i < tokens.length && tokens[i] !== 'Church' && tokens[i] !== 'Company') {
        churchName += (churchName ? ' ' : '') + tokens[i];
        i++;
      }

      if (i >= tokens.length) break;

      const churchType = tokens[i]; // Church or Company
      i++;

      // Collect city until we hit another number or SMM
      let city = '';
      while (i < tokens.length && !/^\d/.test(tokens[i]) && tokens[i] !== 'SMM' && tokens[i] !== 'Page') {
        // Skip pastor names that appear after totals
        if (/^[A-Z][a-z]+$/.test(tokens[i]) && /^[A-Z][a-z]+$/.test(tokens[i + 1])) {
          // Likely a pastor name - skip
          break;
        }
        city += (city ? ' ' : '') + tokens[i];
        i++;
      }

      // Only add if we have valid data
      if (churchName && churchType && currentSector) {
        churches.push({
          sector: currentSector,
          name: churchName.trim(),
          type: churchType,
          members: memberCount,
          city: city.trim() || 'Unknown',
        });
      }

      continue;
    }

    i++;
  }

  return churches;
}

console.error('Loading PDF...');
pdfParser.loadPDF(pdfPath);
