const nodemailer = require('nodemailer');
const crypto = require('crypto');
const logger = require('./loggerService');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT),
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
      requireTLS: true,
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production',
      },
    });
  }

  // Get appropriate frontend URL based on environment
  getFrontendUrl() {
    const frontendUrl = process.env.FRONTEND_URL;

    // If in development and the URL contains localhost, use http instead of https
    if (
      process.env.NODE_ENV !== 'production' &&
      frontendUrl &&
      frontendUrl.includes('localhost')
    ) {
      return frontendUrl.replace('https://', 'http://');
    }

    return frontendUrl;
  }

  async sendPasswordResetEmail(userEmail, resetToken) {
    const resetUrl = `${this.getFrontendUrl()}/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
      to: userEmail,
      subject: 'Password Reset Request - Adventist Community Services',
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
          </style>
        </head>
        <body>
          <h1>Password Reset Request</h1>
          <h2>Adventist Community Services</h2>
          
          <p>Hello,</p>
          
          <p>We received a request to reset your password for your Adventist Community Services admin account.</p>
          
          <h3>Reset Your Password:</h3>
          <p>If you made this request, click the link below to reset your password:</p>
          
          <p><a href="${resetUrl}">${resetUrl}</a></p>
          
          <h3>Security Information:</h3>
          <p><strong>IMPORTANT:</strong> This link will expire in 1 hour for security reasons.</p>
          
          <p>If you didn't request a password reset, please ignore this email. Your password will remain unchanged.</p>
          
          <p><strong>Security Notice:</strong> If you continue to receive these emails without requesting them, please contact our support team immediately.</p>
          
          <p>Best regards,<br>
          Adventist Community Services Team</p>
          
          <hr>
          
          <p><small>© 2025 Adventist Community Services. All rights reserved.</small></p>
          <p><small>This email was sent to ${userEmail}</small></p>
        </body>
        </html>
      `,
      text: `
        Password Reset Request - Adventist Community Services
        
        Hello,
        
        We received a request to reset your password for your Adventist Community Services admin account.
        
        If you made this request, copy and paste this link into your browser to reset your password:
        ${resetUrl}
        
        This link will expire in 1 hour for security reasons.
        
        If you didn't request a password reset, please ignore this email. Your password will remain unchanged.
        
        Best regards,
        Adventist Community Services Team
        
        © 2025 Adventist Community Services. All rights reserved.
      `,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      // Error sending password reset email
      throw new Error('Failed to send password reset email');
    }
  }

  // Generate verification token
  generateVerificationToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Calculate expiration time
  getExpirationTime() {
    const expiryString = process.env.VERIFICATION_TOKEN_EXPIRY || '72h';
    const expiryValue = parseInt(expiryString);
    const expiryUnit = expiryString.slice(-1);

    let hours = 72; // default 72 hours

    switch (expiryUnit) {
      case 'h':
        hours = expiryValue;
        break;
      case 'd':
        hours = expiryValue * 24;
        break;
      case 'w':
        hours = expiryValue * 24 * 7;
        break;
    }

    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  // Send verification email
  async sendVerificationEmail(user, verificationToken) {
    const verificationUrl = `${this.getFrontendUrl()}/verify-email?token=${verificationToken}`;
    const expirationTime = this.getExpirationTime();
    const expirationHours = Math.round(
      (expirationTime - Date.now()) / (1000 * 60 * 60)
    );
    const expirationLabel = expirationTime.toLocaleDateString('en-AU', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Australia/Sydney',
    });

    const needsPasswordSetup = !user.passwordSet;
    const actionText = needsPasswordSetup
      ? 'verify your email address and set up your password'
      : 'verify your email address';
    const headline = needsPasswordSetup
      ? 'Set up your account'
      : 'Verify your email address';
    const buttonLabel = needsPasswordSetup ? 'Set up my account' : 'Verify my email';

    const fromName = process.env.EMAIL_FROM_NAME || 'Adventist Community Services';
    const fromAddress = process.env.EMAIL_FROM || 'noreply@acs.org.au';

    const mailOptions = {
      from: `"${fromName}" <${fromAddress}>`,
      to: user.email,
      replyTo: fromAddress,
      subject: 'Verify your email — Adventist Community Services',
      headers: {
        'X-Entity-Ref-ID': `verify-${verificationToken.slice(0, 12)}`,
      },
      html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headline}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#333;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;">${headline} — this link expires in ${expirationHours} hours.</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#F5821F;padding:24px 32px;text-align:center;color:#ffffff;">
              <h1 style="margin:0;font-size:22px;font-weight:600;">Adventist Community Services</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 16px 0;font-size:20px;color:#1a2332;">${headline}</h2>
              <p style="margin:0 0 16px 0;line-height:1.6;">Hello ${user.name},</p>
              <p style="margin:0 0 24px 0;line-height:1.6;">You have been added to the Adventist Community Services system. To finish setting up your account, please ${actionText}.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="background:#F5821F;border-radius:8px;">
                    <a href="${verificationUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;">${buttonLabel}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-size:13px;color:#666;">Or copy and paste this link into your browser:</p>
              <p style="margin:0 0 24px 0;font-size:13px;word-break:break-all;"><a href="${verificationUrl}" style="color:#1a2332;">${verificationUrl}</a></p>
              ${needsPasswordSetup ? `<p style="margin:0 0 16px 0;line-height:1.6;font-size:14px;">You will be asked to create a password during setup. Choose one with at least 8 characters including upper and lowercase letters, a number, and a special character.</p>` : ''}
              <p style="margin:0 0 24px 0;line-height:1.6;font-size:14px;"><strong>This link expires in ${expirationHours} hours</strong> (${expirationLabel} AEDT). If it expires, contact your administrator to resend.</p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
              <p style="margin:0 0 4px 0;font-size:13px;color:#666;"><strong>Account details</strong></p>
              <p style="margin:0 0 4px 0;font-size:13px;color:#666;">Email: ${user.email}</p>
              <p style="margin:0 0 4px 0;font-size:13px;color:#666;">Organization: ${user.organizationName || 'To be assigned'}</p>
              <p style="margin:0 0 16px 0;font-size:13px;color:#666;">Role: ${user.roleName || 'To be assigned'}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
              <p style="margin:0;font-size:12px;color:#999;">If you did not expect this email, please contact your system administrator.</p>
              <p style="margin:8px 0 0 0;font-size:12px;color:#999;">&copy; ${new Date().getFullYear()} Adventist Community Services. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
      text: `Adventist Community Services — ${headline}

Hello ${user.name},

You have been added to the Adventist Community Services system. To finish setting up your account, please ${actionText}.

Open this link in your browser:
${verificationUrl}

${needsPasswordSetup ? 'You will be asked to create a password during setup. Choose one with at least 8 characters including upper and lowercase letters, a number, and a special character.\n\n' : ''}This link expires in ${expirationHours} hours (${expirationLabel} AEDT). If it expires, contact your administrator to resend.

Account details:
  Email: ${user.email}
  Organization: ${user.organizationName || 'To be assigned'}
  Role: ${user.roleName || 'To be assigned'}

If you did not expect this email, please contact your system administrator.

— Adventist Community Services`,
    };

    const info = await this.transporter.sendMail(mailOptions);
    logger.info(
      `Verification email sent to ${user.email} (messageId=${info.messageId}, url=${verificationUrl})`
    );
    return { success: true, messageId: info.messageId };
  }

  // Send welcome email after verification
  async sendWelcomeEmail(user) {
    const mailOptions = {
      from:
        process.env.EMAIL_FROM ||
        '"Adventist Community Services Australia" <noreply@acs.org.au>',
      to: user.email,
      subject: 'Welcome to Adventist Community Services Australia',
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to Adventist Community Services</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
          </style>
        </head>
        <body>
          <h1>Account Verified - Welcome!</h1>
          <h2>Adventist Community Services Australia</h2>

          <p>Hello ${user.name},</p>

          <p>Your email has been successfully verified. You now have full access to the Adventist Community Services Australia system.</p>

          <h3>Next Steps:</h3>
          <p>You can log in at: <a href="${this.getFrontendUrl()}/login">${this.getFrontendUrl()}/login</a></p>

          <p>Best regards,<br>
          Adventist Community Services Australia</p>

          <hr>
          
          <p><small>© ${new Date().getFullYear()} Adventist Community Services Australia. All rights reserved.</small></p>
        </body>
        </html>
      `,
      text: `
ACCOUNT VERIFIED - WELCOME!

Hello ${user.name},

Your email has been successfully verified. You now have full access to the Adventist Community Services Australia system.

You can log in at: ${this.getFrontendUrl()}/login

Best regards,
Adventist Community Services Australia
      `.trim(),
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      // Error sending welcome email - not critical
      // Don't throw - welcome email is not critical
    }
  }

  async verifyConnection() {
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      // Email service connection failed
      return false;
    }
  }

  // Sanitize strings used in email headers to prevent header injection
  sanitizeEmailHeader(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\r\n]/g, '');
  }

  // Send contact form notification to admin
  async sendContactFormAdminNotification(contactData) {
    const { name, email, phone, subject, message } = contactData;
    const submittedDate = new Date().toLocaleDateString('en-AU', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Australia/Sydney',
    });

    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
      to: process.env.EMAIL_FROM,
      subject: `New Contact Form Submission - ${this.sanitizeEmailHeader(subject)}`,
      text: `
NEW CONTACT FORM SUBMISSION
============================

From: ${name}
Email: ${email}
Phone: ${phone}
Subject: ${subject}

Message:
---------
${message}

---
Submitted via ACS Website Contact Form
Date: ${submittedDate} AEDT
      `.trim(),
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error('Failed to send contact form admin notification:', error);
      throw new Error('Failed to send contact form notification');
    }
  }

  // Send volunteer application notification to admin
  async sendVolunteerApplicationAdminNotification(applicationData) {
    const {
      name,
      email,
      phone,
      availability,
      interests,
      experience,
      motivation,
    } = applicationData;
    const submittedDate = new Date().toLocaleDateString('en-AU', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Australia/Sydney',
    });

    // Map interest codes to readable names
    const interestMap = {
      foodbank: 'Food Bank Services',
      clothing: 'Clothing Assistance',
      counseling: 'Counseling Support',
      emergency: 'Emergency Relief',
      admin: 'Administrative Support',
    };

    // Map availability codes to readable names
    const availabilityMap = {
      weekdays: 'Weekdays',
      weekends: 'Weekends',
      flexible: 'Flexible',
    };

    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
      to: process.env.EMAIL_FROM,
      subject: `New Volunteer Application - ${this.sanitizeEmailHeader(name)}`,
      text: `
NEW VOLUNTEER APPLICATION
==========================

Applicant Details:
------------------
Name: ${name}
Email: ${email}
Phone: ${phone}

Availability: ${availabilityMap[availability] || availability}
Area of Interest: ${interestMap[interests] || interests}

Experience:
-----------
${experience || 'No experience provided'}

Motivation:
-----------
${motivation}

---
Submitted via ACS Website Volunteer Application
Date: ${submittedDate} AEDT
      `.trim(),
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error(
        'Failed to send volunteer application admin notification:',
        error
      );
      throw new Error('Failed to send volunteer application notification');
    }
  }

  // Send confirmation email to user after contact form submission
  async sendContactFormConfirmation(
    userEmail,
    userName,
    formType,
    subject = null
  ) {
    const isVolunteer = formType === 'volunteer';
    const submissionType = isVolunteer ? 'volunteer application' : 'message';
    const submittedDate = new Date().toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const subjectLine = isVolunteer
      ? 'Thank you for your volunteer application - Adventist Community Services'
      : 'Thank you for contacting us - Adventist Community Services';

    const submissionDetails = isVolunteer
      ? `- Application Type: Volunteer Application
- Submitted: ${submittedDate}`
      : `- Subject: ${subject}
- Submitted: ${submittedDate}`;

    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
      to: userEmail,
      subject: subjectLine,
      text: `
Thank you for contacting Adventist Community Services

Dear ${userName},

We have received your ${submissionType} and wanted to let you know
that our team will review it shortly.

You can expect to hear from us within 2-3 business days.
If your matter is urgent, please call our office directly.

What you submitted:
${submissionDetails}

Thank you for reaching out to us.

Warm regards,
Adventist Community Services Australia

---
This is an automated confirmation. Please do not reply to this email.
If you need to send additional information, please submit a new message
through our website or contact us directly.
      `.trim(),
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error('Failed to send contact form confirmation:', error);
      // Don't throw - user confirmation is not critical
    }
  }

  // Send organization setup invitation email
  async sendOrganizationSetupInvitation(user, organization, invitedBy) {
    const verificationToken = user.emailVerificationToken;
    const verificationUrl = `${this.getFrontendUrl()}/verify-email?token=${verificationToken}`;
    const expirationTime = user.emailVerificationExpires;
    const expirationDays = Math.round(
      (expirationTime - Date.now()) / (1000 * 60 * 60 * 24)
    );

    const mailOptions = {
      from:
        process.env.EMAIL_FROM ||
        '"Adventist Community Services Australia" <noreply@acs.org.au>',
      to: user.email,
      subject: `Admin Invitation - ${organization.name} - Adventist Community Services`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Organization Admin Invitation</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
          </style>
        </head>
        <body>
          <h1>Welcome to Adventist Community Services!</h1>
          <h2>You've been invited to be an administrator</h2>
          
          <p>Hello ${user.name},</p>
          
          <p>${invitedBy.name} has invited you to be an administrator for <strong>${organization.name}</strong>.</p>
          
          <h3>Organization Details:</h3>
          <p>
            <strong>Name:</strong> ${organization.name}<br>
            <strong>Type:</strong> ${organization.type.charAt(0).toUpperCase() + organization.type.slice(1)}<br>
            <strong>Your Role:</strong> Administrator
          </p>
          
          <h3>Administrator Privileges:</h3>
          <p>As an administrator, you will be able to:</p>
          <ul>
            <li>Manage users and their permissions</li>
            <li>Create and manage sub-organizations</li>
            <li>Access administrative features and reports</li>
            <li>Configure organization settings</li>
          </ul>
          
          <h3>Getting Started:</h3>
          <p>To set up your account, please click the following link:</p>
          
          <p><a href="${verificationUrl}">${verificationUrl}</a></p>
          
          <p><strong>IMPORTANT SECURITY NOTICE:</strong></p>
          <p>This invitation link will expire in ${expirationDays} days for security reasons. After clicking the link, you'll be asked to create a secure password for your account.</p>
          
          <p>If you have any questions or need assistance, please contact ${invitedBy.name} or your system administrator.</p>
          
          <p>Best regards,<br>
          Adventist Community Services Team</p>
          
          <hr>
          
          <p><small>© ${new Date().getFullYear()} Adventist Community Services. All rights reserved.</small></p>
          <p><small>This invitation was sent by ${invitedBy.name} (${invitedBy.email})</small></p>
        </body>
        </html>
      `,
      text: `
Welcome to Adventist Community Services!

Hello ${user.name},

${invitedBy.name} has invited you to be an administrator for ${organization.name}.

ORGANIZATION DETAILS:
- Name: ${organization.name}
- Type: ${organization.type.charAt(0).toUpperCase() + organization.type.slice(1)}
- Your Role: Administrator

As an administrator, you will be able to:
- Manage users and their permissions
- Create and manage sub-organizations
- Access administrative features and reports
- Configure organization settings

TO GET STARTED:
Click the following link to set up your account and create your password:
${verificationUrl}

IMPORTANT: This invitation link will expire in ${expirationDays} days for security reasons.

If you have any questions or need assistance, please contact ${invitedBy.name} or your system administrator.

Best regards,
Adventist Community Services Team

---
This invitation was sent by ${invitedBy.name} (${invitedBy.email})
© ${new Date().getFullYear()} Adventist Community Services. All rights reserved.
      `,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error('Failed to send organization setup invitation:', error);
      throw new Error('Failed to send invitation email');
    }
  }
}

module.exports = new EmailService();
