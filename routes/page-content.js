const express = require('express');
const router = express.Router();
const PageContent = require('../models/PageContent');

/**
 * Public routes for page content
 * These routes return only published content
 */

/**
 * GET /api/page-content
 * Get all published page content
 */
router.get('/', async (req, res) => {
  try {
    const pages = await PageContent.findAllPublished().select(
      'pageId pageName slug description sections status publishedAt'
    );

    res.json({
      success: true,
      pages,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch page content',
    });
  }
});

/**
 * GET /api/page-content/:pageId
 * Get published content for a specific page
 */
router.get('/:pageId', async (req, res) => {
  try {
    const page = await PageContent.findPublished(req.params.pageId).select(
      'pageId pageName slug description sections status publishedAt'
    );

    if (!page) {
      return res.status(404).json({
        success: false,
        error: 'Page content not found or not published',
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
    });
  }
});

/**
 * GET /api/page-content/:pageId/section/:sectionId
 * Get a specific section from published page content
 */
router.get('/:pageId/section/:sectionId', async (req, res) => {
  try {
    const page = await PageContent.findPublished(req.params.pageId);

    if (!page) {
      return res.status(404).json({
        success: false,
        error: 'Page content not found or not published',
      });
    }

    const section = page.sections.find(
      (s) => s.sectionId === req.params.sectionId && s.isEnabled
    );

    if (!section) {
      return res.status(404).json({
        success: false,
        error: 'Section not found or not enabled',
      });
    }

    res.json({
      success: true,
      section,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch section content',
    });
  }
});

/**
 * GET /api/page-content/:pageId/block/:sectionId/:blockKey
 * Get a specific content block from published page content
 */
router.get('/:pageId/block/:sectionId/:blockKey', async (req, res) => {
  try {
    const page = await PageContent.findPublished(req.params.pageId);

    if (!page) {
      return res.status(404).json({
        success: false,
        error: 'Page content not found or not published',
      });
    }

    const content = page.getBlockContent(
      req.params.sectionId,
      req.params.blockKey
    );

    if (content === null) {
      return res.status(404).json({
        success: false,
        error: 'Content block not found',
      });
    }

    res.json({
      success: true,
      content,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch content block',
    });
  }
});

module.exports = router;
