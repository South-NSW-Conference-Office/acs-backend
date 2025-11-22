const cron = require('node-cron');
const AuditLog = require('../models/AuditLog');
const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);

/**
 * Service for managing audit log retention and archival
 */
class AuditRetentionService {
  constructor() {
    this.archivePath = process.env.AUDIT_ARCHIVE_PATH || path.join(__dirname, '../../audit-archives');
    this.isRunning = false;
    this.jobs = new Map();
  }

  /**
   * Initialize all retention jobs
   */
  async initialize() {
    try {
      // Ensure archive directory exists
      await this.ensureArchiveDirectory();

      // Schedule daily retention check at 2 AM
      this.scheduleJob('daily-retention', '0 2 * * *', () => this.runRetentionPolicy());

      // Schedule weekly archive job on Sunday at 3 AM
      this.scheduleJob('weekly-archive', '0 3 * * 0', () => this.archiveOldLogs());

      // Schedule monthly cleanup on 1st at 4 AM
      this.scheduleJob('monthly-cleanup', '0 4 1 * *', () => this.cleanupArchives());

      console.log('Audit retention service initialized');
    } catch (error) {
      console.error('Failed to initialize audit retention service:', error);
    }
  }

  /**
   * Schedule a cron job
   */
  scheduleJob(name, schedule, handler) {
    if (this.jobs.has(name)) {
      this.jobs.get(name).stop();
    }

    const job = cron.schedule(schedule, async () => {
      if (this.isRunning) {
        console.log(`Skipping ${name} - another retention job is running`);
        return;
      }

      this.isRunning = true;
      console.log(`Starting ${name} job`);

      try {
        await handler();
        console.log(`Completed ${name} job`);
      } catch (error) {
        console.error(`Error in ${name} job:`, error);
      } finally {
        this.isRunning = false;
      }
    }, {
      scheduled: true,
      timezone: process.env.TZ || 'America/New_York'
    });

    this.jobs.set(name, job);
  }

  /**
   * Run retention policy
   */
  async runRetentionPolicy() {
    const startTime = Date.now();
    const results = {
      deleted: 0,
      errors: 0,
      categories: {}
    };

    try {
      // Process each retention category
      const categories = ['debug', 'operational', 'compliance', 'security'];
      
      for (const category of categories) {
        const cutoffDate = this.getCutoffDate(category);
        
        // Delete expired logs
        const deleteResult = await AuditLog.deleteMany({
          'retention.category': category,
          'retention.expiresAt': { $lte: cutoffDate },
          'retention.archived': true
        });

        results.categories[category] = deleteResult.deletedCount;
        results.deleted += deleteResult.deletedCount;
      }

      // Log retention run
      await AuditLog.logAction({
        action: 'system.maintenance',
        actor: { type: 'system' },
        target: { type: 'system', name: 'audit_retention' },
        result: {
          success: true,
          duration: Date.now() - startTime,
          affectedCount: results.deleted
        },
        changes: results,
        retention: { category: 'operational' }
      });

    } catch (error) {
      console.error('Retention policy error:', error);
      results.errors++;
      
      await AuditLog.logAction({
        action: 'system.maintenance',
        actor: { type: 'system' },
        target: { type: 'system', name: 'audit_retention' },
        result: {
          success: false,
          error: { message: error.message }
        },
        retention: { category: 'operational' }
      });
    }

    return results;
  }

  /**
   * Archive old logs to file system
   */
  async archiveOldLogs() {
    const startTime = Date.now();
    const results = {
      archived: 0,
      compressed: 0,
      errors: 0
    };

    try {
      // Get logs to archive (older than 30 days, not yet archived)
      const archiveCutoff = new Date();
      archiveCutoff.setDate(archiveCutoff.getDate() - 30);

      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const logs = await AuditLog.find({
          timestamp: { $lt: archiveCutoff },
          'retention.archived': false
        })
        .limit(batchSize)
        .lean();

        if (logs.length === 0) {
          hasMore = false;
          break;
        }

        // Group by date for archiving
        const logsByDate = this.groupLogsByDate(logs);

        for (const [dateStr, dateLogs] of Object.entries(logsByDate)) {
          try {
            // Create archive file
            const archiveFile = await this.createArchiveFile(dateStr, dateLogs);
            results.compressed += dateLogs.length;

            // Mark logs as archived
            const logIds = dateLogs.map(log => log._id);
            await AuditLog.updateMany(
              { _id: { $in: logIds } },
              { $set: { 'retention.archived': true } }
            );

            results.archived += dateLogs.length;
          } catch (error) {
            console.error(`Error archiving logs for ${dateStr}:`, error);
            results.errors++;
          }
        }
      }

      // Log archive run
      await AuditLog.logAction({
        action: 'system.backup',
        actor: { type: 'system' },
        target: { type: 'system', name: 'audit_archive' },
        result: {
          success: results.errors === 0,
          duration: Date.now() - startTime,
          affectedCount: results.archived
        },
        changes: results,
        retention: { category: 'operational' }
      });

    } catch (error) {
      console.error('Archive error:', error);
      results.errors++;
    }

