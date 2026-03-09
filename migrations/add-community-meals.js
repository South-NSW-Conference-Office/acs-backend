/**
 * Migration: Add communityMeal data to churches
 * Run: node migrations/add-community-meals.js [--execute]
 * Default: dry-run (shows what would change)
 */
const mongoose = require('mongoose');
require('dns').setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const MONGO_URI = process.env.MONGO_URI || 
  'mongodb+srv://adminbem:digitalmission2126@snswcluster.wrvm8i.mongodb.net/adventistcommunityservices?retryWrites=true&w=majority';

const MEAL_DATA = [
  { name: 'Albury',         day: 'Saturday',              time: '12:30 PM' },
  { name: 'Bathurst',       day: 'Saturday',              time: '1:00 PM'  },
  { name: 'Cootamundra',    day: 'Saturday',              time: '12:30 PM' },
  { name: 'Cowra',           day: 'Saturday',              time: '1:00 PM'  },
  { name: 'Dubbo',           day: 'Saturday',              time: '12:30 PM' },
  { name: 'Goulburn',       day: 'Saturday',              time: '12:30 PM' },
  { name: 'Griffith',       day: 'Saturday',              time: '12:30 PM' },
  { name: 'Lithgow',        day: 'Saturday',              time: '12:45 PM' },
  { name: 'Mudgee',         day: 'Saturday',              time: '12:45 PM' },
  { name: 'Charnwood',      day: 'Saturday',              time: '12:30 PM' },
  { name: 'Oberon',         day: 'Saturday',              time: '12:45 PM' },
  { name: 'Parkes',         day: 'Saturday',              time: '12:30 PM' },
  { name: 'Queanbeyan',     day: 'Saturday',              time: '1:00 PM'  },
  { name: 'South Canberra', day: '1st & 3rd Saturday',    time: ''         },
  { name: 'Wodonga',        day: 'Saturday',              time: '12:30 PM' },
  { name: 'Narrandera',     day: 'Saturday',              time: '12:30 PM' },
  { name: 'Cobar',          day: 'Saturday',              time: '12:30 PM' },
];

// South NSW Conference ID
const SNSW_CONF_ID = '692fc54d0e9263c33670487b';

const execute = process.argv.includes('--execute');

async function run() {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  const churches = db.collection('churches');

  console.log(`\n${execute ? '🔥 EXECUTING' : '🔍 DRY RUN'} — Community Meal Migration\n`);

  let updated = 0, skipped = 0, notFound = 0;

  for (const meal of MEAL_DATA) {
    // Find active church in SNSW conference by name
    const church = await churches.findOne({
      name: meal.name,
      conferenceId: new mongoose.Types.ObjectId(SNSW_CONF_ID),
      isActive: true,
    });

    if (!church) {
      console.log(`❌ NOT FOUND: "${meal.name}" (active, SNSW conference)`);
      notFound++;
      continue;
    }

    // Check if already has communityMeal
    if (church.services?.communityMeal?.day) {
      console.log(`⏭️  SKIP: "${meal.name}" — already has communityMeal: ${church.services.communityMeal.day} ${church.services.communityMeal.time}`);
      skipped++;
      continue;
    }

    console.log(`✅ ${meal.name} → ${meal.day} ${meal.time} (${church._id})`);

    if (execute) {
      await churches.updateOne(
        { _id: church._id },
        { $set: { 
          'services.communityMeal': {
            day: meal.day,
            time: meal.time,
            description: 'Community fellowship meal',
          }
        }}
      );
    }
    updated++;
  }

  console.log(`\n--- Summary ---`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Not found: ${notFound}`);
  if (!execute) console.log(`\nRun with --execute to apply changes.`);

  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
