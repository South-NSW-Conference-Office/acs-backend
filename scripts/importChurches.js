/**
 * Import Churches from SNSW Staff List CSV
 *
 * This script parses the CSV file and creates Church documents in MongoDB.
 * It extracts:
 * - Ministers/Pastors and their church assignments
 * - ACS Leaders and their contact info
 *
 * Usage: node scripts/importChurches.js [path-to-csv]
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const Church = require('../models/Church');
const Conference = require('../models/Conference');

// Default CSV path
const DEFAULT_CSV_PATH = path.join(
  'C:',
  'Users',
  'Bem Orchestrator',
  'Downloads',
  'SNSW Staff List 2025 - 2025.csv'
);

/**
 * Parse CSV content into rows
 */
function parseCSV(content) {
  const lines = content.split('\n');
  const rows = [];

  for (const line of lines) {
    // Handle quoted fields with commas inside
    const row = [];
    let inQuotes = false;
    let field = '';

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(field.trim());
        field = '';
      } else {
        field += char;
      }
    }
    row.push(field.trim()); // Push last field
    rows.push(row);
  }

  return rows;
}

/**
 * Extract ministers from rows 2-27
 * Returns: Map<churchName, minister[]>
 */
function extractMinisters(rows) {
  const ministersMap = new Map();

  // Rows 2-27 (index 1-26) contain ministers
  for (let i = 1; i <= 26; i++) {
    const row = rows[i];
    if (!row || row.length < 5) continue;

    const ministerName = row[1]?.trim();
    const churchesStr = row[3]?.trim();
    const mobile = row[4]?.trim();
    const email = row[5]?.trim();

    if (!ministerName || !churchesStr) continue;

    // Skip non-church entries
    if (
      churchesStr === 'Regional Mentor' ||
      churchesStr === 'Maternity leave'
    ) {
      continue;
    }

    // Split churches by comma and clean up
    const churches = churchesStr.split(',').map((c) => c.trim());

    for (const churchName of churches) {
      if (!churchName) continue;

      // Normalize church name
      const normalizedName = normalizeChurchName(churchName);

      if (!ministersMap.has(normalizedName)) {
        ministersMap.set(normalizedName, []);
      }

      ministersMap.get(normalizedName).push({
        name: ministerName,
        phone: mobile,
        email: email,
        title: 'Pastor',
      });
    }
  }

  return ministersMap;
}

/**
 * Extract ACS Leaders from rows 89-125
 * Returns: Map<churchName, acsLeader>
 */
function extractACSLeaders(rows) {
  const acsMap = new Map();

  // Rows 90-125 (index 89-124) contain ACS leaders
  for (let i = 89; i <= 124; i++) {
    const row = rows[i];
    if (!row || row.length < 4) continue;

    const leaderName = row[1]?.trim();
    const email = row[2]?.trim();
    const phone = row[3]?.trim();
    const churchName = row[4]?.trim();

    if (!churchName) continue;

    // Skip chaplaincy entries for church list (we'll still create the church)
    const normalizedName = normalizeChurchName(churchName);

    if (leaderName) {
      acsMap.set(normalizedName, {
        name: leaderName,
        email: email,
        phone: phone,
      });
    } else if (!acsMap.has(normalizedName)) {
      // Create entry with null leader so church still gets created
      acsMap.set(normalizedName, null);
    }
  }

  return acsMap;
}

/**
 * Normalize church name for consistent matching
 */
