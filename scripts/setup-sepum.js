/**
 * Setup SEPUM (Southeastern Philippine Union Mission) and SMM (Southern Mindanao Mission)
 * Run with: node scripts/setup-sepum.js
 */

const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const mongoose = require('mongoose');
require('dotenv').config();

// Import models
require('../models/Union');
require('../models/Conference');
require('../models/Church');

const Union = mongoose.model('Union');
const Conference = mongoose.model('Conference');

async function setupSEPUM() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(
      process.env.MONGODB_URI ||
        'mongodb+srv://adminbem:digitalmission2126@gyocc.97c8il.mongodb.net/acs_dev?retryWrites=true&w=majority&appName=GYOCC'
    );
    console.log('Connected to MongoDB');

    // Check if SEPUM already exists
    let sepum = await Union.findOne({ code: 'SEPUM' });

    if (sepum) {
      console.log('SEPUM already exists:', sepum._id);
    } else {
      // Create SEPUM Union
      sepum = new Union({
        name: 'Southeastern Philippine Union Mission',
        code: 'SEPUM',
        division: {
          name: 'Southern Asia-Pacific Division',
          code: 'SSD',
          headquarters: {
            city: 'Silang',
            country: 'Philippines',
          },
        },
        territory: {
          description:
            'Covers the southeastern regions of the Philippines including Mindanao',
        },
        headquarters: {
          city: 'General Santos',
          state: 'South Cotabato',
          country: 'Philippines',
          postalCode: '9500',
        },
        contact: {
          email: '',
          phone: '',
          website: '',
        },
        settings: {
          fiscalYearStart: 'January',
          defaultCurrency: 'PHP',
          languages: [
            { code: 'en', name: 'English', isPrimary: true },
            { code: 'ceb', name: 'Cebuano', isPrimary: false },
            { code: 'fil', name: 'Filipino', isPrimary: false },
          ],
        },
        isActive: true,
        metadata: {
          churchCount: 0,
          lastUpdated: new Date(),
        },
      });

      await sepum.save();
      console.log('Created SEPUM Union:', sepum._id);
    }

    // Check if SMM already exists
    let smm = await Conference.findOne({
      unionId: sepum._id,
      name: 'Southern Mindanao Mission',
    });

    if (smm) {
      console.log('SMM already exists:', smm._id);
    } else {
      // Create SMM Conference
      smm = new Conference({
        name: 'Southern Mindanao Mission',
        unionId: sepum._id,
        territory: {
          description:
            'Covers the southern Mindanao region including General Santos City, South Cotabato, Sarangani, and Sultan Kudarat',
          states: [
            'South Cotabato',
            'Sarangani',
            'Sultan Kudarat',
            'General Santos',
          ],
          regions: ['Region XII - SOCCSKSARGEN'],
        },
        headquarters: {
          address: '',
          city: 'General Santos',
          state: 'South Cotabato',
          country: 'Philippines',
          postalCode: '9500',
          timezone: 'Asia/Manila',
        },
        contact: {
          email: '',
          phone: '',
          website: '',
        },
        settings: {
          reportingFrequency: 'quarterly',
          defaultServiceTypes: [],
          requiredFields: [],
        },
        isActive: true,
        metadata: {
          churchCount: 0,
          lastUpdated: new Date(),
        },
      });

      await smm.save();
      console.log('Created SMM Conference:', smm._id);
    }

    // Summary
    console.log('\n=== SETUP COMPLETE ===');
    console.log('Union: Southeastern Philippine Union Mission (SEPUM)');
    console.log('  - ID:', sepum._id);
    console.log('  - Code:', sepum.code);
    console.log('  - Division:', sepum.division?.name, `(${sepum.division?.code})`);
    console.log('');
    console.log('Conference: Southern Mindanao Mission (SMM)');
    console.log('  - ID:', smm._id);
    console.log('  - Union ID:', smm.unionId);
    console.log('');
    console.log(
      'Churches added under SMM will auto-generate codes: SEPUM001, SEPUM002, ...'
    );

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

setupSEPUM();
