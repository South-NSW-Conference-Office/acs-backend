const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const { getQuotaStatus } = require('../middleware/quotaCheck');

// Apply authentication to all routes
router.use(authenticateToken);

// GET /api/quota/status - Get quota status for all roles
router.get('/status', authorize('users.read'), getQuotaStatus);

module.exports = router;
