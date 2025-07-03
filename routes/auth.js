const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { auth, optionalAuth } = require('../middleware/auth');
const mongoose = require('mongoose');

const router = express.Router();

// Generate JWT Token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// Utility to escape regex special characters
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// @route   GET /users/search
// @desc    Search users by name or username
// @access  Private
router.get('/users/search', auth, async (req, res) => {
  try {
    const q = req.query.q || '';
    if (!q.trim()) return res.json({ success: true, data: { users: [] } });
    const safeQ = escapeRegex(q);
    const regex = new RegExp(`^${safeQ}$`, 'i'); // exact match for uniqueness
    console.log('[UserSearch] Query:', q, '| safeQ:', safeQ, '| regex:', regex);

    // Try to find by username first (unique)
    let user = await User.findOne({ username: regex }).select('_id name username avatar privateProfile');
    console.log('[UserSearch] Username match:', user);
    if (user) {
      return res.json({ success: true, data: { users: [user] } });
    }

    // Then try to find by name (should be unique if enforced)
    let usersByName = await User.find({ name: regex }).select('_id name username avatar privateProfile');
    console.log('[UserSearch] Name match:', usersByName);
    if (usersByName.length === 1) {
      return res.json({ success: true, data: { users: usersByName } });
    } else if (usersByName.length > 1) {
      // Legacy data: multiple users with same name
      return res.status(409).json({
        success: false,
        message: 'Олдсон нэр давхцаж байна. Админд хандана уу.',
        data: { users: usersByName }
      });
    }

    // If not found, fallback to partial search (for suggestions)
    const partialRegex = new RegExp(safeQ, 'i');
    const or = [
      { name: partialRegex },
      { username: partialRegex }
    ];
    if (mongoose.Types.ObjectId.isValid(q)) {
      or.push({ _id: q });
    }
    console.log('[UserSearch] Partial search $or:', or);
    const suggestions = await User.find({ $or: or }).select('_id name username avatar privateProfile').limit(10);
    console.log('[UserSearch] Suggestions:', suggestions);
    return res.json({ success: true, data: { users: suggestions } });
  } catch (error) {
    console.error('[UserSearch] Error:', error.stack || error);
    res.status(500).json({ success: false, message: 'Серверийн алдаа' });
  }
});

// @route   GET /api/users/:id
// @desc    Get user by ID
// @access  Private
router.get('/users/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'Хэрэглэгч олдсонгүй' });
    }
    let userObj = user.toObject();
    // Only include followRequests if viewing own profile
    if (user._id.equals(req.user._id)) {
      userObj.followRequests = user.followRequests;
    } else {
      delete userObj.followRequests;
    }
    res.json({ success: true, data: { user: userObj } });
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({ success: false, message: 'Серверийн алдаа' });
  }
});

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', [
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Нэр 2-50 тэмдэгт байх ёстой'),
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 })
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Хэрэглэгчийн нэр зөвхөн үсэг, тоо, _ агуулж болно'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Зөв имэйл оруулна уу'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Нууц үг хамгийн багадаа 6 тэмдэгт байх ёстой')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Оролтын алдаа',
        errors: errors.array()
      });
    }

    const { name, username, email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Хэрэглэгч аль хэдийн бүртгэлтэй байна'
      });
    }

    // Create new user
    const user = new User({
      name,
      username,
      email,
      password
    });

    await user.save();

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Хэрэглэгч амжилттай бүртгэгдлээ',
      data: {
        user,
        token
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Серверийн алдаа'
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Зөв имэйл оруулна уу'),
  body('password')
    .notEmpty()
    .withMessage('Нууц үг оруулна уу')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Оролтын алдаа',
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Имэйл эсвэл нууц үг буруу байна'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Имэйл эсвэл нууц үг буруу байна'
      });
    }

    // Update last seen and status
    user.lastSeen = new Date();
    user.status = 'online';
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Амжилттай нэвтэрлээ',
      data: {
        user,
        token
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Серверийн алдаа'
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', auth, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        user: req.user
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Серверийн алдаа'
    });
  }
});

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', auth, [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Нэр 2-50 тэмдэгт байх ёстой'),
  body('bio')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Био 500 тэмдэгтээс бага байх ёстой'),
  body('avatar')
    .optional()
    .isString()
    .withMessage('Зураг буруу байна'),
  body('coverImage')
    .optional()
    .isString()
    .withMessage('Ковер зураг буруу байна'),
  body('privateProfile')
    .optional()
    .isBoolean()
    .withMessage('Хувийн профайл утга буруу байна')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Оролтын алдаа',
        errors: errors.array()
      });
    }

    const { name, bio, avatar, coverImage, privateProfile } = req.body;
    const updateFields = {};

    if (name) updateFields.name = name;
    if (bio !== undefined) updateFields.bio = bio;
    if (avatar) updateFields.avatar = avatar;
    if (coverImage) updateFields.coverImage = coverImage;
    if (privateProfile !== undefined) updateFields.privateProfile = privateProfile;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateFields,
      { new: true, runValidators: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Профайл амжилттай шинэчлэгдлээ',
      data: {
        user
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Серверийн алдаа'
    });
  }
});