    return results;
  }

  /**
   * Clean up old archive files
   */
  async cleanupArchives() {
    const results = {
      deleted: 0,
      errors: 0
    };

    try {
      const archiveRetentionDays = {
        debug: 30,
        operational: 180,
        compliance: 7 * 365,
        security: 3 * 365
      };

      const files = await fs.readdir(this.archivePath);

      for (const file of files) {
        if (!file.endsWith('.gz')) continue;

        try {
          const filePath = path.join(this.archivePath, file);
          const stats = await fs.stat(filePath);
          const fileAge = Date.now() - stats.mtime.getTime();
          const fileAgeDays = fileAge / (24 * 60 * 60 * 1000);

          // Determine category from filename
          const category = this.getCategoryFromFilename(file);
          const retentionDays = archiveRetentionDays[category] || 180;

          if (fileAgeDays > retentionDays) {
            await fs.unlink(filePath);
            results.deleted++;
          }
        } catch (error) {
          console.error(`Error processing archive ${file}:`, error);
          results.errors++;
        }
      }

    } catch (error) {
      console.error('Cleanup error:', error);
      results.errors++;
    }

    return results;
  }

  /**
   * Get cutoff date for retention category
   */
  getCutoffDate(category) {
    const now = new Date();
    const retentionDays = {
      debug: 7,
      operational: 90,
      compliance: 7 * 365,
      security: 2 * 365
    };

    const days = retentionDays[category] || 90;
    now.setDate(now.getDate() - days);
    return now;
  }

  /**
   * Group logs by date
   */
  groupLogsByDate(logs) {
    const groups = {};

    for (const log of logs) {
      const date = new Date(log.timestamp);
      const dateStr = date.toISOString().split('T')[0];
      
      if (!groups[dateStr]) {
        groups[dateStr] = [];
      }
      groups[dateStr].push(log);
    }

    return groups;
  }

  /**
   * Create compressed archive file
   */
  async createArchiveFile(dateStr, logs) {
    // Ensure year/month directory structure
    const [year, month] = dateStr.split('-');
    const monthDir = path.join(this.archivePath, year, month);
    await fs.mkdir(monthDir, { recursive: true });

    // Prepare archive data
    const archiveData = {
      date: dateStr,
      count: logs.length,
      logs: logs.map(log => ({
        ...log,
        _id: log._id.toString() // Convert ObjectId to string
      }))
    };

    // Compress data
    const jsonData = JSON.stringify(archiveData);
    const compressed = await gzip(jsonData);

    // Write to file
    const filename = `audit-${dateStr}.json.gz`;
    const filePath = path.join(monthDir, filename);
    await fs.writeFile(filePath, compressed);

    return filePath;
  }

  /**
   * Restore logs from archive
   */
  async restoreFromArchive(dateStr) {
    const [year, month, day] = dateStr.split('-');
    const filePath = path.join(this.archivePath, year, month, `audit-${dateStr}.json.gz`);

    try {
      const compressed = await fs.readFile(filePath);
      const jsonData = zlib.gunzipSync(compressed).toString();
      const archiveData = JSON.parse(jsonData);

      // Restore logs to database
      const restored = [];
      for (const logData of archiveData.logs) {
        delete logData._id; // Let MongoDB generate new ID
        const log = new AuditLog(logData);
        await log.save();
        restored.push(log);
      }

      return restored;
    } catch (error) {
      throw new Error(`Failed to restore archive ${dateStr}: ${error.message}`);
    }
  }

  /**
   * Get archive statistics
   */
  async getArchiveStats() {
    const stats = {
      totalFiles: 0,
      totalSize: 0,
      byMonth: {},
      byCategory: {}
    };

    try {
      const years = await fs.readdir(this.archivePath);
      
      for (const year of years) {
        const yearPath = path.join(this.archivePath, year);
        const yearStat = await fs.stat(yearPath);
        
        if (yearStat.isDirectory()) {
          const months = await fs.readdir(yearPath);
          
          for (const month of months) {
            const monthPath = path.join(yearPath, month);
            const files = await fs.readdir(monthPath);
            
            stats.byMonth[`${year}-${month}`] = {
              files: 0,
              size: 0
            };
            
            for (const file of files) {
              if (file.endsWith('.gz')) {
                const filePath = path.join(monthPath, file);
                const fileStat = await fs.stat(filePath);
                
                stats.totalFiles++;
                stats.totalSize += fileStat.size;
                stats.byMonth[`${year}-${month}`].files++;
                stats.byMonth[`${year}-${month}`].size += fileStat.size;
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error getting archive stats:', error);
    }

    return stats;
  }

  /**
   * Ensure archive directory exists
   */
  async ensureArchiveDirectory() {
    await fs.mkdir(this.archivePath, { recursive: true });
  }

  /**
   * Get category from filename
   */
  getCategoryFromFilename(filename) {
    // Could be enhanced to store category in filename
    return 'operational';
  }

  /**
   * Manual trigger for retention tasks
   */
  async runManualRetention(task) {
    switch (task) {
      case 'retention':
        return await this.runRetentionPolicy();
      case 'archive':
        return await this.archiveOldLogs();
      case 'cleanup':
        return await this.cleanupArchives();
      default:
        throw new Error(`Unknown retention task: ${task}`);
    }
  }

  /**
   * Stop all scheduled jobs
   */
  shutdown() {
    for (const [name, job] of this.jobs.entries()) {
      job.stop();
      console.log(`Stopped ${name} job`);
    }
    this.jobs.clear();
  }
}

// Export singleton instance
module.exports = new AuditRetentionService();