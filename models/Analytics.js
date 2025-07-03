const mongoose = require('mongoose');

const analyticsSchema = new mongoose.Schema({
  // Event tracking
  eventType: {
    type: String,
    required: true,
    enum: [
      'page_view',
      'user_login', 
      'user_logout',
      'user_register',
      'message_sent',
      'post_created',
      'post_liked',
      'file_upload',
      'chat_created',
      'notification_sent',
      'report_submitted',
      'user_search',
      'admin_login',
      'error_occurred',
      'button_click',
      'form_submit',
      'link_click',
      'scroll',
      'resize',
      'api_call'
    ]
  },
  
  // User information
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  userAgent: {
    type: String
  },
  ipAddress: {
    type: String
  },
  
  // Page/Route information
  page: {
    type: String
  },
  referrer: {
    type: String
  },
  
  // Session information
  sessionId: {
    type: String
  },
  sessionDuration: {
    type: Number // in seconds
  },
  
  // Device information
  deviceInfo: {
    platform: String,
    browser: String,
    browserVersion: String,
    isMobile: { type: Boolean, default: false },
    screenResolution: String,
    language: String
  },
  
  // Performance metrics
  performanceMetrics: {
    loadTime: Number, // page load time in ms
    renderTime: Number, // render time in ms
    networkLatency: Number, // network latency in ms
    memoryUsage: Number // memory usage in MB
  },
  
  // Additional metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Geolocation (optional)
  location: {
    country: String,
    city: String,
    timezone: String
  },
  
  // Error information (for error events)
  errorInfo: {
    message: String,
    stack: String,
    url: String,
    lineNumber: Number
  }
}, {
  timestamps: true
});

// Indexes for better query performance
analyticsSchema.index({ eventType: 1, createdAt: -1 });
analyticsSchema.index({ userId: 1, createdAt: -1 });
analyticsSchema.index({ page: 1, createdAt: -1 });
analyticsSchema.index({ sessionId: 1 });
analyticsSchema.index({ createdAt: -1 });
analyticsSchema.index({ 'deviceInfo.isMobile': 1 });

// Static methods for analytics aggregation
analyticsSchema.statics.getDailyStats = async function(days = 7) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return await this.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          eventType: "$eventType"
        },
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: "$_id.date",
        events: {
          $push: {
            type: "$_id.eventType",
            count: "$count"
          }
        },
        totalEvents: { $sum: "$count" }
      }
    },
    { $sort: { _id: 1 } }
  ]);
};

analyticsSchema.statics.getPopularPages = async function(limit = 10) {
  return await this.aggregate([
    {
      $match: {
        eventType: 'page_view',
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }
    },
    {
      $group: {
        _id: "$page",
        views: { $sum: 1 },
        uniqueUsers: { $addToSet: "$userId" }
      }
    },
    {
      $project: {
        page: "$_id",
        views: 1,
        uniqueUsers: { $size: "$uniqueUsers" }
      }
    },
    { $sort: { views: -1 } },
    { $limit: limit }
  ]);
};

analyticsSchema.statics.getUserActivityStats = async function(days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return await this.aggregate([
    {
      $match: {
        userId: { $exists: true },
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: "$userId",
        totalEvents: { $sum: 1 },
        lastActivity: { $max: "$createdAt" },
        eventTypes: { $addToSet: "$eventType" }
      }
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user'
      }
    },
    {
      $project: {
        userId: "$_id",
        totalEvents: 1,
        lastActivity: 1,
        eventTypes: 1,
        user: { $arrayElemAt: ["$user", 0] }
      }
    },
    { $sort: { totalEvents: -1 } }
  ]);
};

module.exports = mongoose.model('Analytics', analyticsSchema); 