const mongoose = require('mongoose');
require('dotenv').config();

const PageContent = require('../models/PageContent');
const PageContentVersion = require('../models/PageContentVersion');
const User = require('../models/User');

// Static data matching frontend/src/app/pages/Home.tsx
const STATIC_DATA = {
  services: [
    {
      id: 1,
      name: 'Food Bank Services',
      descriptionShort:
        'Access nutritious food and essential supplies through our community food programs. We provide weekly food parcels and emergency relief packages.',
      location: 'Sydney, NSW',
      capacity: 200,
      image:
        'https://images.unsplash.com/photo-1759709042164-0dd78a39028b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxhdXN0cmFsaWElMjBjb21tdW5pdHklMjBoZWxwfGVufDF8fHx8MTc2NjE5NTgzNHww&ixlib=rb-4.1.0&q=80&w=1080',
    },
    {
      id: 2,
      name: 'Clothing Assistance',
      descriptionShort:
        'Find quality clothing and household items at affordable prices. Donations accepted and distributed to those in need across the community.',
      location: 'Melbourne, VIC',
      capacity: 150,
      image:
        'https://images.unsplash.com/photo-1711395588577-ed596848b04f?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxhdXN0cmFsaWElMjB2b2x1bnRlZXIlMjBvdXRiYWNrfGVufDF8fHx8MTc2NjE5NTgzNHww&ixlib=rb-4.1.0&q=80&w=1080',
    },
    {
      id: 3,
      name: 'Counseling & Support',
      descriptionShort:
        'Professional counseling services and emotional support for individuals and families facing challenging times. Confidential and compassionate care.',
      location: 'Brisbane, QLD',
      capacity: 50,
      image:
        'https://images.unsplash.com/photo-1759709042164-0dd78a39028b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzeWRuZXklMjBjb21tdW5pdHklMjBzZXJ2aWNlfGVufDF8fHx8MTc2NjE5NTgzNXww&ixlib=rb-4.1.0&q=80&w=1080',
    },
    {
      id: 4,
      name: 'Emergency Relief',
      descriptionShort:
        'Immediate assistance during crisis situations including natural disasters, homelessness, and unexpected hardships. Available 24/7 support.',
      location: 'Perth, WA',
      capacity: 100,
      image:
        'https://images.unsplash.com/photo-1638769314338-9ba8e1e69465?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxhdXN0cmFsaWElMjBjaGFyaXR5JTIwd2FybXxlbnwxfHx8fDE3NjYxOTU4MzV8MA&ixlib=rb-4.1.0&q=80&w=1080',
    },
  ],
  testimonials: [
    {
      id: 1,
      name: 'Sarah Mitchell',
      location: 'Sydney, NSW',
      review:
        "Volunteering with ACS has been one of the most rewarding experiences of my life. The team is incredibly supportive, and knowing that I'm making a real difference in people's lives keeps me coming back every week.",
      image:
        'https://images.unsplash.com/photo-1649589244330-09ca58e4fa64?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwcm9mZXNzaW9uYWwlMjB3b21hbiUyMHBvcnRyYWl0fGVufDF8fHx8MTc2NjI3Nzk2Mnww&ixlib=rb-4.1.0&q=80&w=1080',
    },
    {
      id: 2,
      name: 'David Chen',
      location: 'Melbourne, VIC',
      review:
        "The food bank program is amazing! I've been volunteering for 6 months and have met so many wonderful people. It's heartwarming to see the impact we make together.",
      image:
        'https://images.unsplash.com/photo-1738566061505-556830f8b8f5?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwcm9mZXNzaW9uYWwlMjBtYW4lMjBhc2lhbiUyMHBvcnRyYWl0fGVufDF8fHx8MTc2NjM3MDQ5Nnww&ixlib=rb-4.1.0&q=80&w=1080',
    },
    {
      id: 3,
      name: 'Emma Thompson',
      location: 'Brisbane, QLD',
      review:
        "I started volunteering after retiring, and it's given me a new sense of purpose. The orientation was thorough, and everyone made me feel welcome from day one.",
      image:
        'https://images.unsplash.com/photo-1758686254563-5c5ab338c8b9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtYXR1cmUlMjB3b21hbiUyMHNtaWxpbmclMjBwb3J0cmFpdHxlbnwxfHx8fDE3NjYzNzA0OTh8MA&ixlib=rb-4.1.0&q=80&w=1080',
    },
    {
      id: 4,
      name: 'Michael Roberts',
      location: 'Perth, WA',
      review:
        'As a corporate volunteer, I appreciate how flexible and organized ACS is. They make it easy to give back to the community even with a busy schedule.',
      image:
        'https://images.unsplash.com/photo-1737574821698-862e77f044c1?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxidXNpbmVzc21hbiUyMHByb2Zlc3Npb25hbCUyMHBvcnRyYWl0fGVufDF8fHx8MTc2NjM3MDQ5N3ww&ixlib=rb-4.1.0&q=80&w=1080',
    },
    {
      id: 5,
      name: 'Lisa Anderson',
      location: 'Adelaide, SA',
      review:
        'The emergency relief program has shown me the true meaning of community care. Every shift reminds me why this work is so important. Highly recommend volunteering here!',
      image:
        'https://images.unsplash.com/photo-1555396768-2a77b9e979c0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3b21hbiUyMHZvbHVudGVlciUyMHBvcnRyYWl0fGVufDF8fHx8MTc2NjM0OTA0OHww&ixlib=rb-4.1.0&q=80&w=1080',
    },
    {
      id: 6,
      name: 'James Wilson',
      location: 'Canberra, ACT',
      review:
        'Being part of the clothing assistance team has been incredible. The organization is professional, the mission is clear, and the impact is visible.',
      image:
        'https://images.unsplash.com/photo-1758639842438-718755aa57e4?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx5b3VuZyUyMG1hbiUyMHByb2Zlc3Npb25hbCUyMHBvcnRyYWl0fGVufDF8fHx8MTc2NjI4Nzg5NXww&ixlib=rb-4.1.0&q=80&w=1080',
    },
    {
      id: 7,
      name: 'Rachel Green',
      location: 'Hobart, TAS',
      review:
        "I love how ACS values each volunteer's unique skills and interests. They matched me with a role that perfectly fits my schedule and passion for helping others.",
      image:
        'https://images.unsplash.com/photo-1760551937527-2bc6cfe45180?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3b21hbiUyMGNhc3VhbCUyMHBvcnRyYWl0JTIwc21pbGV8ZW58MXx8fHwxNzY2MzcwNDk4fDA&ixlib=rb-4.1.0&q=80&w=1080',
    },
    {
      id: 8,
      name: 'Thomas Brown',
      location: 'Darwin, NT',
      review:
        'The training and support provided by ACS is exceptional. I felt prepared and confident to start volunteering from the very beginning.',
      image:
        'https://images.unsplash.com/photo-1640653583383-72b60809f273?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtYW4lMjBmcmllbmRseSUyMHBvcnRyYWl0JTIwc21pbGV8ZW58MXx8fHwxNzY2MzcwNDk4fDA&ixlib=rb-4.1.0&q=80&w=1080',
    },
  ],
  steps: [
    {
      number: '01',
      icon: 'ClipboardCheck',
      title: 'Apply Online',
      description:
        'Fill out our simple online application form with your details, interests, and availability. Tell us about yourself and which programs interest you most.',
    },
    {
      number: '02',
      icon: 'GraduationCap',
      title: 'Attend Orientation',
      description:
        "Join our comprehensive orientation and training session where you'll learn about our mission, values, safety procedures, and the specific role you'll be filling.",
    },
    {
      number: '03',
      icon: 'Heart',
      title: 'Start Serving',
      description:
        "Begin your volunteer journey and make a real impact in your community. You'll be supported by our experienced team every step of the way.",
    },
  ],
  volunteerImages: [
    {
      url: 'https://images.unsplash.com/photo-1710092784814-4a6f158913b8?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx2b2x1bnRlZXJzJTIwZm9vZCUyMGJhbmslMjBoZWxwaW5nfGVufDF8fHx8MTc2NjM3MDE3Nnww&ixlib=rb-4.1.0&q=80&w=1080',
      alt: 'Food Bank Volunteers',
      caption:
        'Help distribute food and essential supplies to families in need across our community',
    },
    {
      url: 'https://images.unsplash.com/photo-1722336762551-831c0bcc2b59?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb21tdW5pdHklMjB2b2x1bnRlZXJzJTIwcGFja2luZyUyMGNsb3RoZXN8ZW58MXx8fHwxNzY2MzcwMTc2fDA&ixlib=rb-4.1.0&q=80&w=1080',
      alt: 'Clothing Assistance',
      caption:
        'Sort and organize clothing donations for those in our community',
    },
    {
      url: 'https://images.unsplash.com/photo-1758599668125-e154250f24bd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx2b2x1bnRlZXJzJTIwdGVhbXdvcmslMjBjb21tdW5pdHl8ZW58MXx8fHwxNzY2MzcwMTc3fDA&ixlib=rb-4.1.0&q=80&w=1080',
      alt: 'Teamwork',
      caption:
        'Join our team in organizing community events and fundraising activities',
    },
    {
      url: 'https://images.unsplash.com/photo-1657558638549-9fd140b1ab5e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx2b2x1bnRlZXJzJTIwaGVscGluZyUyMGVsZGVybHl8ZW58MXx8fHwxNzY2MzcwMTc3fDA&ixlib=rb-4.1.0&q=80&w=1080',
      alt: 'Community Support',
      caption:
        'Provide compassionate support and companionship to elderly members of our community',
    },
  ],
};

