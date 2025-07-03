const express = require('express');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const User = require('../models/User');
const Report = require('../models/Report');
const Analytics = require('../models/Analytics');
const router = express.Router();

// Admin authentication middleware
const authenticateAdmin = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await Admin.findById(decoded.adminId);
    
    if (!admin || !admin.isActive) {
      return res.status(401).json({ error: 'Invalid or inactive admin account.' });
    }

    req.admin = admin;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token.' });
  }
};

// Admin login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const admin = await Admin.findOne({ username: username.toLowerCase() });
    
    if (!admin || !admin.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if account is locked
    if (admin.isLocked) {
      const lockTimeRemaining = Math.ceil((admin.lockUntil - Date.now()) / (1000 * 60));
      return res.status(423).json({ 
        error: `Account locked. Try again in ${lockTimeRemaining} minutes.`,
        lockTimeRemaining
      });
    }

    const isValidPassword = await admin.comparePassword(password);
    
    if (!isValidPassword) {
      const attemptsRemaining = 5 - admin.loginAttempts;
      if (attemptsRemaining <= 0) {
        return res.status(423).json({ 
          error: 'Account locked due to too many failed attempts. Try again in 15 minutes.' 
        });
      }
      return res.status(401).json({ 
        error: `Invalid credentials. ${attemptsRemaining} attempts remaining.`,
        attemptsRemaining
      });
    }

    // Update last login
    await admin.updateLastLogin();

    // Generate JWT token
    const token = jwt.sign(
      { 
        adminId: admin._id, 
        username: admin.username,
        role: admin.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '4h' }
    );

    res.json({
      message: 'Login successful',
      token,
      admin: {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions,
        lastLogin: admin.lastLogin
      }
    });

  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify admin token
router.get('/verify', authenticateAdmin, async (req, res) => {
  try {
    res.json({
      valid: true,
      admin: {
        id: req.admin._id,
        username: req.admin.username,
        email: req.admin.email,
        role: req.admin.role,
        permissions: req.admin.permissions,
        lastLogin: req.admin.lastLogin
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Token verification failed' });
  }
});

// Get dashboard statistics
router.get('/stats', authenticateAdmin, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    const [
      totalUsers,
      onlineUsers,
      pendingReports,
      newUsersToday,
      totalPageViews,
      pageViewsToday,
      totalMessages,
      messagesTotal,
      totalPosts,
      postsToday,
      activeUsersToday,
      avgSessionDuration
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isOnline: true }),
      Report.countDocuments({ status: 'pending' }),
      User.countDocuments({ createdAt: { $gte: today } }),
      Analytics.countDocuments({ eventType: 'page_view' }),
      Analytics.countDocuments({ 
        eventType: 'page_view',
        createdAt: { $gte: today }
      }),
      Analytics.countDocuments({ eventType: 'message_sent' }),
      Analytics.countDocuments({ 
        eventType: 'message_sent',
        createdAt: { $gte: today }
      }),
      Analytics.countDocuments({ eventType: 'post_created' }),
      Analytics.countDocuments({ 
        eventType: 'post_created',
        createdAt: { $gte: today }
      }),
      Analytics.distinct('userId', { 
        createdAt: { $gte: today },
        userId: { $exists: true }
      }).then(users => users.length),
      Analytics.aggregate([
        {
          $match: {
            sessionDuration: { $exists: true, $gt: 0 },
            createdAt: { $gte: lastWeek }
          }
        },
        {
          $group: {
            _id: null,
            avgDuration: { $avg: '$sessionDuration' }
          }
        }
      ]).then(result => result[0]?.avgDuration || 0)
    ]);

    const offlineUsers = totalUsers - onlineUsers;

    res.json({
      totalUsers,
      onlineUsers,
      offlineUsers,
      pendingReports,
      newUsersToday,
      totalPageViews,
      pageViewsToday,
      totalMessages,
      messagesTotal,
      totalPosts,
      postsToday,
      activeUsersToday,
      avgSessionDuration: Math.round(avgSessionDuration || 0)
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Get all users with pagination and search
router.get('/users', authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    const skip = (page - 1) * limit;

    let query = {};
    if (search) {
      query = {
        $or: [
          { username: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ]
      };
    }

    const [users, totalUsers] = await Promise.all([
      User.find(query)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(query)
    ]);

    const totalPages = Math.ceil(totalUsers / limit);

    res.json({
      users,
      pagination: {
        currentPage: page,
        totalPages,
        totalUsers,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Delete user
router.delete('/users/:userId', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await User.findByIdAndDelete(userId);
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Get all reports with pagination
router.get('/reports', authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status || '';
    const skip = (page - 1) * limit;

    let query = {};
    if (status && status !== 'all') {
      query.status = status;
    }

    const [reports, totalReports] = await Promise.all([
      Report.find(query)
        .populate('reporterId', 'username email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Report.countDocuments(query)
    ]);

    const totalPages = Math.ceil(totalReports / limit);

    res.json({
      reports,
      pagination: {
        currentPage: page,
        totalPages,
        totalReports,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// Update report status
router.patch('/reports/:reportId', authenticateAdmin, async (req, res) => {
  try {
    const { reportId } = req.params;
    const { status, adminNotes } = req.body;

    if (!['pending', 'reviewing', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const report = await Report.findByIdAndUpdate(
      reportId,
      { 
        status,
        adminNotes,
        reviewedBy: req.admin._id,
        reviewedAt: new Date()
      },
      { new: true }
    ).populate('reporterId', 'username email');

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json({ message: 'Report updated successfully', report });
  } catch (error) {
    console.error('Update report error:', error);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

// Get analytics data
router.get('/analytics/daily', authenticateAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const dailyStats = await Analytics.getDailyStats(days);
    res.json({ dailyStats });
  } catch (error) {
    console.error('Daily analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch daily analytics' });
  }
});

// Get popular pages
router.get('/analytics/pages', authenticateAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const popularPages = await Analytics.getPopularPages(limit);
    res.json({ popularPages });
  } catch (error) {
    console.error('Popular pages error:', error);
    res.status(500).json({ error: 'Failed to fetch popular pages' });
  }
});

// Get user activity stats
router.get('/analytics/activity', authenticateAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const activityStats = await Analytics.getUserActivityStats(days);
    res.json({ activityStats });
  } catch (error) {
    console.error('User activity error:', error);
    res.status(500).json({ error: 'Failed to fetch user activity stats' });
  }
});

// Get device/browser statistics
router.get('/analytics/devices', authenticateAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [deviceStats, browserStats, mobileStats] = await Promise.all([
      Analytics.aggregate([
        {
          $match: {
            'deviceInfo.platform': { $exists: true },
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: '$deviceInfo.platform',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]),
      Analytics.aggregate([
        {
          $match: {
            'deviceInfo.browser': { $exists: true },
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: '$deviceInfo.browser',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]),
      Analytics.aggregate([
        {
          $match: {
            'deviceInfo.isMobile': { $exists: true },
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: '$deviceInfo.isMobile',
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    res.json({
      deviceStats,
      browserStats,
      mobileStats
    });
  } catch (error) {
    console.error('Device stats error:', error);
    res.status(500).json({ error: 'Failed to fetch device statistics' });
  }
});

// Get real-time analytics
router.get('/analytics/realtime', authenticateAdmin, async (req, res) => {
  try {
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const lastHour = new Date(Date.now() - 60 * 60 * 1000);

    const [
      last24HourEvents,
      lastHourEvents,
      activeUsers,
      currentOnlineUsers,
      recentErrors
    ] = await Promise.all([
      Analytics.countDocuments({ createdAt: { $gte: last24Hours } }),
      Analytics.countDocuments({ createdAt: { $gte: lastHour } }),
      Analytics.distinct('userId', { 
        createdAt: { $gte: lastHour },
        userId: { $exists: true }
      }).then(users => users.length),
      User.countDocuments({ isOnline: true }),
      Analytics.find({ 
        eventType: 'error_occurred',
        createdAt: { $gte: last24Hours }
      }).sort({ createdAt: -1 }).limit(10)
    ]);

    res.json({
      last24HourEvents,
      lastHourEvents,
      activeUsers,
      currentOnlineUsers,
      recentErrors
    });
  } catch (error) {
    console.error('Real-time analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch real-time analytics' });
  }
});

// Track analytics event
router.post('/analytics/track', authenticateAdmin, async (req, res) => {
  try {
    const analyticsData = req.body;
    const analytics = new Analytics(analyticsData);
    await analytics.save();
    res.json({ message: 'Event tracked successfully' });
  } catch (error) {
    console.error('Track analytics error:', error);
    res.status(500).json({ error: 'Failed to track event' });
  }
});

// Admin logout (optional - mainly for logging purposes)
router.post('/logout', authenticateAdmin, async (req, res) => {
  try {
    // In a more sophisticated system, you might want to blacklist the token
    // For now, we'll just return success
    res.json({ message: 'Logout successful' });
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

module.exports = router; 