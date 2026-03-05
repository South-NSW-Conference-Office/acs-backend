const express = require('express');
const Church = require('../models/Church');
const Conference = require('../models/Conference');

const router = express.Router();

/**
 * GET /api/public/fellowship
 * Public endpoint — no auth required
 * Returns active conferences with their churches for the Fellowship page
 * Query: ?conferenceId=xxx to filter by conference
 */
router.get('/', async (req, res) => {
  try {
    const { conferenceId } = req.query;

    // Get active conferences
    const conferences = await Conference.find({ isActive: true })
      .select('name code territory')
      .sort('name');

    // Get churches (optionally filtered by conference)
    const churchQuery = { isActive: true };
    if (conferenceId) {
      churchQuery.conferenceId = conferenceId;
    }

    const churches = await Church.find(churchQuery)
      .select('name code location contact facilities services outreach conferenceId metadata')
      .populate('conferenceId', 'name code')
      .sort('name');

    // Transform for public consumption — no sensitive data
    const publicChurches = churches.map(church => ({
      id: church._id,
      name: church.name,
      code: church.code,
      city: church.location?.address?.city || '',
      state: church.location?.address?.state || '',
      conference: church.conferenceId?.name || 'Unknown',
      conferenceCode: church.conferenceId?.code || '',
      conferenceId: church.conferenceId?._id || null,
      hasKitchen: church.facilities?.kitchen?.available || false,
      // Infer meals from kitchen availability + special services
      hasMeals: church.facilities?.kitchen?.available || false,
      mealDay: church.services?.special?.find(s => 
        s.name?.toLowerCase().includes('meal') || s.name?.toLowerCase().includes('lunch')
      )?.schedule || (church.facilities?.kitchen?.available ? 'Saturday lunch' : null),
      worshipTime: church.services?.worship?.time || null,
      sabbathSchoolTime: church.services?.sabbathSchool?.time || null,
      outreachFocus: church.outreach?.primaryFocus || [],
      teamCount: church.metadata?.teamCount || 0,
      serviceCount: church.metadata?.serviceCount || 0,
      coordinates: church.location?.coordinates || null,
    }));

    res.json({
      success: true,
      conferences: conferences.map(c => ({
        id: c._id,
        name: c.name,
        code: c.code,
        churchCount: publicChurches.filter(ch => String(ch.conferenceId) === String(c._id)).length,
      })),
      churches: publicChurches,
      total: publicChurches.length,
    });
  } catch (error) {
    console.error('Fellowship public endpoint error:', error);
    res.status(500).json({ success: false, message: 'Failed to load fellowship data' });
  }
});

module.exports = router;
