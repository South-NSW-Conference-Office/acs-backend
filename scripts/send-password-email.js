const path = require('path');
const dotenv = require('dotenv');
const dns = require('dns');

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const emailService = require('../services/emailService');

const recipient = process.argv[2];
const plainPassword = process.argv[3];
const recipientName = process.argv[4] || 'there';

if (!recipient || !plainPassword) {
  console.error(
    'Usage: node scripts/send-password-email.js <email> <newPassword> [displayName]'
  );
  process.exit(1);
}

async function run() {
  const frontendUrl = emailService.getFrontendUrl();
  const loginUrl = `${frontendUrl}/login`;

  const mailOptions = {
    from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
    to: recipient,
    subject: 'Your Adventist Community Services password has been reset',
    text: `Hi ${recipientName},\n\nYour Adventist Community Services account password was reset by the administrator on ${new Date().toLocaleDateString('en-AU', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Australia/Sydney',
    })}.\n\nTemporary password: ${plainPassword}\nLogin: ${loginUrl}\n\nPlease sign in with this password as soon as possible and update it from your profile for security.\n\nIf you did not request this reset, contact support immediately.\n\n— Adventist Community Services`,
  };

  try {
    const info = await emailService.transporter.sendMail(mailOptions);
    console.log('Email sent:', info.messageId || info);
  } catch (err) {
    console.error('Failed to send email:', err);
    process.exitCode = 1;
  }
}

run();
