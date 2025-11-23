const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { authenticateToken, checkPermission } = require('../middleware/auth');
const emailService = require('../services/emailService');
const tokenService = require('../services/tokenService');

const router = express.Router();

// POST /api/auth/verify-email - Verify email address
router.post(
  '/verify-email',
  [body('token').notEmpty().withMessage('Verification token is required')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { token } = req.body;

      // Find user with matching verification token
      const user = await User.findOne({
        emailVerificationToken: token,
        emailVerificationExpires: { $gt: Date.now() },
      });

      if (!user) {
        // Check if token exists but is expired
        const expiredUser = await User.findOne({
          emailVerificationToken: token,
        });
        if (expiredUser) {
          return res.status(400).json({
            success: false,
            message:
              'Verification link has expired. Please contact your administrator to resend the verification email.',
          });
        }

        return res.status(400).json({
          success: false,
          message: 'Invalid verification token',
        });
      }

      // Verify the user
      user.verified = true;
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
      await user.save();

      // Send welcome email
      await emailService.sendWelcomeEmail(user);

      res.json({
        success: true,
        message: 'Email verified successfully',
        data: {
          email: user.email,
          name: user.name,
        },
      });
    } catch (error) {
      // Error verifying email
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }
);

// POST /api/auth/verify-email-and-set-password - Verify email and set initial password
router.post(
  '/verify-email-and-set-password',
  [
    body('token').notEmpty().withMessage('Verification token is required'),
    body('password')
      .isString()
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { token, password } = req.body;

      // Find user with matching verification token
      const user = await User.findOne({
        emailVerificationToken: token,
        emailVerificationExpires: { $gt: Date.now() },
      });

      if (!user) {
        // Check if token exists but is expired
        const expiredUser = await User.findOne({
          emailVerificationToken: token,
        });
        if (expiredUser) {
          return res.status(400).json({
            success: false,
            message:
              'Verification link has expired. Please contact your administrator to resend the verification email.',
          });
        }

        return res.status(400).json({
          success: false,
          message: 'Invalid verification token',
        });
      }

      // Check if user already has a password set
      if (user.passwordSet) {
        return res.status(400).json({
          success: false,
          message:
            'Password has already been set for this account. Please use the login page.',
        });
      }

      // Verify the user and set password
      user.verified = true;
      user.password = password; // Will trigger pre-save hook to hash and set passwordSet
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
      await user.save();

      // Send welcome email
      await emailService.sendWelcomeEmail(user);

      res.json({
        success: true,
        message: 'Email verified and password set successfully',
        data: {
          email: user.email,
          name: user.name,
          passwordSet: user.passwordSet,
        },
      });
    } catch (error) {
      // Error verifying email and setting password
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }
);

// GET /api/auth/check-verification-token - Check token validity and password requirement
router.get('/check-verification-token/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Find user with matching verification token
    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() },
    });

    if (!user) {
      // Check if token exists but is expired
      const expiredUser = await User.findOne({
        emailVerificationToken: token,
      });
      if (expiredUser) {
        return res.status(400).json({
          success: false,
          message: 'Verification link has expired.',
          expired: true,
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Invalid verification token',
        expired: false,
      });
    }

    const responseData = {
      email: user.email,
      name: user.name,
      verified: user.verified,
      passwordSet: user.passwordSet,
      requiresPasswordSetup: !user.passwordSet && !user.password,
    };

    res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

// POST /api/auth/resend-verification - Resend verification email
router.post(
  '/resend-verification',
  authenticateToken,
  [body('userId').isMongoId().withMessage('Valid user ID required')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { userId } = req.body;

      // Check permissions
      const hasPermission = checkPermission(
        req.userPermissions.permissions,
        'users.update'
      );

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to resend verification emails',
        });
      }

      const user = await User.findById(userId)
        .populate('unionAssignments.role conferenceAssignments.role churchAssignments.role');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      if (user.verified) {
        return res.status(400).json({
          success: false,
          message: 'User is already verified',
        });
      }

      // Generate new verification token
      const verificationToken = emailService.generateVerificationToken();
      const expirationTime = emailService.getExpirationTime();

      user.emailVerificationToken = verificationToken;
      user.emailVerificationExpires = expirationTime;
      await user.save();

      // Get role name for email
      const userWithDetails = {
        ...user.toObject(),
        roleName: user.organizations[0]?.role?.displayName,
      };

      // Send verification email
      await emailService.sendVerificationEmail(
        userWithDetails,
        verificationToken
      );

      res.json({
        success: true,
        message: 'Verification email resent successfully',
      });
    } catch (error) {
      // Error resending verification email
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }
);

