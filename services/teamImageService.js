const Team = require('../models/Team');
const storageService = require('./storageService');
const logger = require('./loggerService');

class TeamImageService {
  constructor() {
    this.storageService = storageService;
  }

  /**
   * Upload and set team banner image
   * @param {string} teamId - Team ID
   * @param {Buffer} buffer - Image buffer
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Updated team with new banner
   */
  async uploadBanner(teamId, buffer, options = {}) {
    try {
      const { originalName = 'banner.jpg', uploadedBy, alt = '' } = options;

      // Get team to verify it exists
      const team = await Team.findById(teamId);
      if (!team) {
        throw new Error('Team not found');
      }

      // Remove existing banner if present
      if (team.banner?.key) {
        await this.removeBanner(teamId);
      }

      // Upload new banner (1200x400)
      const uploadResult = await this.storageService.uploadImageWithTracking(
        buffer,
        {
          originalName,
          type: 'banner',
          entityType: 'team',
          entityId: teamId,
          uploadedBy,
          alt,
          generateThumbnail: false,
        }
      );

      // Update team with new banner info
      team.banner = {
        url: uploadResult.url,
        key: uploadResult.key,
        alt: alt || `${team.name} banner`,
      };

      await team.save();

      logger.info('Team banner uploaded successfully', {
        teamId,
        bannerKey: uploadResult.key,
        uploadedBy,
      });

      return team;
    } catch (error) {
      logger.error('Failed to upload team banner:', error);
      throw new Error(`Failed to upload banner: ${error.message}`);
    }
  }

  /**
   * Upload and set team profile photo
   * @param {string} teamId - Team ID
   * @param {Buffer} buffer - Image buffer
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Updated team with new profile photo
   */
  async uploadProfilePhoto(teamId, buffer, options = {}) {
    try {
      const { originalName = 'profile.jpg', uploadedBy, alt = '' } = options;

      // Get team to verify it exists
      const team = await Team.findById(teamId);
      if (!team) {
        throw new Error('Team not found');
      }

      // Remove existing profile photo if present
      if (team.profilePhoto?.key) {
        await this.removeProfilePhoto(teamId);
      }

      // Upload new profile photo (400x400)
      const uploadResult = await this.storageService.uploadImageWithTracking(
        buffer,
        {
          originalName,
          type: 'avatar', // Use avatar type for square format
          entityType: 'team',
          entityId: teamId,
          uploadedBy,
          alt,
          generateThumbnail: false,
        }
      );

      // Update team with new profile photo info
      team.profilePhoto = {
        url: uploadResult.url,
        key: uploadResult.key,
        alt: alt || `${team.name} profile photo`,
      };

      await team.save();

      logger.info('Team profile photo uploaded successfully', {
        teamId,
        profileKey: uploadResult.key,
        uploadedBy,
      });

      return team;
    } catch (error) {
      logger.error('Failed to upload team profile photo:', error);
      throw new Error(`Failed to upload profile photo: ${error.message}`);
    }
  }

  /**
   * Remove team banner image
   * @param {string} teamId - Team ID
   * @returns {Promise<Object>} Updated team without banner
   */
  async removeBanner(teamId) {
    try {
      const team = await Team.findById(teamId);
      if (!team) {
        throw new Error('Team not found');
      }

      // Delete from storage if banner exists
      if (team.banner?.key) {
        await this.storageService.deleteImage(team.banner.key, true);

        logger.info('Team banner removed successfully', {
          teamId,
          bannerKey: team.banner.key,
        });
      }

      // Update team to remove banner
      team.banner = {
        url: null,
        key: null,
        alt: null,
      };

      await team.save();

      return team;
    } catch (error) {
      logger.error('Failed to remove team banner:', error);
      throw new Error(`Failed to remove banner: ${error.message}`);
    }
  }

  /**
   * Remove team profile photo
   * @param {string} teamId - Team ID
   * @returns {Promise<Object>} Updated team without profile photo
   */
  async removeProfilePhoto(teamId) {
    try {
      const team = await Team.findById(teamId);
      if (!team) {
        throw new Error('Team not found');
      }

      // Delete from storage if profile photo exists
      if (team.profilePhoto?.key) {
        await this.storageService.deleteImage(team.profilePhoto.key, true);

        logger.info('Team profile photo removed successfully', {
          teamId,
          profileKey: team.profilePhoto.key,
        });
      }

      // Update team to remove profile photo
      team.profilePhoto = {
        url: null,
        key: null,
        alt: null,
      };

      await team.save();

      return team;
    } catch (error) {
      logger.error('Failed to remove team profile photo:', error);
      throw new Error(`Failed to remove profile photo: ${error.message}`);
    }
  }

  /**
   * Cleanup all images for a team (called when team is deleted)
   * @param {string} teamId - Team ID
   * @returns {Promise<void>}
   */
  async cleanupTeamImages(teamId) {
    try {
      const team = await Team.findById(teamId);
      if (!team) {
        return; // Team already deleted
      }

      // Remove banner
      if (team.banner?.key) {
        await this.storageService.deleteImage(team.banner.key, true);
      }

      // Remove profile photo
      if (team.profilePhoto?.key) {
        await this.storageService.deleteImage(team.profilePhoto.key, true);
      }

      logger.info('Team images cleanup completed', { teamId });
    } catch (error) {
      logger.error('Failed to cleanup team images:', error);
      // Don't throw error here as this is a cleanup operation
    }
  }

  /**
   * Get team images info
   * @param {string} teamId - Team ID
   * @returns {Promise<Object>} Team images info
   */
  async getTeamImages(teamId) {
    try {
      const team = await Team.findById(teamId).select(
        'banner profilePhoto name'
      );
      if (!team) {
        throw new Error('Team not found');
      }

      return {
        banner: team.banner,
        profilePhoto: team.profilePhoto,
        teamName: team.name,
      };
    } catch (error) {
      logger.error('Failed to get team images:', error);
      throw new Error(`Failed to get team images: ${error.message}`);
    }
  }
}

module.exports = new TeamImageService();
