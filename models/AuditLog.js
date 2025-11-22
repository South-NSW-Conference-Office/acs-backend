const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  // Action Details
  action: {
    type: String,
    required: true,
    index: true,
    enum: [
      // Authentication actions
      'auth.login',
      'auth.logout',
      'auth.failed_login',
      'auth.password_reset',
      'auth.password_change',
      'auth.token_refresh',
      
      // User actions
      'user.create',
      'user.update',
      'user.delete',
      'user.activate',
      'user.deactivate',
      'user.role_assign',
      'user.role_remove',
      
      // Organization actions
      'organization.create',
      'organization.update',
      'organization.delete',
      'organization.activate',
      'organization.deactivate',
      
      // Hierarchy actions
      'hierarchy.move',
      'hierarchy.path_update',
      'hierarchy.bulk_update',
      'hierarchy.integrity_fix',
      
      // Team actions
      'team.create',
      'team.update',
      'team.delete',
      'team.member_add',
      'team.member_remove',
      'team.member_role_change',
      
      // Service actions
      'service.create',
      'service.update',
      'service.delete',
      'service.archive',
      'service.restore',
      
      // Permission actions
      'permission.grant',
      'permission.revoke',
      'permission.escalation',
      'permission.check_failed',
      
      // System actions
      'system.migration',
      'system.backup',
      'system.restore',
      'system.config_change',
      'system.maintenance'
    ]
  },
  
  // Actor Information
  actor: {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: function() { return this.actor.type === 'user'; }
    },
    type: {
      type: String,
      required: true,
      enum: ['user', 'system', 'anonymous'],
      default: 'user'
    },
    email: String,
    name: String,
    hierarchyLevel: Number,
    hierarchyPath: String,
    impersonatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  
  // Target Information
  target: {
    type: {
      type: String,
      required: true,
      enum: ['user', 'organization', 'team', 'service', 'role', 'permission', 'system']
    },
    id: {
      type: mongoose.Schema.Types.ObjectId,
      required: function() { return this.target.type !== 'system'; }
    },
    name: String,
    hierarchyPath: String,
    additionalTargets: [{
      type: String,
      id: mongoose.Schema.Types.ObjectId,
      name: String
    }]
  },
  
  // Hierarchy Context
  hierarchyContext: {
    actorPath: String,
    targetPath: String,
    crossHierarchy: {
      type: Boolean,
      default: false
    },
    hierarchyViolation: {
      type: Boolean,
      default: false
    }
  },
  
  // Change Details
  changes: {
    type: mongoose.Schema.Types.Mixed,
    // Will store before/after values for updates
    // Example: { field: { old: 'value1', new: 'value2' } }
  },
  
  // Request Information
  request: {
    method: String,
    path: String,
    query: mongoose.Schema.Types.Mixed,
    body: mongoose.Schema.Types.Mixed, // Sanitized body
    headers: {
      userAgent: String,
      referer: String
    }
  },
  
  // Network Information
  network: {
    ipAddress: {
      type: String,
      required: true,
      index: true
    },
    ipVersion: {
      type: String,
      enum: ['IPv4', 'IPv6']
    },
    location: {
      country: String,
      region: String,
      city: String,
      coordinates: {
        type: [Number], // [longitude, latitude]
        index: '2dsphere'
      }
    },
    proxy: Boolean,
    vpn: Boolean
  },
  
  // Result Information
  result: {
    success: {
      type: Boolean,
      required: true
    },
    error: {
      code: String,
      message: String,
      stack: String // Only in development
    },
    duration: Number, // milliseconds
    affectedCount: Number
  },
  
  // Compliance & Security
  compliance: {
    reason: String, // Reason for action if required
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    ticket: String, // Support ticket reference
    sensitive: {
      type: Boolean,
      default: false
    },
    dataClassification: {
      type: String,
      enum: ['public', 'internal', 'confidential', 'restricted'],
      default: 'internal'
    }
  },
  
  // Session Information
  session: {
    id: String,
    startTime: Date,
    deviceId: String,
    deviceType: {
      type: String,
      enum: ['desktop', 'mobile', 'tablet', 'api', 'unknown']
    }
  },
  
  // Retention Information
  retention: {
    expiresAt: {
      type: Date,
      index: true
    },
    category: {
      type: String,
      enum: ['security', 'compliance', 'operational', 'debug'],
      default: 'operational'
    },
    archived: {
      type: Boolean,
      default: false
    }
  },
  
  // Timestamps
  timestamp: {
    type: Date,
    default: Date.now,
    required: true,
    index: true
  }
}, {
  timestamps: { createdAt: 'timestamp', updatedAt: false },
  collection: 'auditlogs'
});

