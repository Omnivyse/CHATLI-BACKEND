const mongoose = require('mongoose');
const crypto = require('crypto');
require('dotenv').config({ path: require('path').join(__dirname, '../config.env') });

const Admin = require('../models/Admin');

// Function to generate a cryptographically secure random password
function generateSecurePassword(length = 24) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
  let password = '';
  
  for (let i = 0; i < length; i++) {
    const randomIndex = crypto.randomInt(0, charset.length);
    password += charset[randomIndex];
  }
  
  return password;
}

async function initializeAdmin() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB successfully');

    // Generate secure password
    const adminPassword = generateSecurePassword(32);
    
    // Create or check admin user
    const result = await Admin.createDefaultAdmin(adminPassword);
    
    if (result.exists) {
      console.log('\n=================================');
      console.log('Admin user already exists!');
      console.log('Username: admin');
      console.log('=================================\n');
      
      // Ask if user wants to reset password
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      rl.question('Do you want to reset the admin password? (y/N): ', async (answer) => {
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
          try {
            const newPassword = generateSecurePassword(32);
            const admin = await Admin.findOne({ username: 'admin' });
            admin.password = newPassword;
            admin.loginAttempts = 0;
            admin.lockUntil = undefined;
            await admin.save();
            
            console.log('\n=================================');
            console.log('ADMIN PASSWORD RESET SUCCESSFUL!');
            console.log('=================================');
            console.log('Username: admin');
            console.log('New Password:', newPassword);
            console.log('=================================');
            console.log('⚠️  SAVE THIS PASSWORD SECURELY!');
            console.log('=================================\n');
          } catch (error) {
            console.error('Error resetting password:', error.message);
          }
        }
        
        rl.close();
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
        process.exit(0);
      });
      
    } else {
      console.log('\n=================================');
      console.log('ADMIN USER CREATED SUCCESSFULLY!');
      console.log('=================================');
      console.log('Username: admin');
      console.log('Password:', adminPassword);
      console.log('Email: admin@chatli.mn');
      console.log('Role: super_admin');
      console.log('=================================');
      console.log('⚠️  SAVE THIS PASSWORD SECURELY!');
      console.log('⚠️  THIS IS THE ONLY TIME IT WILL BE SHOWN!');
      console.log('=================================\n');
      
      await mongoose.disconnect();
      console.log('Disconnected from MongoDB');
      process.exit(0);
    }

  } catch (error) {
    console.error('Error initializing admin:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

// Add command line arguments handling
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Admin Initialization Script
===========================

Usage: node init-admin.js [options]

Options:
  --help, -h     Show this help message
  --reset, -r    Force password reset for existing admin
  
Examples:
  node init-admin.js          # Initialize or check admin user
  node init-admin.js --reset  # Reset admin password
  `);
  process.exit(0);
}

if (args.includes('--reset') || args.includes('-r')) {
  // Force reset mode
  (async () => {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      const newPassword = generateSecurePassword(32);
      const admin = await Admin.findOne({ username: 'admin' });
      
      if (!admin) {
        console.log('No admin user found. Creating new admin...');
        const result = await Admin.createDefaultAdmin(newPassword);
        console.log('\n=================================');
        console.log('ADMIN USER CREATED SUCCESSFULLY!');
        console.log('=================================');
        console.log('Username: admin');
        console.log('Password:', newPassword);
        console.log('=================================\n');
      } else {
        admin.password = newPassword;
        admin.loginAttempts = 0;
        admin.lockUntil = undefined;
        await admin.save();
        
        console.log('\n=================================');
        console.log('ADMIN PASSWORD RESET SUCCESSFUL!');
        console.log('=================================');
        console.log('Username: admin');
        console.log('New Password:', newPassword);
        console.log('=================================\n');
      }
      
      await mongoose.disconnect();
      process.exit(0);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  })();
} else {
  // Normal initialization mode
  initializeAdmin();
} 