// Homepage content structure
const homepageData = {
  pageId: 'home',
  pageName: 'Homepage',
  description: 'Main landing page for Adventist Community Services',
  slug: 'home',
  status: 'published',
  version: 1,
  publishedAt: new Date(),
  sections: [
    // Section 1: Hero
    {
      sectionId: 'hero',
      sectionName: 'Hero Section',
      description: 'Main hero banner with search functionality',
      order: 0,
      isEnabled: true,
      blocks: [
        {
          key: 'label',
          type: 'text',
          content: "Australia's Adventist Community Service",
          order: 0,
          metadata: {
            label: 'Section Label',
            description: 'Small text above the main title',
          },
        },
        {
          key: 'title',
          type: 'text',
          content: 'Discover Services. Find Support.',
          order: 1,
          metadata: {
            label: 'Main Title',
            description: 'Primary heading for the hero section',
          },
        },
        {
          key: 'subtitle',
          type: 'richtext',
          content:
            "Search for community services, support programs, and resources offered by the Adventist Church across Australia. We're here to help you find the assistance you need.",
          order: 2,
          metadata: {
            label: 'Subtitle',
            description: 'Description text below the main title',
          },
        },
        {
          key: 'search_placeholder',
          type: 'text',
          content: 'Search for services...',
          order: 3,
          metadata: {
            label: 'Search Placeholder',
            description: 'Placeholder text for the service search input',
          },
        },
        {
          key: 'location_placeholder',
          type: 'text',
          content: 'Location',
          order: 4,
          metadata: {
            label: 'Location Placeholder',
            description: 'Placeholder text for the location input',
          },
        },
        {
          key: 'search_button_text',
          type: 'text',
          content: 'Search',
          order: 5,
          metadata: {
            label: 'Search Button',
            description: 'Text for the search button',
          },
        },
      ],
    },
    // Section 2: Services Preview
    {
      sectionId: 'services-preview',
      sectionName: 'Services Preview',
      description: 'Grid display of available community services',
      order: 1,
      isEnabled: true,
      blocks: [
        {
          key: 'section_label',
          type: 'text',
          content: 'Our Services',
          order: 0,
          metadata: {
            label: 'Section Label',
            description: 'Small text above the section title',
          },
        },
        {
          key: 'section_title',
          type: 'text',
          content: 'Available Community Services',
          order: 1,
          metadata: {
            label: 'Section Title',
            description: 'Main heading for the services section',
          },
        },
        {
          key: 'section_description',
          type: 'richtext',
          content:
            'Explore our range of community support programs designed to help those in need across Australia.',
          order: 2,
          metadata: {
            label: 'Section Description',
            description: 'Description text for the services section',
          },
        },
        {
          key: 'services_data',
          type: 'richtext',
          content: JSON.stringify(STATIC_DATA.services),
          order: 3,
          metadata: {
            label: 'Services Data',
            description: 'JSON array of service preview data',
          },
        },
      ],
    },
    // Section 3: Volunteer CTA
    {
      sectionId: 'volunteer-cta',
      sectionName: 'Volunteer Call to Action',
      description: 'Section encouraging users to become volunteers',
      order: 2,
      isEnabled: true,
      blocks: [
        {
          key: 'section_label',
          type: 'text',
          content: 'Join Our Team',
          order: 0,
          metadata: {
            label: 'Section Label',
            description: 'Small text above the section title',
          },
        },
        {
          key: 'section_title',
          type: 'text',
          content: 'Become a Volunteer',
          order: 1,
          metadata: {
            label: 'Section Title',
            description: 'Main heading for the volunteer section',
          },
        },
        {
          key: 'paragraph_1',
          type: 'richtext',
          content:
            'Make a lasting impact in your community by joining our team of dedicated volunteers. Whether you have a few hours a week or can commit to regular service, your contribution matters.',
          order: 2,
          metadata: {
            label: 'Paragraph 1',
            description: 'First paragraph of volunteer description',
          },
        },
        {
          key: 'paragraph_2',
          type: 'richtext',
          content:
            "We offer a variety of volunteer opportunities across Australia, from food distribution and clothing assistance to counseling support and emergency relief. No matter your skills or interests, there's a place for you in our community.",
          order: 3,
          metadata: {
            label: 'Paragraph 2',
            description: 'Second paragraph of volunteer description',
          },
        },
        {
          key: 'paragraph_3',
          type: 'richtext',
          content:
            'Our volunteers are the heart of everything we do. Join us in bringing hope, support, and practical assistance to those who need it most.',
          order: 4,
          metadata: {
            label: 'Paragraph 3',
            description: 'Third paragraph of volunteer description',
          },
        },
        {
          key: 'cta_primary',
          type: 'text',
          content: 'Apply to Volunteer',
          order: 5,
          metadata: {
            label: 'Primary CTA',
            description: 'Text for the primary call-to-action button',
          },
        },
        {
          key: 'cta_secondary',
          type: 'text',
          content: 'Learn More About Our Programs',
          order: 6,
          metadata: {
            label: 'Secondary CTA',
            description: 'Text for the secondary call-to-action button',
          },
        },
        {
          key: 'images_data',
          type: 'richtext',
          content: JSON.stringify(STATIC_DATA.volunteerImages),
          order: 7,
          metadata: {
            label: 'Images Data',
            description: 'JSON array of volunteer action images',
          },
        },
      ],
    },
    // Section 4: Process Steps
    {
      sectionId: 'process-steps',
      sectionName: 'Process Steps',
      description: 'Three-step process for becoming a volunteer',
      order: 3,
      isEnabled: true,
      blocks: [
        {
          key: 'section_label',
          type: 'text',
          content: 'Getting Started',
          order: 0,
          metadata: {
            label: 'Section Label',
            description: 'Small text above the section title',
          },
        },
        {
          key: 'section_title',
          type: 'text',
          content: 'How to Work With Us',
          order: 1,
          metadata: {
            label: 'Section Title',
            description: 'Main heading for the process section',
          },
        },
        {
          key: 'section_description',
          type: 'richtext',
          content:
            'Join Adventist Community Services in just three simple steps and start making a difference today.',
          order: 2,
          metadata: {
            label: 'Section Description',
            description: 'Description text for the process section',
          },
        },
        {
          key: 'steps_data',
          type: 'richtext',
          content: JSON.stringify(STATIC_DATA.steps),
          order: 3,
          metadata: {
            label: 'Steps Data',
            description: 'JSON array of process step data',
          },
        },
        {
          key: 'cta_button',
          type: 'text',
          content: 'Get Started Today',
          order: 4,
          metadata: {
            label: 'CTA Button',
            description: 'Text for the call-to-action button',
          },
        },
      ],
    },
    // Section 5: Testimonials
    {
      sectionId: 'testimonials',
      sectionName: 'Testimonials',
      description: 'Volunteer testimonials and reviews',
      order: 4,
      isEnabled: true,
      blocks: [
        {
          key: 'section_label',
          type: 'text',
          content: 'Testimonials',
          order: 0,
          metadata: {
            label: 'Section Label',
            description: 'Small text above the section title',
          },
        },
        {
          key: 'section_title',
          type: 'text',
          content: 'What Others Have to Say',
          order: 1,
          metadata: {
            label: 'Section Title',
            description: 'Main heading for the testimonials section',
          },
        },
        {
          key: 'section_description',
          type: 'richtext',
          content:
            'Hear from our wonderful volunteers about their experiences making a difference in the community.',
          order: 2,
          metadata: {
            label: 'Section Description',
            description: 'Description text for the testimonials section',
          },
        },
        {
          key: 'testimonials_data',
          type: 'richtext',
          content: JSON.stringify(STATIC_DATA.testimonials),
          order: 3,
          metadata: {
            label: 'Testimonials Data',
            description: 'JSON array of testimonial data',
          },
        },
      ],
    },
  ],
};

