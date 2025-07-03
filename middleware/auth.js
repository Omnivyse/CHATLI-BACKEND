const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'Токен оруулна уу' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Хэрэглэгч олдсонгүй' 
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Хүчингүй токен' 
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Токен хүчингүй болсон' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Серверийн алдаа' 
    });
  }
};

// Optional auth middleware - doesn't require token
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-password');
        if (user) {
          req.user = user;
        }
      } catch (error) {
        // Silently ignore token errors for optional auth
        console.log('Optional auth token error (ignored):', error.message);
      }
    }
    
    next();
  } catch (error) {
    // Always continue for optional auth
    next();
  }
};

module.exports = { auth, optionalAuth }; 