const cloudinary = require('cloudinary').v2;

// Debug environment variables
console.log('Cloudinary Config Debug:');
console.log('CLOUDINARY_CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME);
console.log('CLOUDINARY_API_KEY:', process.env.CLOUDINARY_API_KEY ? 'Set' : 'Not set');
console.log('CLOUDINARY_API_SECRET:', process.env.CLOUDINARY_API_SECRET ? 'Set' : 'Not set');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Verify configuration
const config = cloudinary.config();
console.log('Cloudinary configured with cloud_name:', config.cloud_name);

// Upload function for images
const uploadImage = async (file, folder = 'messenger/images') => {
  try {
    const result = await cloudinary.uploader.upload(file.path, {
      folder: folder,
      resource_type: 'image',
      transformation: [
        { quality: 'auto', fetch_format: 'auto' }, // Automatic optimization
        { width: 1200, height: 1200, crop: 'limit' } // Limit max size
      ]
    });
    return result;
  } catch (error) {
    throw new Error('Image upload failed: ' + error.message);
  }
};

// Upload function for videos
const uploadVideo = async (file, folder = 'messenger/videos') => {
  try {
    const result = await cloudinary.uploader.upload(file.path, {
      folder: folder,
      resource_type: 'video',
      transformation: [
        { quality: 'auto', fetch_format: 'auto' }, // Automatic optimization
        { width: 1280, height: 720, crop: 'limit', bit_rate: '1m' } // Optimize video
      ]
    });
    return result;
  } catch (error) {
    throw new Error('Video upload failed: ' + error.message);
  }
};

// Delete function
const deleteFile = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    throw new Error('File deletion failed: ' + error.message);
  }
};

// Generate optimized URL
const getOptimizedUrl = (publicId, options = {}) => {
  return cloudinary.url(publicId, {
    quality: 'auto',
    fetch_format: 'auto',
    ...options
  });
};

module.exports = {
  cloudinary,
  uploadImage,
  uploadVideo,
  deleteFile,
  getOptimizedUrl
}; 