// @route   POST /api/auth/logout
// @desc    Logout user
// @access  Private
router.post('/logout', auth, async (req, res) => {
  try {
    // Update user status to offline
    await User.findByIdAndUpdate(req.user._id, {
      status: 'offline',
      lastSeen: new Date()
    });

    res.json({
      success: true,
      message: 'Амжилттай гарлаа'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Серверийн алдаа'
    });
  }
});

// @route   POST /api/users/:id/follow
// @desc    Follow a user
// @access  Private
router.post('/users/:id/follow', auth, async (req, res) => {
  try {
    const userToFollow = await User.findById(req.params.id);
    const currentUser = await User.findById(req.user._id);
    if (!userToFollow) {
      return res.status(404).json({ success: false, message: 'Хэрэглэгч олдсонгүй' });
    }
    if (userToFollow._id.equals(currentUser._id)) {
      return res.status(400).json({ success: false, message: 'Өөрийгөө дагах боломжгүй' });
    }
    if (userToFollow.followers.includes(currentUser._id)) {
      return res.status(400).json({ success: false, message: 'Та аль хэдийн дагасан байна' });
    }
    if (userToFollow.privateProfile) {
      if (userToFollow.followRequests.includes(currentUser._id)) {
        return res.status(400).json({ success: false, message: 'Дагах хүсэлт илгээсэн байна' });
      }
      userToFollow.followRequests.push(currentUser._id);
      await userToFollow.save();
      return res.json({ success: true, message: 'Дагах хүсэлт илгээгдлээ', data: { followRequests: userToFollow.followRequests } });
    }
    userToFollow.followers.push(currentUser._id);
    currentUser.following.push(userToFollow._id);
    await userToFollow.save();
    await currentUser.save();
    res.json({ success: true, message: 'Дагах амжилттай', data: { followers: userToFollow.followers, following: currentUser.following } });
  } catch (error) {
    console.error('Follow error:', error);
    res.status(500).json({ success: false, message: 'Серверийн алдаа' });
  }
});

// @route   POST /api/users/:id/unfollow
// @desc    Unfollow a user
// @access  Private
router.post('/users/:id/unfollow', auth, async (req, res) => {
  try {
    const userToUnfollow = await User.findById(req.params.id);
    const currentUser = await User.findById(req.user._id);
    if (!userToUnfollow) {
      return res.status(404).json({ success: false, message: 'Хэрэглэгч олдсонгүй' });
    }
    if (userToUnfollow._id.equals(currentUser._id)) {
      return res.status(400).json({ success: false, message: 'Өөрийгөө дагах боломжгүй' });
    }
    userToUnfollow.followers = userToUnfollow.followers.filter(f => !f.equals(currentUser._id));
    currentUser.following = currentUser.following.filter(f => !f.equals(userToUnfollow._id));
    await userToUnfollow.save();
    await currentUser.save();
    res.json({ success: true, message: 'Дагахаа болилоо', data: { followers: userToUnfollow.followers, following: currentUser.following } });
  } catch (error) {
    console.error('Unfollow error:', error);
    res.status(500).json({ success: false, message: 'Серверийн алдаа' });
  }
});

// @route   POST /api/users/:id/accept-request
// @desc    Accept a follow request
// @access  Private
router.post('/users/:id/accept-request', auth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);
    const requesterId = req.body.requesterId;
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'Хэрэглэгч олдсонгүй' });
    }
    if (!currentUser.followRequests.includes(requesterId)) {
      return res.status(400).json({ success: false, message: 'Дагах хүсэлт олдсонгүй' });
    }
    // Remove from followRequests, add to followers
    currentUser.followRequests = currentUser.followRequests.filter(id => id.toString() !== requesterId);
    currentUser.followers.push(requesterId);
    await currentUser.save();
    // Also add to requester's following
    const requester = await User.findById(requesterId);
    if (requester) {
      requester.following.push(currentUser._id);
      await requester.save();
    }
    res.json({ success: true, message: 'Дагах хүсэлт зөвшөөрөгдлөө', data: { followers: currentUser.followers } });
  } catch (error) {
    console.error('Accept request error:', error);
    res.status(500).json({ success: false, message: 'Серверийн алдаа' });
  }
});

