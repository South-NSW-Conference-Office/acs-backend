const emailService = require('../services/emailService');

// Enquiries from the public went `to: EMAIL_FROM`, which forced the mailbox that
// receives them to be the same one the system sends from.
//
// Those are different jobs. The sender has to be an account whose domain authorises
// the SMTP relay in SPF — get that wrong and strict receivers bin the mail silently,
// which is exactly how a batch of invitations went missing. The recipient is simply
// the staffed inbox printed on the website for people to write to. Tying them
// together means fixing the sender's deliverability silently redirects the public's
// mail into whichever mailbox was chosen for its DNS.
//
// CONTACT_EMAIL separates them, defaulting to the old behaviour so an installation
// that never sets it is unaffected.

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('contact recipient', () => {
  it('uses CONTACT_EMAIL when set', () => {
    process.env.EMAIL_FROM = 'system@sender.example';
    process.env.CONTACT_EMAIL = 'enquiries@public.example';

    expect(emailService.getContactRecipient()).toBe('enquiries@public.example');
  });

  it('lets the sender and the recipient differ — the point of the change', () => {
    process.env.EMAIL_FROM = 'system@sender.example';
    process.env.CONTACT_EMAIL = 'enquiries@public.example';

    expect(emailService.getContactRecipient()).not.toBe(process.env.EMAIL_FROM);
  });

  it('falls back to EMAIL_FROM when CONTACT_EMAIL is unset', () => {
    process.env.EMAIL_FROM = 'system@sender.example';
    delete process.env.CONTACT_EMAIL;

    expect(emailService.getContactRecipient()).toBe('system@sender.example');
  });

  it('falls back for an empty CONTACT_EMAIL rather than sending nowhere', () => {
    process.env.EMAIL_FROM = 'system@sender.example';
    process.env.CONTACT_EMAIL = '';

    expect(emailService.getContactRecipient()).toBe('system@sender.example');
  });
});