async function seedHomepage() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Check for --force flag
    const isForced = process.argv.includes('--force');

    // Check if homepage already exists
    const existingPage = await PageContent.findOne({ pageId: 'home' });

    if (existingPage && !isForced) {
      console.log('Homepage already exists in database.');
      console.log(
        'Use --force flag to overwrite: npm run seed:homepage -- --force'
      );
      await mongoose.connection.close();
      process.exit(0);
    }

    if (existingPage && isForced) {
      console.log('Removing existing homepage (--force flag used)...');
      await PageContentVersion.deleteMany({ pageId: 'home' });
      await PageContent.deleteOne({ pageId: 'home' });
      console.log('Existing homepage and versions removed');
    }

    // Find a system user to set as creator
    // First try to find an admin user, otherwise create without user reference
    let systemUser = await User.findOne({ email: 'admin@adventist.org.au' });

    if (!systemUser) {
      // Try to find any user with admin-like role
      systemUser = await User.findOne({}).sort({ createdAt: 1 });
    }

    if (!systemUser) {
      console.log('Warning: No users found in database.');
      console.log('Run the init-db script first: npm run init-db');
      console.log('Creating homepage without user reference...');
    }

    // Create homepage
    console.log('Creating homepage content...');

    const pageData = {
      ...homepageData,
      createdBy: systemUser?._id,
      publishedBy: systemUser?._id,
      updatedBy: systemUser?._id,
    };

    const homepage = new PageContent(pageData);
    await homepage.save();

    console.log('Homepage created successfully!');
    console.log(`  - Page ID: ${homepage.pageId}`);
    console.log(`  - Status: ${homepage.status}`);
    console.log(`  - Sections: ${homepage.sections.length}`);

    // Create initial version snapshot
    console.log('Creating initial version snapshot...');
    await PageContentVersion.createSnapshot(
      homepage,
      systemUser?._id,
      'Initial homepage content seed'
    );
    console.log('Version snapshot created');

    // Summary
    console.log('\n=== Homepage Seed Complete ===');
    console.log(`Sections created:`);
    homepage.sections.forEach((section) => {
      console.log(`  - ${section.sectionId}: ${section.blocks.length} blocks`);
    });

    console.log('\nVerify via API:');
    console.log('  GET /api/page-content/home');

    await mongoose.connection.close();
    console.log('\nDatabase connection closed');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding homepage:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  seedHomepage();
}

module.exports = { seedHomepage, homepageData };