// @route   POST /api/users/:id/reject-request
// @desc    Reject a follow request
// @access  Private
router.post('/users/:id/reject-request', auth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);
    const requesterId = req.body.requesterId;
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'Хэрэглэгч олдсонгүй' });
    }
    if (!currentUser.followRequests.includes(requesterId)) {
      return res.status(400).json({ success: false, message: 'Дагах хүсэлт олдсонгүй' });
    }
    // Remove from followRequests
    currentUser.followRequests = currentUser.followRequests.filter(id => id.toString() !== requesterId);
    await currentUser.save();
    res.json({ success: true, message: 'Дагах хүсэлт цуцлагдлаа', data: { followRequests: currentUser.followRequests } });
  } catch (error) {
    console.error('Reject request error:', error);
    res.status(500).json({ success: false, message: 'Серверийн алдаа' });
  }
});

// @route   POST /api/users/:id/cancel-follow-request
// @desc    Cancel a follow request
// @access  Private
router.post('/users/:id/cancel-follow-request', auth, async (req, res) => {
  try {
    const userToCancel = await User.findById(req.params.id);
    const currentUser = await User.findById(req.user._id);
    if (!userToCancel) {
      return res.status(404).json({ success: false, message: 'Хэрэглэгч олдсонгүй' });
    }
    // Remove from followRequests
    userToCancel.followRequests = userToCancel.followRequests.filter(id => id.toString() !== currentUser._id.toString());
    await userToCancel.save();
    res.json({ success: true, message: 'Дагах хүсэлт цуцлагдлаа', data: { followRequests: userToCancel.followRequests } });
  } catch (error) {
    console.error('Cancel follow request error:', error);
    res.status(500).json({ success: false, message: 'Серверийн алдаа' });
  }
});

// @route   GET /api/auth/following
// @desc    Get user's following list
// @access  Private
router.get('/following', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('following', 'name username avatar status lastSeen')
      .select('following');
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'Хэрэглэгч олдсонгүй' });
    }

    res.json({ 
      success: true, 
      data: { following: user.following } 
    });
  } catch (error) {
    console.error('Get following error:', error);
    res.status(500).json({ success: false, message: 'Серверийн алдаа' });
  }
});

// Delete account endpoint
router.delete('/delete-account', auth, async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Нууц үг шаардлагатай' 
      });
    }

    // Get user with password
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Хэрэглэгч олдсонгүй' 
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ 
        success: false, 
        message: 'Нууц үг буруу байна' 
      });
    }

    // Delete user's posts and associated media
    const Post = require('../models/Post');
    const Chat = require('../models/Chat');
    const Notification = require('../models/Notification');
    const { deleteFile } = require('../config/cloudinary');

    // Delete user's posts and their media from Cloudinary
    const userPosts = await Post.find({ author: user._id });
    for (const post of userPosts) {
      // Delete media from Cloudinary
      if (post.media && post.media.length > 0) {
        for (const mediaItem of post.media) {
          if (mediaItem.publicId) {
            try {
              await deleteFile(mediaItem.publicId);
            } catch (error) {
              console.error('Error deleting media from Cloudinary:', error);
            }
          }
        }
      }
    }
    
    // Delete all user's posts
    await Post.deleteMany({ author: user._id });

    // Remove user from all chats
    await Chat.updateMany(
      { participants: user._id },
      { $pull: { participants: user._id } }
    );

    // Delete empty chats (chats with less than 2 participants)
    await Chat.deleteMany({ 
      $expr: { $lt: [{ $size: '$participants' }, 2] } 
    });

    // Delete notifications related to this user
    await Notification.deleteMany({
      $or: [
        { from: user._id },
        { to: user._id }
      ]
    });

    // Delete user's avatar and cover image from Cloudinary
    if (user.avatarPublicId) {
      try {
        await deleteFile(user.avatarPublicId);
      } catch (error) {
        console.error('Error deleting avatar from Cloudinary:', error);
      }
    }
    
    if (user.coverImagePublicId) {
      try {
        await deleteFile(user.coverImagePublicId);
      } catch (error) {
        console.error('Error deleting cover image from Cloudinary:', error);
      }
    }

    // Finally, delete the user
    await User.findByIdAndDelete(user._id);

    res.json({ 
      success: true, 
      message: 'Акаунт амжилттай устгагдлаа' 
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Серверийн алдаа' 
    });
  }
});

module.exports = router; 