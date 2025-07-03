const express = require('express');
const router = express.Router();
const { auth, optionalAuth } = require('../middleware/auth');
const Report = require('../models/Report');

// Submit a report
router.post('/submit', auth, async (req, res) => {
  try {
    const { category, description, userEmail } = req.body;
    
    if (!category || !description || description.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Ангилал болон дэлгэрэнгүй тайлбар шаардлагатай'
      });
    }

    const report = new Report({
      reporterId: req.user.id,
      userName: req.user.name,
      userEmail: userEmail || req.user.email,
      category,
      description: description.trim(),
      priority: category === 'inappropriate_content' ? 'high' : 'normal'
    });

    await report.save();

    console.log('New report received:', {
      id: report._id,
      category: report.category,
      user: report.userName
    });

    res.json({
      success: true,
      message: 'Таны мэдээллийг хүлээн авлаа',
      data: {
        reportId: report._id
      }
    });

  } catch (error) {
    console.error('Report submission error:', error);
    res.status(500).json({
      success: false,
      message: 'Серверийн алдаа гарлаа'
    });
  }
});

// Get all reports (admin only)
router.get('/admin', auth, async (req, res) => {
  try {
    // Add admin check here
    // if (!req.user.isAdmin) {
    //   return res.status(403).json({ success: false, message: 'Access denied' });
    // }

    const reports = await Report.find()
      .populate('reporterId', 'username email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        reports
      }
    });

  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Серверийн алдаа гарлаа'
    });
  }
});

// Update report status (admin only)
router.patch('/:reportId/status', auth, async (req, res) => {
  try {
    const { reportId } = req.params;
    const { status } = req.body;

    const report = await Report.findByIdAndUpdate(
      reportId,
      { status },
      { new: true }
    ).populate('reporterId', 'username email');

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Мэдээлэл олдсонгүй'
      });
    }

    res.json({
      success: true,
      message: 'Төлөв шинэчлэгдлээ',
      data: { report }
    });

  } catch (error) {
    console.error('Update report status error:', error);
    res.status(500).json({
      success: false,
      message: 'Серверийн алдаа гарлаа'
    });
  }
});

module.exports = router; 