const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const { auth, optionalAuth } = require('../middleware/auth');
const { uploadImage, uploadVideo } = require('../config/cloudinary');

const router = express.Router();

// Ensure upload directory exists
const ensureUploadDir = async () => {
  const uploadDir = path.join(__dirname, '../uploads/temp');
  try {
    await fs.mkdir(uploadDir, { recursive: true });
  } catch (error) {
    console.error('Error creating upload directory:', error);
  }
  return uploadDir;
};

// Configure multer for temporary file storage
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const uploadDir = await ensureUploadDir();
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  // Check file type
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image and video files are allowed'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Upload single file
router.post('/single', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    let uploadResult;
    const isVideo = req.file.mimetype.startsWith('video/');
    
    if (isVideo) {
      uploadResult = await uploadVideo(req.file);
    } else {
      uploadResult = await uploadImage(req.file);
    }

    // Clean up temp file
    await fs.unlink(req.file.path);

    res.json({
      success: true,
      data: {
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        type: isVideo ? 'video' : 'image',
        width: uploadResult.width,
        height: uploadResult.height,
        format: uploadResult.format,
        size: uploadResult.bytes
      }
    });

  } catch (error) {
    // Clean up temp file on error
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error cleaning up temp file:', unlinkError);
      }
    }
    
    console.error('Upload error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'File upload failed' 
    });
  }
});

// Upload multiple files
router.post('/multiple', auth, (req, res) => {
  upload.array('files', 10)(req, res, async (err) => {
    if (err) {
      console.error('Multer error:', err);
      return res.status(400).json({ 
        success: false, 
        message: err.message || 'File upload error' 
      });
    }

    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: 'No files uploaded' });
      }

      console.log(`Processing ${req.files.length} files for upload`);

      const uploadPromises = req.files.map(async (file, index) => {
        try {
          console.log(`Uploading file ${index + 1}: ${file.originalname}`);
          const isVideo = file.mimetype.startsWith('video/');
          let uploadResult;
          
          if (isVideo) {
            uploadResult = await uploadVideo(file);
          } else {
            uploadResult = await uploadImage(file);
          }

          // Clean up temp file
          try {
            await fs.unlink(file.path);
          } catch (unlinkError) {
            console.warn('Could not delete temp file:', unlinkError.message);
          }

          return {
            url: uploadResult.secure_url,
            publicId: uploadResult.public_id,
            type: isVideo ? 'video' : 'image',
            width: uploadResult.width,
            height: uploadResult.height,
            format: uploadResult.format,
            size: uploadResult.bytes
          };
        } catch (error) {
          console.error(`Error uploading file ${index + 1}:`, error);
          // Clean up temp file on error
          try {
            await fs.unlink(file.path);
          } catch (unlinkError) {
            console.warn('Could not delete temp file after error:', unlinkError.message);
          }
          throw new Error(`Failed to upload ${file.originalname}: ${error.message}`);
        }
      });

      const results = await Promise.all(uploadPromises);
      console.log(`Successfully uploaded ${results.length} files`);

      res.json({
        success: true,
        data: results
      });

    } catch (error) {
      console.error('Multiple upload error:', error);
      
      // Clean up any remaining temp files
      if (req.files) {
        req.files.forEach(async (file) => {
          try {
            await fs.unlink(file.path);
          } catch (unlinkError) {
            console.warn('Could not delete temp file during cleanup:', unlinkError.message);
          }
        });
      }

      res.status(500).json({ 
        success: false, 
        message: error.message || 'File upload failed' 
      });
    }
  });
});

// Avatar/Profile image upload (smaller size)
router.post('/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    if (!req.file.mimetype.startsWith('image/')) {
      await fs.unlink(req.file.path);
      return res.status(400).json({ success: false, message: 'Only image files allowed for avatar' });
    }

    // Upload with avatar-specific transformations
    const uploadResult = await uploadImage(req.file, 'messenger/avatars');

    // Clean up temp file
    await fs.unlink(req.file.path);

    res.json({
      success: true,
      data: {
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        type: 'image'
      }
    });

  } catch (error) {
    // Clean up temp file on error
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error cleaning up temp file:', unlinkError);
      }
    }
    
    console.error('Avatar upload error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Avatar upload failed' 
    });
  }
});

module.exports = router; 