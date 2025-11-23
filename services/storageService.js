const {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const sharp = require('sharp');
const crypto = require('crypto');
const path = require('path');

// Import MediaFile model for tracking uploads
let MediaFile;
try {
  MediaFile = require('../models/MediaFile');
} catch (error) {
  // Model might not be available during initialization
  // MediaFile model not available during StorageService initialization
}

class StorageService {
  constructor() {
    // Ensure environment variables are loaded
    require('dotenv').config();

    // Enhanced configuration for Wasabi compatibility
    const region = process.env.WASABI_REGION || 'ap-southeast-2';
    const s3Config = {
      endpoint: process.env.WASABI_ENDPOINT,
      region: region, // Explicitly set as string
      credentials: {
        accessKeyId: process.env.WASABI_ACCESS_KEY_ID,
        secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY,
      },
      forcePathStyle: process.env.WASABI_FORCE_PATH_STYLE === 'true',
      // Additional configuration for Wasabi compatibility
      maxAttempts: parseInt(process.env.WASABI_MAX_RETRIES) || 3,
      requestTimeout: parseInt(process.env.WASABI_TIMEOUT) || 30000,
    };

    // Debug logging for development
    if (process.env.NODE_ENV === 'development') {
      // Debug logging for StorageService config in development
    }

    // Create S3Client with explicit configuration
    try {
      this.client = new S3Client(s3Config);
      this.bucket = process.env.WASABI_BUCKET;

      // Test client configuration
      if (process.env.NODE_ENV === 'development') {
        // S3Client created successfully
      }
    } catch (error) {
      // Failed to create S3Client
      throw new Error('Storage service initialization failed');
    }
  }

  /**
   * Generate a unique filename with proper extension
   * @param {string} originalName - Original filename
   * @param {string} prefix - Prefix for the file path
   * @returns {string} Unique filename
   */
  generateFileName(originalName, prefix = '') {
    const ext = path.extname(originalName).toLowerCase();
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `${prefix}${timestamp}-${random}${ext}`;
  }

  /**
   * Process and optimize image based on type
   * @param {Buffer} buffer - Image buffer
   * @param {Object} options - Processing options
   * @returns {Promise<Buffer>} Processed image buffer
   */
  async processImage(buffer, options = {}) {
    const { type = 'gallery', quality = 85 } = options;

    let processor = sharp(buffer);

    // Get image metadata
    const metadata = await processor.metadata();

    // Process based on type
    if (type === 'banner') {
      // Banner images: 1200x400 with center crop
      processor = processor.resize(1200, 400, {
        fit: 'cover',
        position: 'center',
      });
    } else if (type === 'gallery') {
      // Gallery images: max 1600px width/height maintaining aspect ratio
      const maxDimension = 1600;
      if (metadata.width > maxDimension || metadata.height > maxDimension) {
        processor = processor.resize(maxDimension, maxDimension, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }
    } else if (type === 'thumbnail') {
      // Thumbnails: 96x96 for crisp display at 48x48 (2x pixel density)
      processor = processor.resize(96, 96, {
        fit: 'cover',
        position: 'center',
        kernel: 'lanczos3', // Better downscaling algorithm
      });
    } else if (type === 'avatar') {
      // Avatars: 400x400 with cover
      processor = processor.resize(400, 400, {
        fit: 'cover',
        position: 'center',
      });
    }

    // Convert to WebP with fallback to JPEG for compatibility
    const format =
      metadata.format === 'png' && metadata.pages > 1 ? 'png' : 'webp';

    return processor
      .sharpen({ sigma: 0.5, flat: 1, jagged: 2 }) // Add sharpening for crisp thumbnails
      .toFormat(format, { quality })
      .toBuffer();
  }

  /**
   * Create MediaFile record for tracking uploads
   * @param {Object} uploadResult - Result from file upload
   * @param {Object} options - Upload options including user info
   * @returns {Promise<Object>} MediaFile document
   */
  async createMediaFileRecord(uploadResult, options = {}) {
    if (!MediaFile) {
      MediaFile = require('../models/MediaFile');
    }

    const {
      originalName,
      type = 'gallery',
      entityType,
      entityId,
      uploadedBy,
      alt = '',
      caption = '',
      mimeType = 'image/webp',
      dimensions = {},
      userAgent,
      uploadedFrom,
    } = options;

    try {
      const mediaFile = new MediaFile({
        originalName,
        fileName: path.basename(uploadResult.key),
        key: uploadResult.key,
        url: uploadResult.url,
        mimeType,
        size: uploadResult.size,
        dimensions,
        type,
        category: entityType || 'general',
        uploadedBy,
        entityType,
        entityId,
        alt,
        caption,
        thumbnail: uploadResult.thumbnail
          ? {
              key: uploadResult.thumbnail.key,
              url: uploadResult.thumbnail.url,
              size: uploadResult.thumbnail.size || 0,
            }
          : undefined,
        metadata: {
          uploadedFrom,
          userAgent,
          processedAt: new Date(),
        },
      });

      return await mediaFile.save();
    } catch (error) {
      // Error creating MediaFile record
      // Don't fail the upload if database tracking fails
      return null;
    }
  }

  /**
   * Test bucket accessibility and credentials
   * @returns {Promise<Object>} Test result
   */
  async testBucketAccess() {
    try {
      // Testing bucket access

      // First try HeadBucket to check if bucket exists and is accessible
      const headCommand = new HeadBucketCommand({ Bucket: this.bucket });
      await this.client.send(headCommand);
      // Bucket exists and is accessible

      // Then try to list objects (requires read permission)
      const listCommand = new ListObjectsV2Command({
        Bucket: this.bucket,
        MaxKeys: 1,
      });
      await this.client.send(listCommand);
      // Read permission confirmed

      return { success: true, message: 'Bucket access test passed' };
    } catch (error) {
      // Bucket access test failed
      return { success: false, error: error.message, code: error.code };
    }
  }

  /**
   * Upload image to Wasabi with processing and tracking
   * @param {Buffer} buffer - Image buffer
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result with URLs and MediaFile
   */
  async uploadImageWithTracking(buffer, options = {}) {
    const uploadResult = await this.uploadImage(buffer, options);

    // Create MediaFile record if user info is provided
    if (options.uploadedBy) {
      const mediaFile = await this.createMediaFileRecord(uploadResult, options);
      if (mediaFile) {
        uploadResult.mediaFileId = mediaFile._id;
        uploadResult.mediaFile = mediaFile;
      }
    }

    return uploadResult;
  }

  /**
   * Upload image to Wasabi with processing
   * @param {Buffer} buffer - Image buffer
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result with URLs
   */
  async uploadImage(buffer, options = {}) {
    const {
      originalName = 'image.jpg',
      type = 'gallery',
      serviceId,
      entityType = 'service',
      entityId,
      generateThumbnail = false,
    } = options;

    try {
      // Get original image dimensions before processing
      const originalDimensions = await this.getImageDimensions(buffer);

      // Process main image
      const processedBuffer = await this.processImage(buffer, { type });

      // Generate path based on entity type
      let pathPrefix = 'general/';
      if (entityId) {
        pathPrefix = `${entityType}/${entityId}/${type}/`;
      } else if (serviceId) {
        // Backward compatibility
        pathPrefix = `services/${serviceId}/${type}/`;
      }

      const fileName = this.generateFileName(originalName, pathPrefix);

      // Debug logging for development
      if (process.env.NODE_ENV === 'development') {
        // Upload attempt debug info
      }

      // Upload main image using PutObjectCommand (more reliable with Wasabi)
      const uploadParams = {
        Bucket: this.bucket,
        Key: fileName,
        Body: processedBuffer,
        ContentType: 'image/webp',
        CacheControl: 'max-age=31536000', // 1 year cache
      };

      if (process.env.NODE_ENV === 'development') {
        // Attempting upload with PutObjectCommand
      }

      const putCommand = new PutObjectCommand(uploadParams);
      await this.client.send(putCommand);

      const result = {
        key: fileName,
        url: `${process.env.WASABI_ENDPOINT}/${this.bucket}/${fileName}`,
        size: processedBuffer.length,
        type: 'image/webp',
        originalDimensions,
        dimensions: await this.getImageDimensions(processedBuffer),
      };

      // Generate thumbnail if requested
      if (generateThumbnail && type === 'gallery') {
        const thumbnailBuffer = await this.processImage(buffer, {
          type: 'thumbnail',
        });

        // Use same path structure for thumbnails
        let thumbnailPrefix = 'general/thumbnails/';
        if (entityId) {
          thumbnailPrefix = `${entityType}/${entityId}/thumbnails/`;
        } else if (serviceId) {
          thumbnailPrefix = `services/${serviceId}/thumbnails/`;
        }

        const thumbnailName = this.generateFileName(
          originalName,
          thumbnailPrefix
        );

        // Upload thumbnail using PutObjectCommand
        const thumbnailPutCommand = new PutObjectCommand({
          Bucket: this.bucket,
          Key: thumbnailName,
          Body: thumbnailBuffer,
          ContentType: 'image/webp',
          CacheControl: 'max-age=31536000',
        });

        await this.client.send(thumbnailPutCommand);

        result.thumbnail = {
          key: thumbnailName,
          url: `${process.env.WASABI_ENDPOINT}/${this.bucket}/${thumbnailName}`,
          size: thumbnailBuffer.length,
        };
      }

      return result;
    } catch (error) {
      // Upload error details logged
      throw new Error(`Failed to upload image: ${error.message}`);
    }
  }

  /**
   * Delete image from Wasabi and MediaFile record
   * @param {string} key - S3 object key
   * @param {boolean} deleteRecord - Whether to delete MediaFile record
   * @returns {Promise<void>}
   */
  async deleteImage(key, deleteRecord = false) {
    try {
      // Delete from storage
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.client.send(command);

      // Delete MediaFile record if requested
      if (deleteRecord && MediaFile) {
        await MediaFile.deleteOne({ key });
      }
    } catch (error) {
      throw new Error(`Failed to delete image: ${error.message}`);
    }
  }

  /**
   * Delete MediaFile and associated storage files
   * @param {string} mediaFileId - MediaFile document ID
   * @param {string} userId - User ID for permission check
   * @returns {Promise<boolean>} Success status
   */
  async deleteMediaFile(mediaFileId, userId) {
    if (!MediaFile) {
      MediaFile = require('../models/MediaFile');
    }

    const mediaFile = await MediaFile.findById(mediaFileId);

    if (!mediaFile) {
      throw new Error('MediaFile not found');
    }

    // Check ownership (users can only delete their own files)
    if (mediaFile.uploadedBy.toString() !== userId) {
      throw new Error('Permission denied: You can only delete your own files');
    }

    // Delete storage files
    if (mediaFile.key) {
      await this.deleteImage(mediaFile.key, false);
    }

    if (mediaFile.thumbnail && mediaFile.thumbnail.key) {
      await this.deleteImage(mediaFile.thumbnail.key, false);
    }

    // Delete database record
    await MediaFile.deleteOne({ _id: mediaFileId });

    return true;
  }

  /**
   * Get image dimensions from buffer
   * @param {Buffer} buffer - Image buffer
   * @returns {Promise<Object>} Dimensions object
   */
  async getImageDimensions(buffer) {
    try {
      const metadata = await sharp(buffer).metadata();
      return {
        width: metadata.width,
        height: metadata.height,
      };
    } catch (error) {
      // Error getting image dimensions
      return { width: 0, height: 0 };
    }
  }

  /**
   * Delete multiple images
   * @param {string[]} keys - Array of S3 object keys
   * @returns {Promise<void>}
   */
  async deleteImages(keys) {
    const deletePromises = keys.map((key) => this.deleteImage(key));
    await Promise.all(deletePromises);
  }

  /**
   * Generate a presigned URL for secure access
   * @param {string} key - S3 object key
   * @param {number} expiresIn - URL expiration in seconds
   * @returns {Promise<string>} Presigned URL
   */
  async getPresignedUrl(key, expiresIn = 3600) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      return await getSignedUrl(this.client, command, { expiresIn });
    } catch (error) {
      throw new Error(`Failed to generate presigned URL: ${error.message}`);
    }
  }

  /**
   * Upload profile avatar with processing
   * @param {Object} file - Multer file object
   * @param {string} userId - User ID for folder organization
   * @returns {Promise<Object>} Upload result with URLs
   */
  async uploadProfileAvatar(file, userId) {
    try {
      // Process avatar image (400x400)
      const processedBuffer = await this.processImage(file.buffer, {
        type: 'avatar',
      });
      const fileName = this.generateFileName(
        file.originalname,
        `users/${userId}/avatar/`
      );

      // Upload avatar image
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.bucket,
          Key: fileName,
          Body: processedBuffer,
          ContentType: 'image/webp',
          CacheControl: 'max-age=31536000', // 1 year cache
        },
      });

      await upload.done();

      return {
        key: fileName,
        url: `${process.env.WASABI_ENDPOINT}/${this.bucket}/${fileName}`,
        size: processedBuffer.length,
        type: 'image/webp',
      };
    } catch (error) {
      throw new Error(`Failed to upload profile avatar: ${error.message}`);
    }
  }

  /**
   * Delete file from Wasabi (alias for deleteImage for consistency)
   * @param {string} key - S3 object key
   * @returns {Promise<void>}
   */
  async deleteFile(key) {
    return this.deleteImage(key);
  }

  /**
   * Validate image file
   * @param {Object} file - Multer file object
   * @returns {Object} Validation result
   */
  validateImage(file) {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const maxSize = 10 * 1024 * 1024; // 10MB

    if (!allowedMimeTypes.includes(file.mimetype)) {
      return {
        valid: false,
        error:
          'Invalid file type. Only JPEG, PNG, and WebP images are allowed.',
      };
    }

    if (file.size > maxSize) {
      return {
        valid: false,
        error: 'File too large. Maximum size is 10MB.',
      };
    }

    return { valid: true };
  }
}

module.exports = new StorageService();
