const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Нэр оруулна уу'],
    trim: true,
    maxlength: [50, 'Нэр 50 тэмдэгтээс бага байх ёстой']
  },
  username: {
    type: String,
    required: [true, 'Хэрэглэгчийн нэр оруулна уу'],
    unique: true,
    trim: true,
    lowercase: true,
    maxlength: [30, 'Хэрэглэгчийн нэр 30 тэмдэгтээс бага байх ёстой']
  },
  email: {
    type: String,
    required: [true, 'Имэйл оруулна уу'],
    unique: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Зөв имэйл оруулна уу']
  },
  password: {
    type: String,
    required: [true, 'Нууц үг оруулна уу'],
    minlength: [6, 'Нууц үг хамгийн багадаа 6 тэмдэгт байх ёстой']
  },
  avatar: {
    type: String,
    default: ''
  },
  avatarPublicId: {
    type: String // Cloudinary public ID for avatar deletion
  },
  bio: {
    type: String,
    trim: true,
    maxlength: [500, 'Био 500 тэмдэгтээс бага байх ёстой']
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'away'],
    default: 'offline'
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  friends: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  blockedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  followers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  following: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  coverImage: {
    type: String,
    default: ''
  },
  coverImagePublicId: {
    type: String // Cloudinary public ID for cover image deletion
  },
  privateProfile: {
    type: Boolean,
    default: false
  },
  followRequests: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: []
  }]
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Remove password from JSON response
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  return user;
};

module.exports = mongoose.model('User', userSchema); 