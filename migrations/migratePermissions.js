const mongoose = require('mongoose');
const Permission = require('../models/Permission');
const PermissionCategory = require('../models/PermissionCategory');
const Role = require('../models/Role');
require('dotenv').config();

// Define all system permissions that were previously hardcoded
const systemCategories = [
  {
    name: 'users',
    displayName: 'Users',
    description: 'User management permissions',
    displayOrder: 1,
    isSystem: true,
  },
  {
    name: 'organizations',
    displayName: 'Organizations',
    description: 'Organization management permissions',
    displayOrder: 2,
    isSystem: true,
  },
  {
    name: 'roles',
    displayName: 'Roles',
    description: 'Role and permission management',
    displayOrder: 3,
    isSystem: true,
  },
  {
    name: 'services',
    displayName: 'Services',
    description: 'Community service management',
    displayOrder: 4,
    isSystem: true,
  },
  {
    name: 'stories',
    displayName: 'Stories',
    description: 'Success stories and testimonials',
    displayOrder: 5,
    isSystem: true,
  },
  {
    name: 'dashboard',
    displayName: 'Dashboard & Analytics',
    description: 'Dashboard and analytics access',
    displayOrder: 6,
    isSystem: true,
  },
  {
    name: 'media',
    displayName: 'Media & File Management',
    description: 'Media library and file upload management',
    displayOrder: 7,
    isSystem: true,
  },
  {
    name: 'system',
    displayName: 'System Administration',
    description: 'System-level administrative functions',
    displayOrder: 8,
    isSystem: true,
  },
];

// Define all system permissions extracted from RoleModal
const systemPermissions = {
  users: [
    {
      key: 'users.create',
      label: 'Create Users',
      description: 'Create new users and add them to the system',
      allowedScopes: ['own', 'subordinate', 'all', 'acs_team'],
    },
    {
      key: 'users.read',
      label: 'View Users',
      description: 'View user profiles and information',
      allowedScopes: ['self', 'own', 'subordinate', 'all', 'acs_team'],
    },
    {
      key: 'users.update',
      label: 'Update Users',
      description: 'Edit user profiles and personal information',
      allowedScopes: ['self', 'own', 'subordinate', 'all', 'acs_team'],
    },
    {
      key: 'users.delete',
      label: 'Delete Users',
      description: 'Remove users from the system',
      allowedScopes: ['own', 'subordinate', 'all'],
    },
    {
      key: 'users.assign_role',
      label: 'Assign Roles',
      description: 'Assign roles and permissions to users',
      allowedScopes: ['own', 'subordinate', 'all'],
    },
  ],
  organizations: [
    {
      key: 'organizations.create',
      label: 'Create Organizations',
      description: 'Create new churches, conferences, or unions',
      allowedScopes: ['subordinate', 'all'],
    },
    {
      key: 'organizations.read',
      label: 'View Organizations',
      description: 'View organization details and structure',
      allowedScopes: ['own', 'subordinate', 'all'],
    },
    {
      key: 'organizations.update',
      label: 'Update Organizations',
      description: 'Edit organization information and settings',
      allowedScopes: ['own', 'subordinate', 'all'],
    },
    {
      key: 'organizations.delete',
      label: 'Delete Organizations',
      description: 'Remove organizations from the system',
      allowedScopes: ['subordinate', 'all'],
    },
  ],
  roles: [
    {
      key: 'roles.create',
      label: 'Create Roles',
      description: 'Create new roles with custom permissions',
      allowedScopes: [],
    },
    {
      key: 'roles.read',
      label: 'View Roles',
      description: 'View existing roles and their permissions',
      allowedScopes: [],
    },
    {
      key: 'roles.update',
      label: 'Update Roles',
      description: 'Modify role permissions and settings',
      allowedScopes: [],
    },
    {
      key: 'roles.delete',
      label: 'Delete Roles',
      description: 'Remove roles from the system',
      allowedScopes: [],
    },
  ],
  services: [
    {
      key: 'services.create',
      label: 'Create Services',
      description: 'Create new community services',
      allowedScopes: ['own', 'subordinate', 'all', 'acs'],
    },
    {
      key: 'services.read',
      label: 'View Services',
      description: 'View service details and information',
      allowedScopes: ['own', 'subordinate', 'all', 'acs', 'public'],
    },
    {
      key: 'services.update',
      label: 'Update Services',
      description: 'Edit service information and settings',
      allowedScopes: ['own', 'subordinate', 'all', 'acs'],
    },
    {
      key: 'services.delete',
      label: 'Delete Services',
      description: 'Remove services from the system',
      allowedScopes: ['own', 'subordinate', 'all', 'acs'],
    },
    {
      key: 'services.manage',
      label: 'Manage Services',
      description: 'Manage service operations and volunteers',
      allowedScopes: ['own', 'subordinate', 'all', 'acs'],
    },
    {
      key: 'services.publish',
      label: 'Publish Services',
      description: 'Publish and unpublish services',
      allowedScopes: ['own', 'subordinate', 'all', 'acs'],
    },
    {
      key: 'services.archive',
      label: 'Archive Services',
      description: 'Archive and restore services',
      allowedScopes: ['own', 'subordinate', 'all', 'acs'],
    },
    {
      key: 'manage_service_types',
      label: 'Manage Service Types',
      description: 'Create, update, and delete service types',
      allowedScopes: [],
    },
  ],
  stories: [
    {
      key: 'stories.create',
      label: 'Create Stories',
      description: 'Create success stories for services',
      allowedScopes: ['own', 'subordinate', 'all', 'acs'],
    },
    {
      key: 'stories.read',
      label: 'View Stories',
      description: 'View service stories and testimonials',
      allowedScopes: ['own', 'subordinate', 'all', 'acs', 'public'],
    },
    {
      key: 'stories.update',
      label: 'Update Stories',
      description: 'Edit existing stories and content',
      allowedScopes: ['own', 'subordinate', 'all', 'acs'],
    },
    {
      key: 'stories.delete',
      label: 'Delete Stories',
      description: 'Remove stories from the system',
      allowedScopes: ['own', 'subordinate', 'all', 'acs'],
    },
    {
      key: 'stories.manage',
      label: 'Manage Stories',
      description: 'Publish, unpublish, and feature stories',
      allowedScopes: ['own', 'subordinate', 'all', 'acs'],
    },
  ],
  dashboard: [
    {
      key: 'dashboard.view',
      label: 'View Dashboard',
      description: 'View dashboard and summary statistics',
      allowedScopes: [],
    },
    {
      key: 'analytics.read',
      label: 'View Analytics',
      description: 'Access detailed analytics and reports',
      allowedScopes: ['own', 'subordinate', 'all'],
    },
    {
      key: 'analytics.export',
      label: 'Export Analytics',
      description: 'Export analytics data and reports',
      allowedScopes: [],
    },
  ],
  media: [
    {
      key: 'media.upload',
      label: 'Upload Media',
      description: 'Upload images and files to the media library',
      allowedScopes: ['own', 'subordinate', 'all', 'acs', 'team'],
    },
    {
      key: 'media.read',
      label: 'View Media',
      description: 'View and browse media library files',
      allowedScopes: [
        'self',
        'own',
        'subordinate',
        'all',
        'acs',
        'public',
        'team',
      ],
    },
    {
      key: 'media.update',
      label: 'Edit Media',
      description: 'Edit media file metadata, titles, and descriptions',
      allowedScopes: ['self', 'own', 'subordinate', 'all', 'acs', 'team'],
    },
    {
      key: 'media.delete',
      label: 'Delete Media',
      description: 'Remove media files from the library',
      allowedScopes: ['self', 'own', 'subordinate', 'all', 'acs'],
    },
    {
      key: 'media.manage',
      label: 'Manage Media Library',
      description: 'Full media library management including bulk operations',
      allowedScopes: ['subordinate', 'all', 'acs'],
    },
  ],
  system: [
    {
      key: 'system.backup',
      label: 'System Backup',
      description: 'Perform database backup and restore operations',
      allowedScopes: [],
    },
    {
      key: 'system.audit',
      label: 'View Audit Logs',
      description: 'View system audit logs and security events',
      allowedScopes: [],
    },
    {
      key: 'system.configure',
      label: 'System Configuration',
      description: 'Modify system configuration and settings',
      allowedScopes: [],
    },
    {
      key: 'system.impersonate',
      label: 'Impersonate Users',
      description: 'Impersonate other users for support',
      allowedScopes: [],
    },
    {
      key: 'system.maintenance',
      label: 'System Maintenance',
      description: 'Enable maintenance mode and system updates',
      allowedScopes: [],
    },
  ],
};

