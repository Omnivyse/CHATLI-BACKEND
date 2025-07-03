const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // recipient
  type: { type: String, enum: ['like', 'comment'], required: true },
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  from: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // array for grouping
  message: { type: String },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema); 