function normalizeChurchName(name) {
  return name
    .replace(/\s*\(CHAPLAIN\)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Determine state from church name
 */
function determineState(churchName) {
  const actChurches = [
    'Canberra National',
    'South Canberra',
    'Charnwood',
    'Pillar O Fire',
    'Canberra Christian School',
  ];
  const vicChurches = ['Wodonga English', 'Wodonga Slavic'];

  const normalizedName = churchName.toLowerCase();

  for (const act of actChurches) {
    if (normalizedName.includes(act.toLowerCase())) {
      return 'ACT';
    }
  }

  for (const vic of vicChurches) {
    if (normalizedName.includes(vic.toLowerCase())) {
      return 'VIC';
    }
  }

  return 'NSW';
}

/**
 * Build unique church list from all sources
 */
function buildChurchList(ministersMap, acsMap) {
  const churches = new Map();

  // Add churches from ministers
  for (const churchName of ministersMap.keys()) {
    if (!churches.has(churchName)) {
      churches.set(churchName, {
        name: churchName,
        ministers: ministersMap.get(churchName) || [],
        acsLeader: null,
        state: determineState(churchName),
      });
    }
  }

  // Add/update churches from ACS leaders
  for (const churchName of acsMap.keys()) {
    if (churches.has(churchName)) {
      churches.get(churchName).acsLeader = acsMap.get(churchName);
    } else {
      churches.set(churchName, {
        name: churchName,
        ministers: [],
        acsLeader: acsMap.get(churchName),
        state: determineState(churchName),
      });
    }
  }

  return churches;
}

/**
 * Main import function
 */
async function importChurches(csvPath) {
  console.log('Starting church import...');
  console.log(`CSV Path: ${csvPath}`);

  // Read CSV file
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseCSV(csvContent);
  console.log(`Parsed ${rows.length} rows from CSV`);

  // Extract data
  const ministersMap = extractMinisters(rows);
  console.log(`Found ${ministersMap.size} churches with ministers`);

  const acsMap = extractACSLeaders(rows);
  console.log(`Found ${acsMap.size} churches from ACS leaders list`);

  // Build complete church list
  const churchList = buildChurchList(ministersMap, acsMap);
  console.log(`Total unique churches to import: ${churchList.size}`);

  // Connect to MongoDB
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  // Find South NSW Conference
  const conference = await Conference.findOne({
    name: { $regex: /south.*nsw|snsw/i },
    isActive: true,
  });

  if (!conference) {
    throw new Error(
      'South NSW Conference not found. Please create it first or check the name.'
    );
  }

  console.log(`Found conference: ${conference.name} (${conference._id})`);

  // Import churches
  let created = 0;
  let skipped = 0;
  let updated = 0;

  for (const [churchName, data] of churchList) {
    // Check if church already exists
    const existing = await Church.findOne({
      name: churchName,
      conferenceId: conference._id,
    });

    if (existing) {
      // Update existing church with new data if ministers/ACS leader changed
      let needsUpdate = false;
      const updates = {};

      if (
        data.acsLeader &&
        (!existing.leadership.acsCoordinator ||
          existing.leadership.acsCoordinator.name !== data.acsLeader.name)
      ) {
        updates['leadership.acsCoordinator'] = data.acsLeader;
        needsUpdate = true;
      }

      if (
        data.ministers.length > 0 &&
        existing.leadership.associatePastors.length === 0
      ) {
        updates['leadership.associatePastors'] = data.ministers;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await Church.findByIdAndUpdate(existing._id, { $set: updates });
        console.log(`  Updated: ${churchName}`);
        updated++;
      } else {
        console.log(`  Skipped (already exists): ${churchName}`);
        skipped++;
      }
      continue;
    }

    // Create new church
    const church = new Church({
      name: churchName,
      conferenceId: conference._id,
      hierarchyPath: `${conference.hierarchyPath}/${new mongoose.Types.ObjectId()}`,
      location: {
        address: {
          state: data.state,
          country: 'Australia',
        },
      },
      leadership: {
        associatePastors: data.ministers,
        acsCoordinator: data.acsLeader,
      },
      isActive: true,
    });

    await church.save();
    console.log(`  Created: ${churchName} (${data.state})`);
    created++;
  }

  console.log('\n--- Import Summary ---');
  console.log(`Created: ${created}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total processed: ${churchList.size}`);

  // Verify
  const totalChurches = await Church.countDocuments({
    conferenceId: conference._id,
    isActive: true,
  });
  console.log(`\nTotal churches in ${conference.name}: ${totalChurches}`);

  await mongoose.connection.close();
  console.log('Database connection closed');
}

// CLI entry point
if (require.main === module) {
  const csvPath = process.argv[2] || DEFAULT_CSV_PATH;

  importChurches(csvPath)
    .then(() => {
      console.log('\nImport completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\nImport failed:', error.message);
      if (process.env.NODE_ENV === 'development') {
        console.error(error.stack);
      }
      process.exit(1);
    });
}

module.exports = { importChurches };