async function migratePermissions() {
  // Check if already connected
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    // Connected to MongoDB
  }

  // Step 1: Create permission categories
  // 1. Creating permission categories...
  const categoryMap = {};

  for (const categoryData of systemCategories) {
    const category = await PermissionCategory.findOneAndUpdate(
      { name: categoryData.name },
      categoryData,
      { upsert: true, new: true }
    );
    categoryMap[categoryData.name] = category;
    // Created/Updated category: ${categoryData.displayName}
  }

  // Step 2: Create permissions
  // 2. Creating permissions...
  const createdPermissions = [];

  for (const [categoryName, permissions] of Object.entries(systemPermissions)) {
    const category = categoryMap[categoryName];

    for (const permData of permissions) {
      const permission = await Permission.findOneAndUpdate(
        { key: permData.key },
        {
          ...permData,
          category: category._id,
          isSystem: true,
        },
        { upsert: true, new: true }
      );
      createdPermissions.push(permission);
      // Created/Updated permission: ${permData.key}
    }
  }

  // Step 3: Update system roles to ensure they have the correct permissions
  // 3. Updating system roles...

  // Super Admin - still uses wildcard
  await Role.findOneAndUpdate(
    { name: 'super_admin' },
    {
      displayName: 'Super Administrator',
      level: 'union',
      permissions: ['*'],
      description: 'Full system access including system administration',
      isSystem: true,
    },
    { upsert: true }
  );
  // Updated super_admin role

  // Union Admin - full access except system permissions
  const unionAdminPermissions = createdPermissions
    .filter((p) => !p.key.startsWith('system.'))
    .map((p) => p.key);
  unionAdminPermissions.push(
    'users.*',
    'organizations.*',
    'roles.*',
    'services.*',
    'stories.*',
    'media.*'
  );

  await Role.findOneAndUpdate(
    { name: 'union_admin' },
    {
      permissions: [...new Set(unionAdminPermissions)],
    }
  );
  // Updated union_admin role

  // Migration completed successfully!
  // ${Object.keys(categoryMap).length} categories created
  // ${createdPermissions.length} permissions created

  // No catch needed - let errors bubble up
  // Don't close the connection when called from the app
}

// Run the migration
if (require.main === module) {
  migratePermissions()
    .then(() => {
      // Closing database connection...
      mongoose.connection.close();
    })
    .catch(() => {
      // Migration failed: error
      process.exit(1);
    });
}

module.exports = migratePermissions;
