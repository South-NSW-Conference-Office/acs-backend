const nodemailer = require('nodemailer');

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
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/reset-password?token=${resetToken}`;

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
          <h2>Password Reset Request</h2>
          
          <p>Hello,</p>
          
          <p>We received a request to reset your password for your Adventist Community Services admin account.</p>
          
          <p>If you made this request, click the link below to reset your password:</p>
          
          <p><a href="${resetUrl}">Reset Password</a></p>
          
          <p>Or copy and paste this link into your browser:</p>
          <p>${resetUrl}</p>
          
          <p><strong>Important:</strong> This link will expire in 1 hour for security reasons.</p>
          
          <p>If you didn't request a password reset, please ignore this email. Your password will remain unchanged.</p>
          
          <p>For security reasons, if you continue to receive these emails without requesting them, please contact our support team immediately.</p>
          
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
      console.log('Password reset email sent:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Error sending password reset email:', error);
      throw new Error('Failed to send password reset email');
    }
  }

  async verifyConnection() {
    try {
      await this.transporter.verify();
      console.log('Email service is ready to send emails');
      return true;
    } catch (error) {
      console.error('Email service connection failed:', error);
      return false;
    }
  }
}

module.exports = new EmailService();
