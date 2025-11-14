const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Role = require('../models/Role');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/signin - Login
router.post('/signin', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
        err: 'Invalid input data'
      });
    }

    const { email, password } = req.body;

    // Find user and populate organization and role data
    const user = await User.findOne({ email, isActive: true })
      .populate('organizations.organization')
      .populate('organizations.role')
      .populate('primaryOrganization');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        err: 'User not found or inactive'
      });
    }

    // Check password
    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        err: 'Incorrect password'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user._id,
        email: user.email
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Get permissions for primary organization (if exists)
    let permissions = [];
    let role = null;
    
    if (user.primaryOrganization && user.organizations.length > 0) {
      const primaryOrgAssignment = user.organizations.find(
        org => org.organization._id.toString() === user.primaryOrganization._id.toString()
      );
      
      if (primaryOrgAssignment) {
        permissions = primaryOrgAssignment.role.permissions || [];
        role = {
          id: primaryOrgAssignment.role._id,
          name: primaryOrgAssignment.role.name,
          displayName: primaryOrgAssignment.role.displayName,
          level: primaryOrgAssignment.role.level
        };
      }
    }

    // Prepare user data for response
    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      verified: user.verified,
      avatar: user.avatar,
      organizations: user.organizations.map(org => ({
        organization: {
          _id: org.organization._id,
          name: org.organization.name,
          type: org.organization.type
        },
        role: {
          _id: org.role._id,
          name: org.role.name,
          displayName: org.role.displayName,
          level: org.role.level
        },
        assignedAt: org.assignedAt
      })),
      primaryOrganization: user.primaryOrganization?._id
    };

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: userData,
        token,
        permissions,
        role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      err: error.message
    });
  }
});

// GET /api/auth/is-auth - Verify authentication
router.get('/is-auth', authenticateToken, async (req, res) => {
  try {
    const user = req.user;

    // Prepare user data for response (without sensitive information)
    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      verified: user.verified,
      avatar: user.avatar,
      organizations: user.organizations.map(org => ({
        organization: {
          _id: org.organization._id,
          name: org.organization.name,
          type: org.organization.type
        },
        role: {
          _id: org.role._id,
          name: org.role.name,
          displayName: org.role.displayName,
          level: org.role.level
        },
        assignedAt: org.assignedAt
      })),
      primaryOrganization: user.primaryOrganization
    };

    res.json(userData);

  } catch (error) {
    console.error('Auth verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      err: error.message
    });
  }
});

// POST /api/auth/register - Register new user (for development)
router.post('/register', [
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { name, email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists',
        err: 'Email already registered'
      });
    }

    // Create new user
    const user = new User({
      name,
      email,
      password,
      verified: process.env.NODE_ENV === 'development' // Auto-verify in development
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        verified: user.verified
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      err: error.message
    });
  }
});

module.exports = router;