// POST /api/auth/signin - Login
router.post(
  '/signin',
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
          err: 'Invalid input data',
        });
      }

      const { email, password } = req.body;

      // Find user and populate role data
      const user = await User.findOne({ email, isActive: true })
        .populate('unionAssignments.role conferenceAssignments.role churchAssignments.role');

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials',
          err: 'User not found or inactive',
        });
      }

      // Check if user has set up their password
      if (!user.password) {
        return res.status(400).json({
          success: false,
          message:
            'Please complete your account setup by setting a password first. Check your email for the verification link.',
          err: 'Password not set',
        });
      }

      // Check password
      const isValidPassword = await user.comparePassword(password);
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials',
          err: 'Incorrect password',
        });
      }

      // Generate JWT token using token service
      const token = tokenService.generateSingleToken(user);

      // Get permissions for primary organization (if exists)
      let permissions = [];
      let role = null;

      // Check if user is a super admin (by isSuperAdmin flag)
      if (user.isSuperAdmin === true) {
        // Super admins get wildcard permissions regardless of organization assignments
        permissions = ['*'];
        role = {
          id: 'super_admin',
          name: 'super_admin',
          displayName: 'Super Administrator',
          level: 'system',
        };
      } else if (user.organizations.length > 0) {
        // Get the first organization assignment since we no longer have primaryOrganization
        const primaryOrgAssignment = user.organizations[0];

        if (primaryOrgAssignment && primaryOrgAssignment.role) {
          permissions = primaryOrgAssignment.role.permissions || [];
          role = {
            id: primaryOrgAssignment.role._id,
            name: primaryOrgAssignment.role.name,
            displayName: primaryOrgAssignment.role.displayName,
            level: primaryOrgAssignment.role.level,
          };
        }
      }

      // Prepare user data for response
      // Combine all hierarchical assignments
      const allAssignments = [
        ...(user.unionAssignments || []),
        ...(user.conferenceAssignments || []),
        ...(user.churchAssignments || [])
      ];

      const userData = {
        id: user._id,
        name: user.name,
        email: user.email,
        verified: user.verified,
        avatar: user.avatar,
        organizations: allAssignments
          .filter((org) => org.role)
          .map((org) => ({
            role: {
              _id: org.role._id,
              name: org.role.name,
              displayName: org.role.displayName,
              level: org.role.level,
            },
            assignedAt: org.assignedAt,
          })),
      };

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: userData,
          token,
          permissions,
          role,
        },
      });
    } catch (error) {
      // Login error
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        err: error.message,
      });
    }
  }
);

// GET /api/auth/is-auth - Verify authentication
router.get('/is-auth', authenticateToken, async (req, res) => {
  try {
    const user = req.user;

    // Get permissions for primary organization (if exists)
    let permissions = [];
    let role = null;

    // Check if user is a super admin (by isSuperAdmin flag or specific email/property)
    if (user.isSuperAdmin === true || user.email === 'superadmin@acs.org') {
      // Super admins get wildcard permissions regardless of organization assignments
      permissions = ['*'];
      role = {
        id: 'super_admin',
        name: 'super_admin',
        displayName: 'Super Administrator',
        level: 'system',
      };
    } else if (user.organizations.length > 0) {
      // Get the first organization assignment since we no longer have primaryOrganization
      const primaryOrgAssignment = user.organizations[0];

      if (primaryOrgAssignment && primaryOrgAssignment.role) {
        permissions = primaryOrgAssignment.role.permissions || [];
        role = {
          id: primaryOrgAssignment.role._id,
          name: primaryOrgAssignment.role.name,
          displayName: primaryOrgAssignment.role.displayName,
          level: primaryOrgAssignment.role.level,
        };
      }
    }

    // Prepare user data for response (without sensitive information)
    // Combine all hierarchical assignments
    const allAssignments = [
      ...(user.unionAssignments || []),
      ...(user.conferenceAssignments || []),
      ...(user.churchAssignments || [])
    ];

    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      verified: user.verified,
      avatar: user.avatar,
      organizations: allAssignments
        .filter((org) => org.role)
        .map((org) => ({
          role: {
            _id: org.role._id,
            name: org.role.name,
            displayName: org.role.displayName,
            level: org.role.level,
          },
          assignedAt: org.assignedAt,
        })),
    };

    res.json({
      success: true,
      data: {
        user: userData,
        permissions,
        role,
      },
    });
  } catch (error) {
    // Auth verification error
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      err: error.message,
    });
  }
});

// POST /api/auth/register - Register new user (for development)
router.post(
  '/register',
  [
    body('name')
      .trim()
      .isLength({ min: 2 })
      .withMessage('Name must be at least 2 characters'),
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { name, email, password } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'User already exists',
          err: 'Email already registered',
        });
      }

      // Create new user
      const user = new User({
        name,
        email,
        password,
        verified: process.env.NODE_ENV === 'development', // Auto-verify in development
      });

      await user.save();

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          id: user._id,
          name: user.name,
          email: user.email,
          verified: user.verified,
        },
      });
    } catch (error) {
      // Registration error
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        err: error.message,
      });
    }
  }
);

