require('dotenv').config();
const mongoose = require('mongoose');
const ServiceType = require('../models/ServiceType');
const logger = require('../services/loggerService');

const DEFAULT_SERVICE_TYPES = [
  {
    value: 'op_shop',
    name: 'Op Shop',
    description: 'Thrift stores and second-hand shops',
    displayOrder: 1,
  },
  {
    value: 'food_pantry',
    name: 'Food Pantry',
    description: 'Food distribution services',
    displayOrder: 2,
  },
  {
    value: 'soup_kitchen',
    name: 'Soup Kitchen',
    description: 'Prepared meal services',
    displayOrder: 3,
  },
  {
    value: 'disaster_response',
    name: 'Disaster Response',
    description: 'Emergency and disaster relief services',
    displayOrder: 4,
  },
  {
    value: 'health_program',
    name: 'Health Program',
    description: 'Health and wellness programs',
    displayOrder: 5,
  },
  {
    value: 'youth_outreach',
    name: 'Youth Outreach',
    description: 'Programs for children and youth',
    displayOrder: 6,
  },
  {
    value: 'emergency_shelter',
    name: 'Emergency Shelter',
    description: 'Temporary housing and shelter services',
    displayOrder: 7,
  },
  {
    value: 'counseling_service',
    name: 'Counseling Service',
    description: 'Mental health and counseling services',
    displayOrder: 8,
  },
  {
    value: 'education_program',
    name: 'Education Program',
    description: 'Educational and training programs',
    displayOrder: 9,
  },
  {
    value: 'community_garden',
    name: 'Community Garden',
    description: 'Community gardening initiatives',
    displayOrder: 10,
  },
  {
    value: 'other',
    name: 'Other',
    description: 'Other community services',
    displayOrder: 11,
  },
];

async function seedServiceTypes() {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    logger.info('Connected to MongoDB');

    const systemUserId = new mongoose.Types.ObjectId(
      '000000000000000000000000'
    );

    logger.info('Checking existing service types...');
    const existingTypes = await ServiceType.find({});

    if (existingTypes.length > 0) {
      logger.info(
        `Found ${existingTypes.length} existing service types. Skipping seed.`
      );
      return;
    }

    logger.info('Seeding service types...');

    for (const typeData of DEFAULT_SERVICE_TYPES) {
      const serviceType = new ServiceType({
        ...typeData,
        isActive: true,
        createdBy: systemUserId,
        updatedBy: systemUserId,
      });

      await serviceType.save();
      logger.info(`Created service type: ${typeData.name}`);
    }

    logger.info('Service types seeded successfully!');
  } catch (error) {
    logger.error('Error seeding service types:', error);
    throw error;
  } finally {
    await mongoose.connection.close();
    logger.info('Database connection closed');
  }
}

if (require.main === module) {
  seedServiceTypes()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error(error);
      process.exit(1);
    });
}

module.exports = seedServiceTypes;
