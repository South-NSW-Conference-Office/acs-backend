const {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const sharp = require('sharp');
const crypto = require('crypto');
const path = require('path');

class StorageService {
  constructor() {
    this.client = new S3Client({
      endpoint: process.env.WASABI_ENDPOINT,
      region: process.env.WASABI_REGION,
      credentials: {
        accessKeyId: process.env.WASABI_ACCESS_KEY_ID,
        secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY,
      },
      forcePathStyle: process.env.WASABI_FORCE_PATH_STYLE === 'true',
    });

    this.bucket = process.env.WASABI_BUCKET;
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
      // Thumbnails: 300x200 with cover
      processor = processor.resize(300, 200, {
        fit: 'cover',
        position: 'center',
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

    return processor.toFormat(format, { quality }).toBuffer();
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
      generateThumbnail = false,
    } = options;

    try {
      // Process main image
      const processedBuffer = await this.processImage(buffer, { type });
      const fileName = this.generateFileName(
        originalName,
        `services/${serviceId}/${type}/`
      );

      // Upload main image
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

      const result = {
        key: fileName,
        url: `${process.env.WASABI_ENDPOINT}/${this.bucket}/${fileName}`,
        size: processedBuffer.length,
        type: 'image/webp',
      };

      // Generate thumbnail if requested
      if (generateThumbnail && type === 'gallery') {
        const thumbnailBuffer = await this.processImage(buffer, {
          type: 'thumbnail',
        });
        const thumbnailName = this.generateFileName(
          originalName,
          `services/${serviceId}/thumbnails/`
        );

        const thumbnailUpload = new Upload({
          client: this.client,
          params: {
            Bucket: this.bucket,
            Key: thumbnailName,
            Body: thumbnailBuffer,
            ContentType: 'image/webp',
            CacheControl: 'max-age=31536000',
          },
        });

        await thumbnailUpload.done();

        result.thumbnail = {
          key: thumbnailName,
          url: `${process.env.WASABI_ENDPOINT}/${this.bucket}/${thumbnailName}`,
        };
      }

      return result;
    } catch (error) {
      throw new Error(`Failed to upload image: ${error.message}`);
    }
  }

  /**
   * Delete image from Wasabi
   * @param {string} key - S3 object key
   * @returns {Promise<void>}
   */
  async deleteImage(key) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.client.send(command);
    } catch (error) {
      throw new Error(`Failed to delete image: ${error.message}`);
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
