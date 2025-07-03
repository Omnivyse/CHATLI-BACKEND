const express = require('express');
const router = express.Router();
const Analytics = require('../models/Analytics');

// Public endpoint to track analytics events (no auth required)
router.post('/track', async (req, res) => {
  try {
    const { events } = req.body;
    
    if (!events || !Array.isArray(events)) {
      return res.status(400).json({ error: 'Events array is required' });
    }

    // Get client IP address
    const clientIP = req.headers['x-forwarded-for'] || 
                    req.connection.remoteAddress || 
                    req.socket.remoteAddress ||
                    (req.connection.socket ? req.connection.socket.remoteAddress : null);

    // Process and save each event with better validation
    const analyticsPromises = events.map(async (eventData) => {
      try {
        // Skip invalid events silently
        if (!eventData.eventType || typeof eventData.eventType !== 'string') {
          return null;
        }

        const analytics = new Analytics({
          ...eventData,
          ipAddress: clientIP,
          // Remove timestamp from frontend and let MongoDB set createdAt
          createdAt: eventData.timestamp ? new Date(eventData.timestamp) : undefined
        });
        
        return await analytics.save();
      } catch (error) {
        // Log validation errors but don't crash the server
        console.warn('Skipping invalid analytics event:', {
          eventType: eventData.eventType,
          error: error.message
        });
        return null;
      }
    });

    await Promise.all(analyticsPromises);
    
    res.json({ 
      success: true, 
      message: 'Events tracked successfully',
      count: events.length 
    });

  } catch (error) {
    console.error('Analytics tracking error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to track events' 
    });
  }
});

// Public endpoint to get basic website stats (no sensitive data)
router.get('/public-stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    const [
      totalPageViews,
      pageViewsToday,
      pageViewsThisWeek,
      uniqueVisitorsToday,
      popularPages
    ] = await Promise.all([
      Analytics.countDocuments({ eventType: 'page_view' }),
      Analytics.countDocuments({ 
        eventType: 'page_view',
        createdAt: { $gte: today }
      }),
      Analytics.countDocuments({ 
        eventType: 'page_view',
        createdAt: { $gte: lastWeek }
      }),
      Analytics.distinct('sessionId', { 
        createdAt: { $gte: today }
      }).then(sessions => sessions.length),
      Analytics.getPopularPages(5)
    ]);

    res.json({
      totalPageViews,
      pageViewsToday,
      pageViewsThisWeek,
      uniqueVisitorsToday,
      popularPages: popularPages.map(p => ({
        page: p.page,
        views: p.views
        // Don't expose unique user counts publicly
      }))
    });

  } catch (error) {
    console.error('Public stats error:', error);
    res.status(500).json({ error: 'Failed to fetch public statistics' });
  }
});

module.exports = router; 