// Indexes for performance
auditLogSchema.index({ 'actor.userId': 1, timestamp: -1 });
auditLogSchema.index({ 'target.type': 1, 'target.id': 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ 'result.success': 1, timestamp: -1 });
auditLogSchema.index({ 'hierarchyContext.hierarchyViolation': 1, timestamp: -1 });
auditLogSchema.index({ 'retention.expiresAt': 1 }, { expireAfterSeconds: 0 });

// Compound indexes for common queries
auditLogSchema.index({ action: 1, 'actor.userId': 1, timestamp: -1 });
auditLogSchema.index({ 'target.type': 1, action: 1, timestamp: -1 });

// Text index for searching
auditLogSchema.index({
  action: 'text',
  'target.name': 'text',
  'actor.email': 'text',
  'compliance.reason': 'text'
});

// Pre-save middleware
auditLogSchema.pre('save', function(next) {
  // Set retention based on category
  if (!this.retention.expiresAt) {
    const retentionDays = {
      security: 2 * 365,     // 2 years
      compliance: 7 * 365,   // 7 years
      operational: 90,       // 90 days
      debug: 7              // 7 days
    };
    
    const days = retentionDays[this.retention.category] || 90;
    this.retention.expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }
  
  // Detect cross-hierarchy actions
  if (this.hierarchyContext.actorPath && this.hierarchyContext.targetPath) {
    this.hierarchyContext.crossHierarchy = !this.hierarchyContext.targetPath.startsWith(this.hierarchyContext.actorPath);
  }
  
  // Sanitize sensitive data
  if (this.request.body && this.request.body.password) {
    this.request.body.password = '[REDACTED]';
  }
  
  // Set IP version
  if (this.network.ipAddress) {
    this.network.ipVersion = this.network.ipAddress.includes(':') ? 'IPv6' : 'IPv4';
  }
  
  next();
});

// Static methods for common queries
auditLogSchema.statics.logAction = async function(actionData) {
  try {
    const log = new this(actionData);
    await log.save();
    return log;
  } catch (error) {
    console.error('Failed to create audit log:', error);
    // Don't throw - audit logging should not break the main flow
    return null;
  }
};

auditLogSchema.statics.getActionsBy = async function(userId, options = {}) {
  const {
    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    endDate = new Date(),
    limit = 100,
    actions = null
  } = options;
  
  const query = {
    'actor.userId': userId,
    timestamp: { $gte: startDate, $lte: endDate }
  };
  
  if (actions && actions.length > 0) {
    query.action = { $in: actions };
  }
  
  return this.find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

auditLogSchema.statics.getActionsOn = async function(targetType, targetId, options = {}) {
  const {
    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    endDate = new Date(),
    limit = 100
  } = options;
  
  return this.find({
    'target.type': targetType,
    'target.id': targetId,
    timestamp: { $gte: startDate, $lte: endDate }
  })
    .sort({ timestamp: -1 })
    .limit(limit)
    .populate('actor.userId', 'name email')
    .lean();
};

auditLogSchema.statics.getSecurityEvents = async function(options = {}) {
  const {
    startDate = new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours
    endDate = new Date(),
    severity = ['high', 'critical']
  } = options;
  
  const securityActions = [
    'auth.failed_login',
    'permission.escalation',
    'permission.check_failed',
    'user.role_assign',
    'hierarchy.move'
  ];
  
  return this.find({
    action: { $in: securityActions },
    timestamp: { $gte: startDate, $lte: endDate },
    $or: [
      { 'hierarchyContext.hierarchyViolation': true },
      { 'hierarchyContext.crossHierarchy': true },
      { 'result.success': false }
    ]
  })
    .sort({ timestamp: -1 })
    .populate('actor.userId', 'name email hierarchyLevel')
    .lean();
};

auditLogSchema.statics.getHierarchyViolations = async function(options = {}) {
  const { days = 7 } = options;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  return this.find({
    'hierarchyContext.hierarchyViolation': true,
    timestamp: { $gte: startDate }
  })
    .sort({ timestamp: -1 })
    .populate('actor.userId', 'name email')
    .populate('target.id')
    .lean();
};

auditLogSchema.statics.archiveOldLogs = async function(options = {}) {
  const { batchSize = 1000 } = options;
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90); // 90 days for operational logs
  
  const result = await this.updateMany(
    {
      'retention.category': 'operational',
      'retention.archived': false,
      timestamp: { $lt: cutoffDate }
    },
    {
      $set: { 'retention.archived': true }
    },
    {
      limit: batchSize
    }
  );
  
  return result;
};

module.exports = mongoose.model('AuditLog', auditLogSchema);