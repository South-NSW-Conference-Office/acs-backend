const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  authorizeHierarchical,
  // authorizeTeamAccess,
  // requireSuperAdmin
} = require('../middleware/hierarchicalAuth');
const { authorize, authorizeWithTeam } = require('../middleware/auth');
const { checkRoleQuota } = require('../middleware/quotaCheck');
const { auditLogMiddleware: auditLog } = require('../middleware/auditLog');
const { upload, handleUploadError } = require('../middleware/uploadMiddleware');
const TeamService = require('../services/teamService');
const teamImageService = require('../services/teamImageService');
const Team = require('../models/Team');
const hierarchicalAuthService = require('../services/hierarchicalAuthService');

// Get teams for an organization (church)
router.get(
  '/church/:churchId',
  authenticateToken,
  authorizeHierarchical('read', 'organization'),
  async (req, res) => {
    try {
      const { churchId } = req.params;
      const { type, includeInactive } = req.query;

      // Use new hierarchical method - only get teams for churches
      const teams = await Team.getTeamsByChurch(churchId, {
        type,
        includeInactive: includeInactive === 'true',
      });

      res.json({
        success: true,
        data: teams,
      });
    } catch (error) {
      res.status(error.message.includes('permission') ? 403 : 400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Get all teams accessible to user (hierarchical)
router.get('/all', authenticateToken, async (req, res) => {
  try {
    // Get teams accessible based on user's hierarchy level
    const userHierarchyPath =
      await hierarchicalAuthService.getUserHierarchyPath(req.user);

    if (userHierarchyPath === null) {
      return res.status(403).json({
        success: false,
        message: 'No hierarchy access found',
      });
    }

    // Get accessible teams using hierarchical path
    const teams = await Team.getAccessibleTeams(userHierarchyPath);

    res.json({
      success: true,
      data: teams,
    });
  } catch (error) {
    res.status(error.message.includes('permission') ? 403 : 400).json({
      success: false,
      message: error.message,
    });
  }
});

// Get user's teams
router.get('/my-teams', authenticateToken, async (req, res) => {
  try {
    const teams = await TeamService.getUserTeams(req.user._id);

    res.json({
      success: true,
      data: teams,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

// Search teams
router.get(
  '/search',
  authenticateToken,
  authorize('teams.read'),
  async (req, res) => {
    try {
      const {
        q,
        churchId,
        type,
        limit = 50,
        skip = 0,
        includeInactive,
      } = req.query;

      const teams = await TeamService.searchTeams(q, req.user, {
        churchId,
        type,
        limit: parseInt(limit),
        skip: parseInt(skip),
        includeInactive: includeInactive === 'true',
      });

      res.json({
        success: true,
        data: teams,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Get team details
router.get(
  '/:teamId',
  authenticateToken,
  authorizeWithTeam('teams.read'),
  async (req, res) => {
    try {
      const { teamId } = req.params;

      const team = await TeamService.getTeamDetails(teamId, req.user);

      res.json({
        success: true,
        data: team,
      });
    } catch (error) {
      res.status(error.message.includes('not found') ? 404 : 403).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Create new team (HIERARCHICAL - must be under church)
router.post(
  '/',
  authenticateToken,
  authorizeHierarchical('create', 'team'),
  auditLog('team.create'),
  async (req, res) => {
    try {
      const { name, type, leaderId, description, location, churchId } =
        req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Team name is required',
        });
      }

      // Get user's church or use provided churchId/organizationId (must be validated by middleware)
      let targetChurchId = churchId;

      if (!targetChurchId) {
        // Get user's church assignment
        const userChurch = await hierarchicalAuthService.getUserChurch(
          req.user
        );

        if (!userChurch) {
          return res.status(403).json({
            success: false,
            message:
              'No church assignment found. Teams must be created under a church.',
          });
        }

        targetChurchId = userChurch._id;
      }

      // Validate user can create team in this church
      await hierarchicalAuthService.getUserHierarchyPath(req.user);
      const church = await hierarchicalAuthService.getEntity(
        'organization',
        targetChurchId
      );

      if (!church || church.hierarchyLevel !== 2) {
        return res.status(400).json({
          success: false,
          message: 'Teams can only be created under church organizations',
        });
      }

      const canCreate = await hierarchicalAuthService.canUserManageEntity(
        req.user,
        church.hierarchyPath,
        'create'
      );

      if (!canCreate) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions to create team in this church',
        });
      }

      // Create team with church binding
      const team = await Team.createTeam({
        name,
        churchId: targetChurchId,
        category: type || 'other', // Note: Team model uses 'category', not 'type'
        leaderId,
        description,
        location: location || null,
        createdBy: req.user._id,
      });

      res.status(201).json({
        success: true,
        data: team,
        message: 'Team created successfully',
      });
    } catch (error) {
      res.status(error.message.includes('permission') ? 403 : 400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Update team
router.put(
  '/:teamId',
  authenticateToken,
  authorizeWithTeam('teams.update'),
  auditLog('team.update'),
  async (req, res) => {
    try {
      const { teamId } = req.params;
      const updates = req.body;

      const team = await TeamService.updateTeam(teamId, updates, req.user);

      res.json({
        success: true,
        data: team,
        message: 'Team updated successfully',
      });
    } catch (error) {
      res.status(error.message.includes('not found') ? 404 : 403).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Add team member
router.post(
  '/:teamId/members',
  authenticateToken,
  authorizeWithTeam('teams.manage_members'),
  checkRoleQuota,
  auditLog('team.member.add'),
  async (req, res) => {
    try {
      const { teamId } = req.params;
      const { userId, role = 'member' } = req.body;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required',
        });
      }

      const result = await TeamService.addTeamMember(
        teamId,
        userId,
        role,
        req.user
      );

      res.json({
        success: true,
        data: result,
        message: 'Member added to team successfully',
      });
    } catch (error) {
      res.status(error.message.includes('not found') ? 404 : 403).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Update team member role
router.put(
  '/:teamId/members/:userId',
  authenticateToken,
  authorizeWithTeam('teams.manage_members'),
  auditLog('team.member.update'),
  async (req, res) => {
    try {
      const { teamId, userId } = req.params;
      const { role } = req.body;

      if (!role) {
        return res.status(400).json({
          success: false,
          message: 'New role is required',
        });
      }

      const result = await TeamService.updateMemberRole(
        teamId,
        userId,
        role,
        req.user
      );

      res.json({
        success: true,
        data: result,
        message: 'Member role updated successfully',
      });
    } catch (error) {
      res.status(error.message.includes('not found') ? 404 : 403).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Remove team member
router.delete(
  '/:teamId/members/:userId',
  authenticateToken,
  authorizeWithTeam('teams.manage_members'),
  auditLog('team.member.remove'),
  async (req, res) => {
    try {
      const { teamId, userId } = req.params;

      const result = await TeamService.removeTeamMember(
        teamId,
        userId,
        req.user
      );

      res.json({
        success: true,
        data: result,
        message: 'Member removed from team successfully',
      });
    } catch (error) {
      res.status(error.message.includes('not found') ? 404 : 403).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Get team members
router.get(
  '/:teamId/members',
  authenticateToken,
  authorizeWithTeam('teams.read'),
  async (req, res) => {
    try {
      const { teamId } = req.params;
      const { role, limit = 100, skip = 0 } = req.query;

      const team = await Team.findById(teamId);
      if (!team) {
        return res.status(404).json({
          success: false,
          message: 'Team not found',
        });
      }

      const members = await team.getMembers({
        role,
        limit: parseInt(limit),
        skip: parseInt(skip),
      });

      res.json({
        success: true,
        data: members,
        meta: {
          total: team.memberCount,
          limit: parseInt(limit),
          skip: parseInt(skip),
        },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Delete team (soft delete)
router.delete(
  '/:teamId',
  authenticateToken,
  authorize('teams.delete'),
  auditLog('team.delete'),
  async (req, res) => {
    try {
      const { teamId } = req.params;

      const team = await Team.findById(teamId);
      if (!team) {
        return res.status(404).json({
          success: false,
          message: 'Team not found',
        });
      }

      // Check permissions
      const hasPermission = await hierarchicalAuthService.canUserManageEntity(
        req.user,
        team.churchId
      );

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions to delete this team',
        });
      }

      // Hard delete from database
      await Team.findByIdAndDelete(teamId);

      res.json({
        success: true,
        message: 'Team deleted successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Team Image Upload Routes

// Upload team banner
router.put(
  '/:teamId/banner',
  authenticateToken,
  authorizeWithTeam('teams.manage'),
  upload.banner,
  handleUploadError,
  auditLog('team.banner.upload'),
  async (req, res) => {
    try {
      const { teamId } = req.params;
      const { alt = '' } = req.body;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No banner image provided',
        });
      }

      const team = await teamImageService.uploadBanner(
        teamId,
        req.file.buffer,
        {
          originalName: req.file.originalname,
          uploadedBy: req.user._id,
          alt,
        }
      );

      res.json({
        success: true,
        data: {
          teamId: team._id,
          banner: team.banner,
        },
        message: 'Banner uploaded successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Upload team profile photo
router.put(
  '/:teamId/profile-photo',
  authenticateToken,
  authorizeWithTeam('teams.manage'),
  upload.avatar,
  handleUploadError,
  auditLog('team.profilePhoto.upload'),
  async (req, res) => {
    try {
      const { teamId } = req.params;
      const { alt = '' } = req.body;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No profile photo provided',
        });
      }

      const team = await teamImageService.uploadProfilePhoto(
        teamId,
        req.file.buffer,
        {
          originalName: req.file.originalname,
          uploadedBy: req.user._id,
          alt,
        }
      );

      res.json({
        success: true,
        data: {
          teamId: team._id,
          profilePhoto: team.profilePhoto,
        },
        message: 'Profile photo uploaded successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Remove team banner
router.delete(
  '/:teamId/banner',
  authenticateToken,
  authorizeWithTeam('teams.manage'),
  auditLog('team.banner.remove'),
  async (req, res) => {
    try {
      const { teamId } = req.params;

      const team = await teamImageService.removeBanner(teamId);

      res.json({
        success: true,
        data: {
          teamId: team._id,
          banner: team.banner,
        },
        message: 'Banner removed successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Remove team profile photo
router.delete(
  '/:teamId/profile-photo',
  authenticateToken,
  authorizeWithTeam('teams.manage'),
  auditLog('team.profilePhoto.remove'),
  async (req, res) => {
    try {
      const { teamId } = req.params;

      const team = await teamImageService.removeProfilePhoto(teamId);

      res.json({
        success: true,
        data: {
          teamId: team._id,
          profilePhoto: team.profilePhoto,
        },
        message: 'Profile photo removed successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Set team banner from existing media file
router.put(
  '/:teamId/banner/media',
  authenticateToken,
  authorizeWithTeam('teams.manage'),
  auditLog('team.banner.setFromMedia'),
  async (req, res) => {
    try {
      const { teamId } = req.params;
      const { mediaFileId, alt = '' } = req.body;

      if (!mediaFileId) {
        return res.status(400).json({
          success: false,
          message: 'Media file ID is required',
        });
      }

      // Get the media file
      const MediaFile = require('../models/MediaFile');
      const mediaFile = await MediaFile.findById(mediaFileId);

      if (!mediaFile) {
        return res.status(404).json({
          success: false,
          message: 'Media file not found',
        });
      }

      // Get team and update banner with media file info
      const Team = require('../models/Team');
      const team = await Team.findById(teamId);

      if (!team) {
        return res.status(404).json({
          success: false,
          message: 'Team not found',
        });
      }

      // Remove existing banner if present
      if (team.banner?.key) {
        await teamImageService.removeBanner(teamId);
      }

      // Set banner from media file
      team.banner = {
        url: mediaFile.url,
        key: mediaFile.key,
        alt: alt || `${team.name} banner`,
      };

      await team.save();

      res.json({
        success: true,
        data: {
          teamId: team._id,
          banner: team.banner,
        },
        message: 'Banner set from media file successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Set team profile photo from existing media file
router.put(
  '/:teamId/profile-photo/media',
  authenticateToken,
  authorizeWithTeam('teams.manage'),
  auditLog('team.profilePhoto.setFromMedia'),
  async (req, res) => {
    try {
      const { teamId } = req.params;
      const { mediaFileId, alt = '' } = req.body;

      if (!mediaFileId) {
        return res.status(400).json({
          success: false,
          message: 'Media file ID is required',
        });
      }

      // Get the media file
      const MediaFile = require('../models/MediaFile');
      const mediaFile = await MediaFile.findById(mediaFileId);

      if (!mediaFile) {
        return res.status(404).json({
          success: false,
          message: 'Media file not found',
        });
      }

      // Get team and update profile photo with media file info
      const Team = require('../models/Team');
      const team = await Team.findById(teamId);

      if (!team) {
        return res.status(404).json({
          success: false,
          message: 'Team not found',
        });
      }

      // Remove existing profile photo if present
      if (team.profilePhoto?.key) {
        await teamImageService.removeProfilePhoto(teamId);
      }

      // Set profile photo from media file
      team.profilePhoto = {
        url: mediaFile.url,
        key: mediaFile.key,
        alt: alt || `${team.name} profile photo`,
      };

      await team.save();

      res.json({
        success: true,
        data: {
          teamId: team._id,
          profilePhoto: team.profilePhoto,
        },
        message: 'Profile photo set from media file successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Get team images
router.get(
  '/:teamId/images',
  authenticateToken,
  authorizeWithTeam('teams.read'),
  async (req, res) => {
    try {
      const { teamId } = req.params;

      const images = await teamImageService.getTeamImages(teamId);

      res.json({
        success: true,
        data: images,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

module.exports = router;
