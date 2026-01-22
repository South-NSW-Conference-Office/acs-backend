const express = require('express');
const router = express.Router();
const PageContent = require('../../models/PageContent');
const PageContentVersion = require('../../models/PageContentVersion');
const { authenticateToken, authorize } = require('../../middleware/auth');

/**
 * Admin routes for page content management
 * All routes require authentication and page_content.manage permission
 */
router.use(authenticateToken);

/**
 * GET /api/admin/page-content
 * Get all page content (all statuses)
 */
router.get('/', authorize('page_content.manage'), async (req, res) => {
  try {
    const {
      status,
      search,
      page = 1,
      limit = 20,
      sortBy = 'pageName',
      sortOrder = 'asc',
    } = req.query;

    const query = {};

    if (status && status !== 'all') {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { pageName: { $regex: search, $options: 'i' } },
        { pageId: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [pages, total] = await Promise.all([
      PageContent.find(query)
        .populate('createdBy', 'firstName lastName email')
        .populate('updatedBy', 'firstName lastName email')
        .populate('publishedBy', 'firstName lastName email')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      PageContent.countDocuments(query),
    ]);

    res.json({
      success: true,
      pages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch page content',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/page-content/:pageId
 * Get single page content by pageId
 */
router.get('/:pageId', authorize('page_content.manage'), async (req, res) => {
  try {
    const page = await PageContent.findOne({ pageId: req.params.pageId })
      .populate('createdBy', 'firstName lastName email')
      .populate('updatedBy', 'firstName lastName email')
      .populate('publishedBy', 'firstName lastName email');

    if (!page) {
      return res.status(404).json({
        success: false,
        error: 'Page content not found',
      });
    }

    res.json({
      success: true,
      page,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch page content',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/page-content
 * Create new page content
 */
router.post('/', authorize('page_content.manage'), async (req, res) => {
  try {
    const { pageId, pageName, description, slug, sections } = req.body;

    // Check if pageId already exists
    const existing = await PageContent.findOne({ pageId });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Page with this ID already exists',
      });
    }

    const page = new PageContent({
      pageId,
      pageName,
      description,
      slug,
      sections: sections || [],
      status: 'draft',
      version: 1,
      createdBy: req.user._id,
    });

    await page.save();
    await page.populate('createdBy', 'firstName lastName email');

    res.status(201).json({
      success: true,
      message: 'Page content created successfully',
      page,
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
      error: 'Failed to create page content',
      message: error.message,
    });
  }
});

/**
 * PUT /api/admin/page-content/:pageId
 * Update page content (saves as draft)
 */
router.put('/:pageId', authorize('page_content.manage'), async (req, res) => {
  try {
    const page = await PageContent.findOne({ pageId: req.params.pageId });

    if (!page) {
      return res.status(404).json({
        success: false,
        error: 'Page content not found',
      });
    }

    const { pageName, description, slug, sections } = req.body;

    // Update fields
    if (pageName !== undefined) page.pageName = pageName;
    if (description !== undefined) page.description = description;
    if (slug !== undefined) page.slug = slug;
    if (sections !== undefined) page.sections = sections;

    // Mark as draft if published
    if (page.status === 'published') {
      page.status = 'draft';
    }

    page.updatedBy = req.user._id;
    await page.save();

    await page.populate('createdBy', 'firstName lastName email');
    await page.populate('updatedBy', 'firstName lastName email');

    res.json({
      success: true,
      message: 'Page content updated successfully',
      page,
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
      error: 'Failed to update page content',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/page-content/:pageId/publish
 * Publish page content
 */
router.post(
  '/:pageId/publish',
  authorize('page_content.manage'),
  async (req, res) => {
    try {
      const page = await PageContent.findOne({ pageId: req.params.pageId });

      if (!page) {
        return res.status(404).json({
          success: false,
          error: 'Page content not found',
        });
      }

      // Create version snapshot before publishing
      await PageContentVersion.createSnapshot(
        page,
        req.user._id,
        req.body.changeDescription || 'Published'
      );

      // Update page
      page.status = 'published';
      page.publishedAt = new Date();
      page.publishedBy = req.user._id;
      page.version += 1;
      page.updatedBy = req.user._id;

      await page.save();
      await page.populate('createdBy', 'firstName lastName email');
      await page.populate('updatedBy', 'firstName lastName email');
      await page.populate('publishedBy', 'firstName lastName email');

      res.json({
        success: true,
        message: 'Page content published successfully',
        page,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to publish page content',
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/admin/page-content/:pageId/unpublish
 * Revert page content to draft
 */
router.post(
  '/:pageId/unpublish',
  authorize('page_content.manage'),
  async (req, res) => {
    try {
      const page = await PageContent.findOne({ pageId: req.params.pageId });

      if (!page) {
        return res.status(404).json({
          success: false,
          error: 'Page content not found',
        });
      }

      page.status = 'draft';
      page.updatedBy = req.user._id;

      await page.save();
      await page.populate('createdBy', 'firstName lastName email');
      await page.populate('updatedBy', 'firstName lastName email');

      res.json({
        success: true,
        message: 'Page content reverted to draft',
        page,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to unpublish page content',
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/admin/page-content/:pageId/versions
 * Get version history for a page
 */
router.get(
  '/:pageId/versions',
  authorize('page_content.manage'),
  async (req, res) => {
    try {
      const page = await PageContent.findOne({ pageId: req.params.pageId });

      if (!page) {
        return res.status(404).json({
          success: false,
          error: 'Page content not found',
        });
      }

      const limit = parseInt(req.query.limit) || 20;
      const versions = await PageContentVersion.getVersionHistory(
        page._id,
        limit
      );

      res.json({
        success: true,
        versions,
        currentVersion: page.version,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch version history',
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/admin/page-content/:pageId/revert/:version
 * Revert to a specific version
 */
router.post(
  '/:pageId/revert/:version',
  authorize('page_content.manage'),
  async (req, res) => {
    try {
      const page = await PageContent.findOne({ pageId: req.params.pageId });

      if (!page) {
        return res.status(404).json({
          success: false,
          error: 'Page content not found',
        });
      }

      const targetVersion = parseInt(req.params.version);
      const versionSnapshot = await PageContentVersion.getVersion(
        page._id,
        targetVersion
      );

      if (!versionSnapshot) {
        return res.status(404).json({
          success: false,
          error: 'Version not found',
        });
      }

      // Create snapshot of current state before reverting
      await PageContentVersion.createSnapshot(
        page,
        req.user._id,
        `Before reverting to version ${targetVersion}`
      );

      // Restore sections from snapshot
      page.sections = versionSnapshot.sections;
      page.status = 'draft';
      page.version += 1;
      page.updatedBy = req.user._id;

      await page.save();
      await page.populate('createdBy', 'firstName lastName email');
      await page.populate('updatedBy', 'firstName lastName email');

      res.json({
        success: true,
        message: `Reverted to version ${targetVersion}`,
        page,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to revert to version',
        message: error.message,
      });
    }
  }
);

/**
 * DELETE /api/admin/page-content/:pageId
 * Delete page content
 */
router.delete(
  '/:pageId',
  authorize('page_content.manage'),
  async (req, res) => {
    try {
      const page = await PageContent.findOne({ pageId: req.params.pageId });

      if (!page) {
        return res.status(404).json({
          success: false,
          error: 'Page content not found',
        });
      }

      // Delete all versions
      await PageContentVersion.deleteMany({ pageContent: page._id });

      // Delete the page
      await PageContent.deleteOne({ _id: page._id });

      res.json({
        success: true,
        message: 'Page content deleted successfully',
        deletedPage: {
          pageId: page.pageId,
          pageName: page.pageName,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to delete page content',
        message: error.message,
      });
    }
  }
);

module.exports = router;
