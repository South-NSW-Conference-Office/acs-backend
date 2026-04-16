/* eslint-disable no-console */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const BlacklistedToken = require('../models/BlacklistedToken');

/**
 * Token Service
 * Handles JWT token generation, validation, and blacklisting
 * Follows Single Responsibility Principle
 *
 * Blacklisted tokens are persisted to MongoDB (survives restarts, works across
 * PM2 cluster instances) and cached in an in-memory Map for fast lookups.
 */
class TokenService {
  constructor() {
    // Warn if JWT_REFRESH_SECRET is not set
    if (!process.env.JWT_REFRESH_SECRET) {
      console.warn(
        'WARNING: JWT_REFRESH_SECRET not set. Using JWT_SECRET as fallback. Set JWT_REFRESH_SECRET in production.'
      );
    }

    // In-memory cache for blacklisted tokens (fast path)
    // Backed by MongoDB for persistence and cross-instance consistency
    this.blacklistedTokens = new Map();

    // Clean up expired tokens from the in-memory cache every hour.
    // .unref() so the interval doesn't keep Node alive by itself.
    setInterval(() => this.cleanupExpiredTokens(), 3600000).unref();
  }

  /**
   * Generate access and refresh tokens
   * @param {Object} user - User object
   * @returns {Object} - Access and refresh tokens with expiry info
   */
  generateTokens(user) {
    const payload = {
      userId: user._id,
      email: user.email,
      tokenId: crypto.randomBytes(16).toString('hex'), // Unique token ID for blacklisting
    };

    // Short-lived access token (15 minutes)
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '15m',
    });

    // Long-lived refresh token (7 days)
    const refreshToken = jwt.sign(
      { ...payload, type: 'refresh' },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return {
      accessToken,
      refreshToken,
      accessTokenExpiry: new Date(Date.now() + 15 * 60 * 1000),
      refreshTokenExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };
  }

  /**
   * Generate a single token (backward compatibility)
   * @param {Object} user - User object
   * @returns {String} - JWT token
   */
  generateSingleToken(user) {
    const payload = {
      userId: user._id,
      email: user.email,
      tokenId: crypto.randomBytes(16).toString('hex'),
    };

    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
  }

  /**
   * Refresh access token using refresh token
   * @param {String} refreshToken - Refresh token
   * @returns {Promise<Object>} - New access token or error
   */
  async refreshAccessToken(refreshToken) {
    try {
      const decoded = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
        { algorithms: ['HS256'] }
      );

      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      // Check if refresh token is blacklisted
      if (await this.isBlacklisted(refreshToken)) {
        throw new Error('Token has been revoked');
      }

      // Generate new access token
      const payload = {
        userId: decoded.userId,
        email: decoded.email,
        tokenId: crypto.randomBytes(16).toString('hex'),
      };

      const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: '15m',
      });

      return {
        success: true,
        accessToken,
        accessTokenExpiry: new Date(Date.now() + 15 * 60 * 1000),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Blacklist a token (persists to both in-memory cache and MongoDB)
   * @param {String} token - Token to blacklist
   * @param {String} [reason='logout'] - Reason for blacklisting
   * @returns {Promise<void>}
   */
  async blacklistToken(token, reason = 'logout') {
    try {
      const decoded = jwt.decode(token);
      if (!decoded || !decoded.exp) return;

      const expiry = decoded.exp * 1000; // Convert to milliseconds
      const tokenId = decoded.tokenId;
      const expiresAt = new Date(expiry);

      // Store in in-memory cache (fast path)
      if (tokenId) {
        this.blacklistedTokens.set(tokenId, expiry);
      }

      // Also store the full token hash for backward compatibility
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      this.blacklistedTokens.set(tokenHash, expiry);

      // Persist to MongoDB (survives restarts, works across cluster instances)
      try {
        await BlacklistedToken.create({
          token: tokenHash,
          userId: decoded.userId || null,
          expiresAt,
          reason,
        });
      } catch (dbError) {
        // Ignore duplicate key errors (token already blacklisted)
        if (dbError.code !== 11000) {
          console.error(
            'Failed to persist blacklisted token to MongoDB:',
            dbError.message
          );
        }
      }
    } catch (error) {
      // Error blacklisting token
    }
  }

  /**
   * Check if a token is blacklisted
   * Checks in-memory cache first (fast path), then falls back to MongoDB
   * @param {String} token - Token to check
   * @returns {Promise<Boolean>} - True if blacklisted
   */
  async isBlacklisted(token) {
    try {
      const decoded = jwt.decode(token);
      if (!decoded) return false;

      // Fast path: check in-memory cache by token ID
      if (decoded.tokenId && this.blacklistedTokens.has(decoded.tokenId)) {
        return true;
      }

      // Fast path: check in-memory cache by token hash
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      if (this.blacklistedTokens.has(tokenHash)) {
        return true;
      }

      // Slow path: fall back to MongoDB query (handles cross-instance and post-restart cases)
      try {
        const found = await BlacklistedToken.findOne({
          token: tokenHash,
        }).lean();
        if (found) {
          // Populate the in-memory cache so subsequent checks are fast
          this.blacklistedTokens.set(tokenHash, found.expiresAt.getTime());
          if (decoded.tokenId) {
            this.blacklistedTokens.set(
              decoded.tokenId,
              found.expiresAt.getTime()
            );
          }
          return true;
        }
      } catch (dbError) {
        // If MongoDB is unavailable, rely on the in-memory cache result (already checked above)
        console.error(
          'Failed to query BlacklistedToken from MongoDB:',
          dbError.message
        );
      }

      return false;
    } catch (error) {
      // Error checking blacklist
      return false;
    }
  }

  /**
   * Revoke all tokens for a user
   * @param {String} userId - User ID
   * @returns {Promise<void>}
   */
  async revokeAllUserTokens() {
    // TODO: For a complete implementation, add a `tokensRevokedAt` timestamp field
    // on the User model. During token verification, compare the token's `iat` (issued at)
    // against `user.tokensRevokedAt`. If `iat < tokensRevokedAt`, reject the token.
    // This avoids needing to enumerate and individually blacklist every token for a user.
  }

  /**
   * Clean up expired tokens from the in-memory cache.
   * MongoDB cleanup is handled automatically by the TTL index on `expiresAt`.
   */
  cleanupExpiredTokens() {
    const now = Date.now();
    for (const [key, expiry] of this.blacklistedTokens.entries()) {
      if (expiry < now) {
        this.blacklistedTokens.delete(key);
      }
    }
  }

  /**
   * Verify a token and return decoded payload
   * @param {String} token - Token to verify
   * @param {String} secret - Secret key
   * @returns {Object} - Decoded token or null
   */
  verifyToken(token, secret = process.env.JWT_SECRET) {
    try {
      return jwt.verify(token, secret, { algorithms: ['HS256'] });
    } catch (error) {
      return null;
    }
  }

  /**
   * Decode a token without verification
   * @param {String} token - Token to decode
   * @returns {Object} - Decoded token or null
   */
  decodeToken(token) {
    try {
      return jwt.decode(token);
    } catch (error) {
      return null;
    }
  }
}

// Export singleton instance
module.exports = new TokenService();
