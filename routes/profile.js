const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { upload } = require('../middleware/uploadMiddleware');
const storageService = require('../services/storageService');
const User = require('../models/User');

// Update profile avatar
router.put('/avatar', authenticateToken, upload.avatar, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided',
      });
    }

    // Validate image dimensions (minimum 100x100, maximum 2000x2000)
    const sharp = require('sharp');
    const metadata = await sharp(req.file.buffer).metadata();

    if (metadata.width < 100 || metadata.height < 100) {
      return res.status(400).json({
        success: false,
        message: 'Image must be at least 100x100 pixels',
      });
    }

    if (metadata.width > 2000 || metadata.height > 2000) {
      return res.status(400).json({
        success: false,
        message: 'Image must not exceed 2000x2000 pixels',
      });
    }

    // Delete old avatar if it exists
    if (user.avatar && user.avatar.key) {
      try {
        await storageService.deleteFile(user.avatar.key);
      } catch (deleteError) {
        // Failed to delete old avatar
      }
    }

    // Upload new avatar
    const uploadResult = await storageService.uploadProfileAvatar(
      req.file,
      user._id
    );

    // Update user record
    user.avatar = {
      url: uploadResult.url,
      key: uploadResult.key,
    };
    await user.save();

    res.json({
      success: true,
      message: 'Profile avatar updated successfully',
      avatar: user.avatar,
    });
  } catch (error) {
    // Profile avatar upload error occurred
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload avatar',
    });
  }
});

// Remove profile avatar
router.delete('/avatar', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Delete avatar file if it exists
    if (user.avatar && user.avatar.key) {
      try {
        await storageService.deleteFile(user.avatar.key);
      } catch (deleteError) {
        // Failed to delete avatar file
      }
    }

    // Remove avatar from user record
    user.avatar = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Profile avatar removed successfully',
    });
  } catch (error) {
    // Profile avatar removal error occurred
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to remove avatar',
    });
  }
});

module.exports = router;
