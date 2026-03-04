/**
 * Clean SMM church data and import to MongoDB
 * Run with: node scripts/clean-smm-data.js
 */

const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config();

// Import models
require('../models/Union');
require('../models/Conference');
require('../models/Church');

const Union = mongoose.model('Union');
const Conference = mongoose.model('Conference');
const Church = mongoose.model('Church');

// Load raw parsed data
const rawData = JSON.parse(
  fs.readFileSync('D:\\Adventist Community Services\\backend\\scripts\\smm-churches.json', 'utf-8')
);

// Clean up the data
function cleanData(data) {
  const cleaned = [];
  const seen = new Set();

  for (const entry of data) {
    let { name, sector, type, members, city } = entry;

    // Skip invalid entries
    if (!name || !type) continue;

    // Skip page headers/footers
    if (name.includes('Janine Genodipa') || name.includes('Members Period') || name.includes('Page')) {
      continue;
    }

    // Skip entries with member counts that look like totals (> 5000)
    if (members > 5000) continue;

    // Clean name - remove leading numbers
    name = name.replace(/^\d+\s+/, '');

    // Extract sector from concatenated names like "SMM Koronadal I 64 Almotag - Koronadal"
    const sectorMatch = name.match(/^(SMM\s+[A-Za-z0-9'\s]+?)\s+\d+\s+(.+)$/);
    if (sectorMatch) {
      sector = sectorMatch[1].trim();
      name = sectorMatch[2].trim();
    }

    // Remove pastor names from entries
    const pastorMatch = name.match(/^([A-Z][a-z]+\s+[A-Z][a-z\.]+\s+[A-Z][a-z]+)\s+SMM\s+/);
    if (pastorMatch) {
      // This is a pastor name followed by sector - skip the pastor name
      const afterPastor = name.replace(pastorMatch[0], 'SMM ');
      const sectorMatch2 = afterPastor.match(/^(SMM\s+[A-Za-z0-9'\s]+?)\s+\d+\s+(.+)$/);
      if (sectorMatch2) {
        sector = sectorMatch2[1].trim();
        name = sectorMatch2[2].trim();
      } else {
        continue; // Skip this entry
      }
    }

    // Clean up city
    if (city === 'Unknown' || city.includes('Church ')) {
      city = city.replace('Church ', '');
    }
    if (!city || city === 'Unknown') {
      // Try to infer from sector name
      city = 'General Santos City-South Cotabato';
    }

    // Normalize name
    name = name.trim();
    if (!name || name.length < 2) continue;

    // Create unique key
    const key = `${name.toLowerCase()}|${city.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    cleaned.push({
      name,
      sector: sector || 'SMM Unknown',
      type,
      members,
      city
    });
  }

  return cleaned;
}

async function importChurches() {
  try {
    console.log('Cleaning data...');
    const cleanedData = cleanData(rawData);
    console.log(`Cleaned: ${cleanedData.length} valid entries from ${rawData.length} raw entries`);

    // Get unique sectors
    const sectors = [...new Set(cleanedData.map(c => c.sector))].sort();
    console.log('\nSectors found:', sectors.length);
    sectors.forEach(s => console.log(' -', s));

    console.log('\nConnecting to MongoDB...');
    await mongoose.connect(
      process.env.MONGODB_URI ||
        'mongodb+srv://adminbem:digitalmission2126@gyocc.97c8il.mongodb.net/acs_dev?retryWrites=true&w=majority&appName=GYOCC'
    );
    console.log('Connected to MongoDB');

    // Find SEPUM union and SMM conference
    const sepum = await Union.findOne({ code: 'SEPUM' });
    if (!sepum) {
      throw new Error('SEPUM union not found. Run setup-sepum.js first.');
    }

    const smm = await Conference.findOne({
      unionId: sepum._id,
      name: 'Southern Mindanao Mission',
    });
    if (!smm) {
      throw new Error('SMM conference not found. Run setup-sepum.js first.');
    }

    console.log('\nUnion:', sepum.name, `(${sepum.code})`);
    console.log('Conference:', smm.name);

    // Ask for confirmation
    console.log(`\nReady to import ${cleanedData.length} churches to SMM.`);
    console.log('Proceeding with import...\n');

    // Import churches
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const data of cleanedData) {
      try {
        // Check if church already exists
        const existing = await Church.findOne({
          conferenceId: smm._id,
          name: data.name,
        });

        if (existing) {
          console.log(`Skipping (exists): ${data.name}`);
          skipped++;
          continue;
        }

        // Parse city into location parts
        const cityParts = data.city.split('-');
        const city = cityParts[0].trim();
        const state = cityParts[1] ? cityParts[1].trim() : 'South Cotabato';

        // Create church (code auto-generated)
        const church = new Church({
          name: data.name,
          conferenceId: smm._id,
          location: {
            address: {
              city,
              state,
              country: 'Philippines',
            },
          },
          settings: {
            acsSettings: {
              specialRequirements: [`Sector: ${data.sector}`, `Type: ${data.type}`, `Members: ${data.members}`],
            },
          },
          isActive: true,
          metadata: {
            teamCount: 0,
            serviceCount: 0,
            lastUpdated: new Date(),
          },
        });

        await church.save();
        console.log(`✓ ${church.code}: ${data.name} (${data.type}, ${data.members} members)`);
        imported++;
      } catch (err) {
        console.error(`✗ Error importing ${data.name}:`, err.message);
        errors++;
      }
    }

    console.log(`\n=== IMPORT COMPLETE ===`);
    console.log(`Imported: ${imported}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Errors: ${errors}`);
    console.log(`Total processed: ${imported + skipped + errors}`);

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run
importChurches();
