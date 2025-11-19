const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * Token Service
 * Handles JWT token generation, validation, and blacklisting
 * Follows Single Responsibility Principle
 */
class TokenService {
  constructor() {
    // In-memory store for blacklisted tokens
    // In production, use Redis or similar persistent cache
    this.blacklistedTokens = new Map();

    // Clean up expired tokens every hour
    setInterval(() => this.cleanupExpiredTokens(), 3600000);
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
        process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
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
   * Blacklist a token
   * @param {String} token - Token to blacklist
   * @returns {Promise<void>}
   */
  async blacklistToken(token) {
    try {
      const decoded = jwt.decode(token);
      if (!decoded || !decoded.exp) return;

      const expiry = decoded.exp * 1000; // Convert to milliseconds
      const tokenId = decoded.tokenId;

      // Store token ID with expiry time
      if (tokenId) {
        this.blacklistedTokens.set(tokenId, expiry);
      }

      // Also store the full token hash for backward compatibility
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      this.blacklistedTokens.set(tokenHash, expiry);
    } catch (error) {
      // Error blacklisting token
    }
  }

  /**
   * Check if a token is blacklisted
   * @param {String} token - Token to check
   * @returns {Promise<Boolean>} - True if blacklisted
   */
  async isBlacklisted(token) {
    try {
      const decoded = jwt.decode(token);
      if (!decoded) return false;

      // Check by token ID
      if (decoded.tokenId && this.blacklistedTokens.has(decoded.tokenId)) {
        return true;
      }

      // Check by token hash
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      return this.blacklistedTokens.has(tokenHash);
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
    // In a production system, this would require storing user-token mappings
    // For now, this is a placeholder for the interface
    // Revoking all tokens for user
    // Implementation would involve:
    // 1. Query all active tokens for the user
    // 2. Add each token to the blacklist
  }

  /**
   * Clean up expired tokens from blacklist
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
      return jwt.verify(token, secret);
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
