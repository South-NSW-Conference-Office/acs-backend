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
        rejectUnauthorized: false,
      },
    });
  }

  async sendPasswordResetEmail(userEmail, resetToken) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

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
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    const expirationTime = this.getExpirationTime();
    const expirationHours = Math.round(
      (expirationTime - Date.now()) / (1000 * 60 * 60)
    );

    // Check if user needs to set up password
    const needsPasswordSetup = !user.passwordSet;
    const actionText = needsPasswordSetup
      ? 'verify your email address and set up your password'
      : 'verify your email address';

    const mailOptions = {
      from:
        process.env.EMAIL_FROM ||
        '"Adventist Community Services Australia" <noreply@acs.org.au>',
      to: user.email,
      subject: 'Email Verification - Adventist Community Services Australia',
      text: `
WELCOME TO ADVENTIST COMMUNITY SERVICES AUSTRALIA

Hello ${user.name},

You have been added to the Adventist Community Services Australia system. To complete your registration and access your account, please ${actionText}.

${needsPasswordSetup ? 'VERIFICATION AND PASSWORD SETUP REQUIRED' : 'VERIFICATION REQUIRED'}
Click the link below to ${actionText}:
${verificationUrl}

${
  needsPasswordSetup
    ? `
IMPORTANT: During verification, you will be asked to set up your password to complete your account setup. Please choose a secure password that is at least 6 characters long.
`
    : ''
}
IMPORTANT DEADLINE
This verification link will expire in ${expirationHours} hours (${expirationTime.toLocaleDateString(
        'en-AU',
        {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Australia/Sydney',
        }
      )} AEDT).

If you do not ${actionText} within this timeframe, you will need to contact your administrator to resend the verification email.

ACCOUNT DETAILS
Email: ${user.email}
Organization: ${user.organizationName || 'To be assigned'}
Role: ${user.roleName || 'To be assigned'}

If you did not expect this email or have any questions, please contact your system administrator.

Best regards,
Adventist Community Services Australia

---
This is an automated message. Please do not reply to this email.
      `.trim(),
    };

    await this.transporter.sendMail(mailOptions);
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
          <p>You can log in at: <a href="${process.env.FRONTEND_URL}/login">${process.env.FRONTEND_URL}/login</a></p>

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

You can log in at: ${process.env.FRONTEND_URL}/login

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

  // Send organization setup invitation email
  async sendOrganizationSetupInvitation(user, organization, invitedBy) {
    const verificationToken = user.emailVerificationToken;
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
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
