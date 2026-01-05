const express = require('express');
const { body, validationResult } = require('express-validator');
const emailService = require('../services/emailService');
const logger = require('../services/loggerService');

const router = express.Router();

// POST /api/contact/submit - Submit contact form
router.post(
  '/submit',
  [
    body('name')
      .trim()
      .isLength({ min: 2 })
      .withMessage('Name must be at least 2 characters'),
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required'),
    body('phone')
      .matches(/^[\d\s\-\+\(\)]{8,}$/)
      .withMessage('Valid phone number is required'),
    body('subject')
      .trim()
      .isLength({ min: 3 })
      .withMessage('Subject must be at least 3 characters'),
    body('message')
      .trim()
      .isLength({ min: 10 })
      .withMessage('Message must be at least 10 characters'),
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

      const { name, email, phone, subject, message } = req.body;
      const contactData = { name, email, phone, subject, message };

      // Send admin notification email
      try {
        await emailService.sendContactFormAdminNotification(contactData);
        logger.info(`Contact form admin notification sent for: ${email}`);
      } catch (emailError) {
        logger.error('Failed to send admin notification:', emailError);
        // Continue - don't block user experience if admin email fails
      }

      // Send confirmation email to user
      try {
        await emailService.sendContactFormConfirmation(email, name, 'contact', subject);
        logger.info(`Contact form confirmation sent to: ${email}`);
      } catch (emailError) {
        logger.error('Failed to send user confirmation:', emailError);
        // Continue - don't block user experience if confirmation email fails
      }

      return res.status(200).json({
        success: true,
        message: 'Your message has been sent successfully. We will get back to you soon.',
      });
    } catch (error) {
      logger.error('Contact form submission error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to submit contact form. Please try again later.',
      });
    }
  }
);

// POST /api/contact/volunteer - Submit volunteer application
router.post(
  '/volunteer',
  [
    body('name')
      .trim()
      .isLength({ min: 2 })
      .withMessage('Name must be at least 2 characters'),
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required'),
    body('phone')
      .matches(/^[\d\s\-\+\(\)]{8,}$/)
      .withMessage('Valid phone number is required'),
    body('availability')
      .isIn(['weekdays', 'weekends', 'flexible'])
      .withMessage('Valid availability is required'),
    body('interests')
      .isIn(['foodbank', 'clothing', 'counseling', 'emergency', 'admin'])
      .withMessage('Valid area of interest is required'),
    body('experience').optional().trim(),
    body('motivation')
      .trim()
      .isLength({ min: 20 })
      .withMessage('Motivation must be at least 20 characters'),
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

      const { name, email, phone, availability, interests, experience, motivation } = req.body;
      const applicationData = { name, email, phone, availability, interests, experience, motivation };

      // Send admin notification email
      try {
        await emailService.sendVolunteerApplicationAdminNotification(applicationData);
        logger.info(`Volunteer application admin notification sent for: ${email}`);
      } catch (emailError) {
        logger.error('Failed to send volunteer admin notification:', emailError);
        // Continue - don't block user experience if admin email fails
      }

      // Send confirmation email to user
      try {
        await emailService.sendContactFormConfirmation(email, name, 'volunteer');
        logger.info(`Volunteer application confirmation sent to: ${email}`);
      } catch (emailError) {
        logger.error('Failed to send volunteer confirmation:', emailError);
        // Continue - don't block user experience if confirmation email fails
      }

      return res.status(200).json({
        success: true,
        message: 'Your volunteer application has been submitted successfully. We will review it and get back to you soon.',
      });
    } catch (error) {
      logger.error('Volunteer application submission error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to submit volunteer application. Please try again later.',
      });
    }
  }
);

module.exports = router;