// POST /api/auth/forgot-password - Request password reset
router.post(
  '/forgot-password',
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { email } = req.body;

      // Find user by email
      const user = await User.findOne({ email, isActive: true });

      if (!user) {
        // Don't reveal if user exists or not for security
        return res.status(200).json({
          success: true,
          message:
            'If an account with that email exists, a password reset link has been sent.',
        });
      }

      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenHash = crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');

      // Set reset token and expiration (1 hour)
      user.resetPasswordToken = resetTokenHash;
      user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hour
      await user.save();

      // Send password reset email
      try {
        await emailService.sendPasswordResetEmail(email, resetToken);
      } catch (emailError) {
        // Failed to send password reset email
        // Don't reveal email sending failure to user for security
      }

      res.status(200).json({
        success: true,
        message:
          'If an account with that email exists, a password reset link has been sent.',
      });
    } catch (error) {
      // Forgot password error
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        err: error.message,
      });
    }
  }
);

// POST /api/auth/reset-password - Reset password with token
router.post(
  '/reset-password',
  [
    body('token').notEmpty().withMessage('Reset token is required'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { token, password } = req.body;

      // Hash the provided token to compare with stored hash
      const resetTokenHash = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');

      // Find user with valid reset token
      const user = await User.findOne({
        resetPasswordToken: resetTokenHash,
        resetPasswordExpires: { $gt: Date.now() },
        isActive: true,
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired reset token',
        });
      }

      // Update password and clear reset token fields
      user.password = password;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();

      res.status(200).json({
        success: true,
        message: 'Password has been reset successfully',
      });
    } catch (error) {
      // Reset password error
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        err: error.message,
      });
    }
  }
);

// POST /api/auth/logout - Logout and invalidate token
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // Blacklist the current token
    await tokenService.blacklistToken(req.token);

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    // Even if blacklisting fails, we should return success
    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  }
});

// POST /api/auth/refresh - Refresh access token
router.post(
  '/refresh',
  [body('refreshToken').notEmpty().withMessage('Refresh token is required')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { refreshToken } = req.body;
      const result = await tokenService.refreshAccessToken(refreshToken);

      if (!result.success) {
        return res.status(401).json({
          success: false,
          message: result.error || 'Invalid refresh token',
        });
      }

      res.json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          accessToken: result.accessToken,
          accessTokenExpiry: result.accessTokenExpiry,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        err: error.message,
      });
    }
  }
);

// GET /api/auth/is-auth-hierarchical - Verify authentication with hierarchical data
router.get('/is-auth-hierarchical', authenticateToken, async (req, res) => {
  try {
    const hierarchicalAuthService = require('../services/hierarchicalAuthService');
    const user = req.user;

    // Get user's highest level in hierarchy
    const hierarchyLevel = await hierarchicalAuthService.getUserHighestLevel(user);
    
    // Get user's hierarchy path
    const hierarchyPath = await hierarchicalAuthService.getUserHierarchyPath(user);
    
    // Get levels this user can manage
    const managedLevels = await hierarchicalAuthService.getUserManagedLevels(user);

    // Get permissions based on hierarchy level
    let permissions = [];
    let role = null;

    if (hierarchyLevel === 0) { // Super Admin
      permissions = ['*'];
      role = {
        id: 'super_admin',
        name: 'super_admin',
        displayName: 'Super Administrator',
        level: 'system',
        hierarchyLevel: 0
      };
    } else if (user.organizations.length > 0) {
      // Get the first organization assignment since we no longer have primaryOrganization
      const primaryOrgAssignment = user.organizations[0];

      if (primaryOrgAssignment && primaryOrgAssignment.role) {
        permissions = primaryOrgAssignment.role.permissions || [];
        role = {
          id: primaryOrgAssignment.role._id,
          name: primaryOrgAssignment.role.name,
          displayName: primaryOrgAssignment.role.displayName,
          level: primaryOrgAssignment.role.level,
          hierarchyLevel: primaryOrgAssignment.role.hierarchyLevel || 4
        };
      }
    }

    // Prepare user data for response
    // Combine all hierarchical assignments
    const allAssignments = [
      ...(user.unionAssignments || []),
      ...(user.conferenceAssignments || []),
      ...(user.churchAssignments || [])
    ];

    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      verified: user.verified,
      avatar: user.avatar,
      organizations: allAssignments
        .filter((org) => org.role)
        .map((org) => ({
          role: {
            _id: org.role._id,
            name: org.role.name,
            displayName: org.role.displayName,
            level: org.role.level,
            hierarchyLevel: org.role.hierarchyLevel,
            canManage: org.role.canManage
          },
          assignedAt: org.assignedAt,
        })),
      teamAssignments: user.teamAssignments || [],
      primaryTeam: user.primaryTeam
    };

    res.json({
      success: true,
      data: {
        user: userData,
        permissions,
        role,
        hierarchyLevel,
        hierarchyPath,
        managedLevels
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Hierarchical authentication verification failed',
      err: error.message,
    });
  }
});

// POST /api/auth/validate-org-access - Validate organization access
router.post(
  '/validate-org-access',
  authenticateToken,
  [
    body('organizationId')
      .isMongoId()
      .withMessage('Valid organization ID required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { organizationId } = req.body;
      const authorizationService = require('../services/authorizationService');

      const hasAccess = await authorizationService.validateOrganizationAccess(
        req.user,
        organizationId
      );

      res.json({
        success: true,
        hasAccess,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        err: error.message,
      });
    }
  }
);

module.exports = router;
