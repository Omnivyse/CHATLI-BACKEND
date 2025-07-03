const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

async function migrate() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    
    const Chat = require('./models/Chat');
    
    console.log('Checking for chats without deletedBy field...');
    const count = await Chat.countDocuments({ deletedBy: { $exists: false } });
    console.log(`Found ${count} chats without deletedBy field`);
    
    if (count > 0) {
      console.log('Adding deletedBy field to existing chats...');
      const result = await Chat.updateMany(
        { deletedBy: { $exists: false } },
        { $set: { deletedBy: [] } }
      );
      console.log(`Successfully updated ${result.modifiedCount} chats`);
    } else {
      console.log('All chats already have deletedBy field');
    }
    
    console.log('Migration completed!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate(); 