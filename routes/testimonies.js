const express = require('express');
const router = express.Router();
const Testimony = require('../models/Testimony');

/**
 * Public routes for testimonies
 * These routes return only approved testimonies
 */

/**
 * GET /api/testimonies
 * Get all approved testimonies
 */
router.get('/', async (req, res) => {
  try {
    const { limit = 20, page = 1 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [testimonies, total] = await Promise.all([
      Testimony.find({ status: 'approved' })
        .select('name location review image approvedAt')
        .sort('-approvedAt')
        .skip(skip)
        .limit(parseInt(limit)),
      Testimony.countDocuments({ status: 'approved' }),
    ]);

    res.json({
      success: true,
      testimonies,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch testimonies',
    });
  }
});

/**
 * GET /api/testimonies/featured
 * Get featured testimonies for homepage display
 */
router.get('/featured', async (req, res) => {
  try {
    const { limit = 8 } = req.query;

    const testimonies = await Testimony.findFeatured(parseInt(limit)).select(
      'name location review image'
    );

    res.json({
      success: true,
      testimonies,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch featured testimonies',
    });
  }
});

/**
 * GET /api/testimonies/:id
 * Get single approved testimony by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const testimony = await Testimony.findOne({
      _id: req.params.id,
      status: 'approved',
    }).select('name location review image approvedAt');

    if (!testimony) {
      return res.status(404).json({
        success: false,
        error: 'Testimony not found or not approved',
      });
    }

    res.json({
      success: true,
      testimony,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch testimony',
    });
  }
});

module.exports = router;
