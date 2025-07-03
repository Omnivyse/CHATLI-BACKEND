const validator = require('validator');
const rateLimit = require('express-rate-limit');

// Input sanitization middleware
const sanitizeInput = (req, res, next) => {
  // Sanitize string inputs
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    
    // Remove potential XSS attacks
    str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    str = str.replace(/javascript:/gi, '');
    str = str.replace(/on\w+\s*=/gi, '');
    
    // Trim whitespace
    str = str.trim();
    
    return str;
  };

  // Recursively sanitize object
  const sanitizeObject = (obj) => {
    if (obj === null || typeof obj !== 'object') {
      return typeof obj === 'string' ? sanitizeString(obj) : obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  };

  // Sanitize request body
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }

  next();
};

// Validate common inputs
const validateInput = {
  email: (email) => {
    if (!email || typeof email !== 'string') return false;
    return validator.isEmail(email) && email.length <= 254;
  },

  password: (password) => {
    if (!password || typeof password !== 'string') return false;
    // At least 8 characters, max 128
    return password.length >= 8 && password.length <= 128;
  },

  username: (username) => {
    if (!username || typeof username !== 'string') return false;
    // 3-30 characters, alphanumeric and underscore only
    return /^[a-zA-Z0-9_]{3,30}$/.test(username);
  },

  name: (name) => {
    if (!name || typeof name !== 'string') return false;
    // 1-100 characters, letters, spaces, and common name characters
    return /^[a-zA-ZА-Яа-яЁёӨөҮүҺһ\s\-']{1,100}$/.test(name);
  },

  text: (text, maxLength = 2000) => {
    if (!text || typeof text !== 'string') return false;
    return text.length <= maxLength;
  },

  mongoId: (id) => {
    if (!id || typeof id !== 'string') return false;
    return validator.isMongoId(id);
  }
};

// File upload security
const validateFileUpload = (req, res, next) => {
  if (!req.files && !req.file) return next();

  const allowedMimeTypes = [
    'image/jpeg',
    'image/png', 
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ];

  const maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024; // 50MB

  const files = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : [req.file];

  for (const file of files) {
    if (!file) continue;

    // Check file size
    if (file.size > maxFileSize) {
      return res.status(400).json({
        success: false,
        message: 'Файлын хэмжээ хэт том байна'
      });
    }

    // Check MIME type
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Зөвшөөрөгдөөгүй файлын төрөл'
      });
    }

    // Additional security checks
    if (file.originalname) {
      // Check for dangerous file extensions
      const dangerousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.pif', '.jar', '.js', '.vbs'];
      const fileExt = file.originalname.toLowerCase();
      
      if (dangerousExtensions.some(ext => fileExt.endsWith(ext))) {
        return res.status(400).json({
          success: false,
          message: 'Аюултай файлын төрөл илрүүлэгдлээ'
        });
      }
    }
  }

  next();
};

// Request logging for security monitoring
const securityLogger = (req, res, next) => {
  const startTime = Date.now();
  
  // Log suspicious patterns
  const suspiciousPatterns = [
    /(\<|\%3C).*script.*(\>|\%3E)/i,
    /(\<|\%3C).*iframe.*(\>|\%3E)/i,
    /(\<|\%3C).*object.*(\>|\%3E)/i,
    /(\<|\%3C).*embed.*(\>|\%3E)/i,
    /javascript:/i,
    /vbscript:/i,
    /onload=/i,
    /onerror=/i,
    /\.\.\/|\.\.\\|\.\.%2f|\.\.%5c/i,
    /union.*select/i,
    /select.*from/i,
    /insert.*into/i,
    /delete.*from/i,
    /update.*set/i
  ];

  const requestContent = JSON.stringify({
    url: req.url,
    method: req.method,
    body: req.body,
    query: req.query,
    headers: req.headers
  });

  const suspicious = suspiciousPatterns.some(pattern => pattern.test(requestContent));

  if (suspicious) {
    console.warn(`🚨 SECURITY ALERT: Suspicious request detected`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url,
      method: req.method,
      timestamp: new Date().toISOString()
    });
  }

  // Log response time
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    if (duration > 5000) { // Log slow requests
      console.warn(`⏱️  SLOW REQUEST: ${req.method} ${req.url} took ${duration}ms`);
    }
  });

  next();
};

// Enhanced auth rate limiting for sensitive operations
const sensitiveOperationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 attempts per window
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: 'Хэт олон оролдлого. 15 минутын дараа дахин оролдоно уу.'
  }
});

module.exports = {
  sanitizeInput,
  validateInput,
  validateFileUpload,
  securityLogger,
  sensitiveOperationLimiter
}; 