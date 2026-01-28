const express = require('express');
const router = express.Router();
const Testimony = require('../../models/Testimony');
const { authenticateToken, authorize } = require('../../middleware/auth');

/**
 * Admin routes for testimonies management
 * All routes require authentication and testimonies.manage permission
 */
router.use(authenticateToken);

/**
 * GET /api/admin/testimonies
 * Get all testimonies with filters
 */
router.get('/', authorize('testimonies.manage'), async (req, res) => {
  try {
    const {
      status,
      search,
      featured,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const query = {};

    if (status && status !== 'all') {
      query.status = status;
    }

    if (featured === 'true') {
      query.isFeatured = true;
    } else if (featured === 'false') {
      query.isFeatured = false;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } },
        { review: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [testimonies, total] = await Promise.all([
      Testimony.find(query)
        .populate('createdBy', 'firstName lastName email')
        .populate('updatedBy', 'firstName lastName email')
        .populate('approvedBy', 'firstName lastName email')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Testimony.countDocuments(query),
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
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/testimonies/stats
 * Get testimonies statistics
 */
router.get('/stats', authorize('testimonies.manage'), async (req, res) => {
  try {
    const [total, draft, pending, approved, rejected, featured] =
      await Promise.all([
        Testimony.countDocuments(),
        Testimony.countDocuments({ status: 'draft' }),
        Testimony.countDocuments({ status: 'pending' }),
        Testimony.countDocuments({ status: 'approved' }),
        Testimony.countDocuments({ status: 'rejected' }),
        Testimony.countDocuments({ status: 'approved', isFeatured: true }),
      ]);

    res.json({
      success: true,
      stats: {
        total,
        draft,
        pending,
        approved,
        rejected,
        featured,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch testimonies stats',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/testimonies/:id
 * Get single testimony by ID
 */
router.get('/:id', authorize('testimonies.manage'), async (req, res) => {
  try {
    const testimony = await Testimony.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email')
      .populate('updatedBy', 'firstName lastName email')
      .populate('approvedBy', 'firstName lastName email');

    if (!testimony) {
      return res.status(404).json({
        success: false,
        error: 'Testimony not found',
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
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/testimonies
 * Create new testimony
 */
router.post('/', authorize('testimonies.manage'), async (req, res) => {
  try {
    const { name, location, review, image } = req.body;

    // Validate required fields
    if (!name || !location || !review || !image?.url) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        details: ['name, location, review, and image.url are required'],
      });
    }

    const testimony = new Testimony({
      name,
      location,
      review,
      image: {
        url: image.url,
        alt: image.alt || name,
        key: image.key,
      },
      status: 'draft',
      createdBy: req.user._id,
    });

    await testimony.save();
    await testimony.populate('createdBy', 'firstName lastName email');

    res.status(201).json({
      success: true,
      message: 'Testimony created successfully',
      testimony,
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: Object.values(error.errors).map((e) => e.message),
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to create testimony',
      message: error.message,
    });
  }
});

/**
 * PUT /api/admin/testimonies/:id
 * Update testimony
 */
router.put('/:id', authorize('testimonies.manage'), async (req, res) => {
  try {
    const testimony = await Testimony.findById(req.params.id);

    if (!testimony) {
      return res.status(404).json({
        success: false,
        error: 'Testimony not found',
      });
    }

    const { name, location, review, image } = req.body;

    // Update fields
    if (name !== undefined) testimony.name = name;
    if (location !== undefined) testimony.location = location;
    if (review !== undefined) testimony.review = review;
    if (image !== undefined) {
      testimony.image = {
        url: image.url,
        alt: image.alt || testimony.image.alt,
        key: image.key || testimony.image.key,
      };
    }

    testimony.updatedBy = req.user._id;
    await testimony.save();

    await testimony.populate('createdBy', 'firstName lastName email');
    await testimony.populate('updatedBy', 'firstName lastName email');

    res.json({
      success: true,
      message: 'Testimony updated successfully',
      testimony,
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: Object.values(error.errors).map((e) => e.message),
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to update testimony',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/testimonies/:id/submit
 * Submit testimony for approval (draft -> pending)
 */
router.post(
  '/:id/submit',
  authorize('testimonies.manage'),
  async (req, res) => {
    try {
      const testimony = await Testimony.findById(req.params.id);

      if (!testimony) {
        return res.status(404).json({
          success: false,
          error: 'Testimony not found',
        });
      }

      if (testimony.status !== 'draft') {
        return res.status(400).json({
          success: false,
          error: 'Only draft testimonies can be submitted for approval',
        });
      }

      testimony.status = 'pending';
      testimony.updatedBy = req.user._id;
      await testimony.save();

      await testimony.populate('createdBy', 'firstName lastName email');
      await testimony.populate('updatedBy', 'firstName lastName email');

      res.json({
        success: true,
        message: 'Testimony submitted for approval',
        testimony,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to submit testimony',
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/admin/testimonies/:id/approve
 * Approve testimony
 */
router.post(
  '/:id/approve',
  authorize('testimonies.manage'),
  async (req, res) => {
    try {
      const testimony = await Testimony.findById(req.params.id);

      if (!testimony) {
        return res.status(404).json({
          success: false,
          error: 'Testimony not found',
        });
      }

      if (testimony.status !== 'pending') {
        return res.status(400).json({
          success: false,
          error: 'Only pending testimonies can be approved',
        });
      }

      testimony.status = 'approved';
      testimony.approvedAt = new Date();
      testimony.approvedBy = req.user._id;
      testimony.rejectionReason = undefined;
      await testimony.save();

      await testimony.populate('createdBy', 'firstName lastName email');
      await testimony.populate('approvedBy', 'firstName lastName email');

      res.json({
        success: true,
        message: 'Testimony approved successfully',
        testimony,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to approve testimony',
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/admin/testimonies/:id/reject
 * Reject testimony
 */
router.post(
  '/:id/reject',
  authorize('testimonies.manage'),
  async (req, res) => {
    try {
      const testimony = await Testimony.findById(req.params.id);

      if (!testimony) {
        return res.status(404).json({
          success: false,
          error: 'Testimony not found',
        });
      }

      if (testimony.status !== 'pending') {
        return res.status(400).json({
          success: false,
          error: 'Only pending testimonies can be rejected',
        });
      }

      const { reason } = req.body;

      testimony.status = 'rejected';
      testimony.rejectionReason = reason || '';
      testimony.updatedBy = req.user._id;
      await testimony.save();

      await testimony.populate('createdBy', 'firstName lastName email');
      await testimony.populate('updatedBy', 'firstName lastName email');

      res.json({
        success: true,
        message: 'Testimony rejected',
        testimony,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to reject testimony',
        message: error.message,
      });
    }
  }
);

/**
 * PUT /api/admin/testimonies/:id/featured
 * Toggle featured status
 */
router.put(
  '/:id/featured',
  authorize('testimonies.manage'),
  async (req, res) => {
    try {
      const testimony = await Testimony.findById(req.params.id);

      if (!testimony) {
        return res.status(404).json({
          success: false,
          error: 'Testimony not found',
        });
      }

      if (testimony.status !== 'approved') {
        return res.status(400).json({
          success: false,
          error: 'Only approved testimonies can be featured',
        });
      }

      const { featured, order } = req.body;

      testimony.isFeatured =
        featured !== undefined ? featured : !testimony.isFeatured;
      if (order !== undefined) {
        testimony.featuredOrder = order;
      }
      testimony.updatedBy = req.user._id;
      await testimony.save();

      await testimony.populate('createdBy', 'firstName lastName email');
      await testimony.populate('updatedBy', 'firstName lastName email');
      await testimony.populate('approvedBy', 'firstName lastName email');

      res.json({
        success: true,
        message: testimony.isFeatured
          ? 'Testimony marked as featured'
          : 'Testimony removed from featured',
        testimony,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to update featured status',
        message: error.message,
      });
    }
  }
);

/**
 * PUT /api/admin/testimonies/:id/reorder
 * Update featured order
 */
router.put(
  '/:id/reorder',
  authorize('testimonies.manage'),
  async (req, res) => {
    try {
      const testimony = await Testimony.findById(req.params.id);

      if (!testimony) {
        return res.status(404).json({
          success: false,
          error: 'Testimony not found',
        });
      }

      const { order } = req.body;

      if (order === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Order is required',
        });
      }

      testimony.featuredOrder = order;
      testimony.updatedBy = req.user._id;
      await testimony.save();

      res.json({
        success: true,
        message: 'Featured order updated',
        testimony,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to update featured order',
        message: error.message,
      });
    }
  }
);

/**
 * DELETE /api/admin/testimonies/:id
 * Delete testimony
 */
router.delete('/:id', authorize('testimonies.manage'), async (req, res) => {
  try {
    const testimony = await Testimony.findById(req.params.id);

    if (!testimony) {
      return res.status(404).json({
        success: false,
        error: 'Testimony not found',
      });
    }

    const deletedTestimony = {
      _id: testimony._id,
      name: testimony.name,
      location: testimony.location,
    };

    await Testimony.deleteOne({ _id: testimony._id });

    res.json({
      success: true,
      message: 'Testimony deleted successfully',
      deletedTestimony,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to delete testimony',
      message: error.message,
    });
  }
});

module.exports = router;
