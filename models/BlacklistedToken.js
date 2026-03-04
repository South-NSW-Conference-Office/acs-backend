const mongoose = require('mongoose');

const blacklistedTokenSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }, // TTL index auto-deletes expired docs
  blacklistedAt: { type: Date, default: Date.now },
  reason: { type: String, default: 'logout' },
});

module.exports = mongoose.model('BlacklistedToken', blacklistedTokenSchema);
