const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  chat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['text', 'image', 'voice', 'file', 'system'],
    default: 'text'
  },
  content: {
    text: {
      type: String,
      maxlength: [2000, 'Мессеж 2000 тэмдэгтээс бага байх ёстой']
    },
    image: {
      url: String,
      caption: String,
      width: Number,
      height: Number
    },
    voice: {
      url: String,
      duration: Number
    },
    file: {
      url: String,
      name: String,
      size: Number,
      type: String
    }
  },
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  replies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  }],
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  reactions: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    emoji: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date
  },
  isPinned: {
    type: Boolean,
    default: false
  },
  pinnedAt: {
    type: Date
  },
  forwardedFrom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
messageSchema.index({ chat: 1, createdAt: -1 });
messageSchema.index({ sender: 1, createdAt: -1 });
messageSchema.index({ replyTo: 1 });

// Virtual for getting reaction count
messageSchema.virtual('reactionCounts').get(function() {
  const counts = {};
  this.reactions.forEach(reaction => {
    counts[reaction.emoji] = (counts[reaction.emoji] || 0) + 1;
  });
  return counts;
});

// Method to add reaction
messageSchema.methods.addReaction = function(userId, emoji) {
  const existingReaction = this.reactions.find(
    reaction => reaction.user.toString() === userId.toString() && reaction.emoji === emoji
  );
  
  if (existingReaction) {
    // Remove existing reaction (toggle off)
    this.reactions = this.reactions.filter(
      reaction => !(reaction.user.toString() === userId.toString() && reaction.emoji === emoji)
    );
  } else {
    // Remove any existing reactions from this user first
    this.reactions = this.reactions.filter(
      reaction => reaction.user.toString() !== userId.toString()
    );
    // Add new reaction
    this.reactions.push({ user: userId, emoji });
  }
  
  return this.save();
};

// Method to mark as read
messageSchema.methods.markAsRead = function(userId) {
  const existingRead = this.readBy.find(
    read => read.user.toString() === userId.toString()
  );
  
  if (!existingRead) {
    this.readBy.push({ user: userId });
    return this.save();
  }
  
  return this;
};

// Method to soft delete
messageSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

// Method to edit message
messageSchema.methods.editMessage = function(newText) {
  this.content.text = newText;
  this.isEdited = true;
  this.editedAt = new Date();
  return this.save();
};

// Pre-save middleware to update chat's last message
messageSchema.pre('save', async function(next) {
  if (this.isNew && !this.isDeleted) {
    try {
      const Chat = mongoose.model('Chat');
      await Chat.findByIdAndUpdate(this.chat, {
        'lastMessage.id': this._id,
        'lastMessage.text': this.content.text || '',
        'lastMessage.sender': this.sender,
        'lastMessage.timestamp': this.createdAt,
        'lastMessage.isRead': false
      });
    } catch (error) {
      console.error('Error updating chat last message:', error);
    }
  }
  next();
});

module.exports = mongoose.model('Message', messageSchema); 