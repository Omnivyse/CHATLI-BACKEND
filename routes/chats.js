const express = require('express');
const { body, validationResult } = require('express-validator');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const { auth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/chats
// @desc    Get all chats for current user
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    console.log(`📋 Getting chats for user: ${req.user._id}`);
    
    const chats = await Chat.find({
      participants: req.user._id,
      isActive: true,
      deletedBy: { $ne: req.user._id }
    })
    .populate('participants', 'name username avatar status lastSeen')
    .populate('lastMessage.sender', 'name username avatar')
    .populate('lastMessage.id')
    .sort({ 'lastMessage.timestamp': -1 });

    console.log(`📋 Found ${chats.length} chats for user ${req.user._id}`);
    
    // Add unread count for each chat
    const chatsWithUnreadCount = chats.map(chat => {
      const unreadData = chat.unreadCounts.find(item => 
        item.user.toString() === req.user._id.toString()
      );
      const unreadCount = unreadData ? unreadData.count : 0;
      
      console.log(`📋 Chat ${chat._id}: deletedBy=[${chat.deletedBy}], unreadCount=${unreadCount}`);
      
      return {
        ...chat.toObject(),
        unreadCount
      };
    });

    res.json({
      success: true,
      data: {
        chats: chatsWithUnreadCount
      }
    });
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({
      success: false,
      message: 'Серверийн алдаа'
    });
  }
});

// @route   POST /api/chats
// @desc    Create a new chat
// @access  Private
router.post('/', auth, [
  body('type')
    .isIn(['direct', 'group'])
    .withMessage('Чат төрөл буруу байна'),
  body('participants')
    .isArray({ min: 1 })
    .withMessage('Хамрагчдын жагсаалт оруулна уу'),
  body('name')
    .if(body('type').equals('group'))
    .notEmpty()
    .withMessage('Группийн нэр оруулна уу')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Оролтын алдаа',
        errors: errors.array()
      });
    }

    const { type, participants, name } = req.body;

    // Add current user to participants if not already included
    const allParticipants = [...new Set([...participants, req.user._id.toString()])];

    // For direct chats, check if chat already exists
    if (type === 'direct' && allParticipants.length === 2) {
      const existingChat = await Chat.findOne({
        type: 'direct',
        participants: { $all: allParticipants },
        isActive: true
      });

      if (existingChat) {
        // If the chat was soft-deleted by the current user, restore it
        if (existingChat.isDeletedForUser(req.user._id)) {
          await existingChat.restoreForUser(req.user._id);
          console.log(`🔄 Restored soft-deleted chat ${existingChat._id} for user ${req.user._id}`);
          
          // Populate the chat with user data
          await existingChat.populate('participants', 'name username avatar status lastSeen');
          
          return res.status(200).json({
            success: true,
            message: 'Чат сэргээгдлээ',
            data: {
              chat: existingChat
            }
          });
        } else {
          return res.status(400).json({
            success: false,
            message: 'Чат аль хэдийн байна'
          });
        }
      }
    }

    // Validate participants exist
    const participantUsers = await User.find({
      _id: { $in: allParticipants }
    });

    if (participantUsers.length !== allParticipants.length) {
      return res.status(400).json({
        success: false,
        message: 'Зарим хамрагч олдсонгүй'
      });
    }

    const chatData = {
      type,
      participants: allParticipants,
      admins: type === 'group' ? [req.user._id] : []
    };

    if (type === 'group' && name) {
      chatData.name = name;
    }

    const chat = new Chat(chatData);
    await chat.save();

    // Populate the chat with user data
    await chat.populate('participants', 'name username avatar status lastSeen');

    res.status(201).json({
      success: true,
      message: 'Чат амжилттай үүслээ',
      data: {
        chat
      }
    });
  } catch (error) {
    console.error('Create chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Серверийн алдаа'
    });
  }
});

// @route   GET /api/chats/:id
// @desc    Get chat by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const chat = await Chat.findOne({
      _id: req.params.id,
      participants: req.user._id,
      isActive: true
    })
    .populate('participants', 'name username avatar status lastSeen')
    .populate('admins', 'name username avatar')
    .populate('lastMessage.sender', 'name username avatar');

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Чат олдсонгүй'
      });
    }

    res.json({
      success: true,
      data: {
        chat
      }
    });
  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Серверийн алдаа'
    });
  }
});

// @route   GET /api/chats/:id/messages
// @desc    Get messages for a chat
// @access  Private
router.get('/:id/messages', auth, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;

    // Check if user is participant in the chat
    const chat = await Chat.findOne({
      _id: req.params.id,
      participants: req.user._id,
      isActive: true
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Чат олдсонгүй'
      });
    }

    const messages = await Message.find({
      chat: req.params.id,
      isDeleted: false
    })
    .populate('sender', 'name username avatar')
    .populate('replyTo', 'content.text sender')
    .populate('replies', 'content.text sender createdAt')
    .populate('readBy.user', 'name username avatar')
    .populate('reactions.user', 'name username avatar')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

    // Ensure replyTo.sender is populated for all messages with a replyTo
    for (const msg of messages) {
      if (msg.replyTo && msg.replyTo.sender) {
        await msg.populate({ path: 'replyTo.sender', select: 'name username avatar' });
      }
    }

    // Mark messages as read
    await Message.updateMany(
      {
        chat: req.params.id,
        sender: { $ne: req.user._id },
        'readBy.user': { $ne: req.user._id },
        isDeleted: false
      },
      {
        $push: { readBy: { user: req.user._id } }
      }
    );

    // Update chat unread count
    await chat.markAsRead(req.user._id);

    res.json({
      success: true,
      data: {
        messages: messages.reverse(),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          hasMore: messages.length === parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Серверийн алдаа'
    });
  }
});

// @route   POST /api/chats/:id/messages
// @desc    Send a message to a chat
// @access  Private
router.post('/:id/messages', auth, [
  body('content.text')
    .if(body('type').equals('text'))
    .notEmpty()
    .withMessage('Мессеж оруулна уу')
    .isLength({ max: 2000 })
    .withMessage('Мессеж 2000 тэмдэгтээс бага байх ёстой'),
  body('type')
    .isIn(['text', 'image', 'voice', 'file'])
    .withMessage('Мессежийн төрөл буруу байна'),
  body('replyTo')
    .optional()
    .isMongoId()
    .withMessage('Хариултын ID буруу байна')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Оролтын алдаа',
        errors: errors.array()
      });
    }

    // Check if user is participant in the chat
    const chat = await Chat.findOne({
      _id: req.params.id,
      participants: req.user._id,
      isActive: true
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Чат олдсонгүй'
      });
    }

    // If user had deleted this chat, restore it
    if (chat.isDeletedForUser(req.user._id)) {
      await chat.restoreForUser(req.user._id);
    }

    // When someone sends a message, restore the chat for all participants who had deleted it
    // This ensures that if someone sends you a message in a chat you deleted, it reappears in your sidebar
    for (const participantId of chat.participants) {
      if (participantId.toString() !== req.user._id.toString() && chat.isDeletedForUser(participantId)) {
        await chat.restoreForUser(participantId);
      }
    }

    const { type = 'text', content, replyTo } = req.body;

    const messageData = {
      chat: req.params.id,
      sender: req.user._id,
      type,
      content
    };

    if (replyTo) {
      messageData.replyTo = replyTo;
    }

    const message = new Message(messageData);
    await message.save();

    // Update unread count for other participants
    const otherParticipants = chat.participants.filter(
      participant => participant.toString() !== req.user._id.toString()
    );

    for (const participantId of otherParticipants) {
      await chat.updateUnreadCount(participantId, true);
    }

    // Populate the message
    await message.populate('sender', 'name username avatar');
    await message.populate('replyTo', 'content.text sender');
    if (message.replyTo && message.replyTo.sender) {
      await message.populate({ path: 'replyTo.sender', select: 'name username avatar' });
    }

    res.status(201).json({
      success: true,
      message: 'Мессеж амжилттай илгээгдлээ',
      data: {
        message
      }
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      message: 'Серверийн алдаа'
    });
  }
});

// @route   PUT /api/chats/:id/messages/:messageId
// @desc    Edit a message
// @access  Private
router.put('/:id/messages/:messageId', auth, [
  body('content.text')
    .notEmpty()
    .withMessage('Мессеж оруулна уу')
    .isLength({ max: 2000 })
    .withMessage('Мессеж 2000 тэмдэгтээс бага байх ёстой')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Оролтын алдаа',
        errors: errors.array()
      });
    }

    const message = await Message.findOne({
      _id: req.params.messageId,
      chat: req.params.id,
      sender: req.user._id,
      isDeleted: false
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Мессеж олдсонгүй'
      });
    }

    await message.editMessage(req.body.content.text);

    res.json({
      success: true,
      message: 'Мессеж амжилттай засагдлаа',
      data: {
        message
      }
    });
  } catch (error) {
    console.error('Edit message error:', error);
    res.status(500).json({
      success: false,
      message: 'Серверийн алдаа'
    });
  }
});

// @route   DELETE /api/chats/:id/messages/:messageId
// @desc    Delete a message
// @access  Private
router.delete('/:id/messages/:messageId', auth, async (req, res) => {
  try {
    const message = await Message.findOne({
      _id: req.params.messageId,
      chat: req.params.id,
      sender: req.user._id,
      isDeleted: false
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Мессеж олдсонгүй'
      });
    }

    await message.softDelete();

    res.json({
      success: true,
      message: 'Мессеж амжилттай устгагдлаа'
    });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({
      success: false,
      message: 'Серверийн алдаа'
    });
  }
});

// @route   POST /api/chats/:id/messages/:messageId/react
// @desc    React to a message
// @access  Private
router.post('/:id/messages/:messageId/react', auth, [
  body('emoji')
    .notEmpty()
    .withMessage('Эмодзи оруулна уу')
    .isLength({ max: 10 })
    .withMessage('Эмодзи хэт урт байна')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Оролтын алдаа',
        errors: errors.array()
      });
    }

    // Check if user is participant in the chat
    const chat = await Chat.findOne({
      _id: req.params.id,
      participants: req.user._id,
      isActive: true
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Чат олдсонгүй'
      });
    }

    // If user had deleted this chat, restore it when they react to a message
    if (chat.isDeletedForUser(req.user._id)) {
      await chat.restoreForUser(req.user._id);
    }

    const message = await Message.findOne({
      _id: req.params.messageId,
      chat: req.params.id,
      isDeleted: false
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Мессеж олдсонгүй'
      });
    }

    const { emoji } = req.body;

    // Add or remove reaction
    await message.addReaction(req.user._id, emoji);

    // Populate the message with reactions
    await message.populate('reactions.user', 'name username avatar');

    res.json({
      success: true,
      message: 'Реакц амжилттай нэмэгдлээ',
      data: {
        reactions: message.reactions
      }
    });
  } catch (error) {
    console.error('React to message error:', error);
    res.status(500).json({
      success: false,
      message: 'Серверийн алдаа'
    });
  }
});

// @route   POST /api/chats/:id/messages/:messageId/reply
// @desc    Reply to a message
// @access  Private
router.post('/:id/messages/:messageId/reply', auth, [
  body('content.text')
    .notEmpty()
    .withMessage('Хариу мессеж оруулна уу')
    .isLength({ max: 2000 })
    .withMessage('Мессеж 2000 тэмдэгтээс бага байх ёстой')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Оролтын алдаа',
        errors: errors.array()
      });
    }

    // Check if user is participant in the chat
    const chat = await Chat.findOne({
      _id: req.params.id,
      participants: req.user._id,
      isActive: true
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Чат олдсонгүй'
      });
    }

    // If user had deleted this chat, restore it when they reply to a message
    if (chat.isDeletedForUser(req.user._id)) {
      await chat.restoreForUser(req.user._id);
    }

    // Find the message being replied to
    const parentMessage = await Message.findOne({
      _id: req.params.messageId,
      chat: req.params.id,
      isDeleted: false
    });

    if (!parentMessage) {
      return res.status(404).json({
        success: false,
        message: 'Хариулах мессеж олдсонгүй'
      });
    }

    // Create the reply message
    const replyMessage = new Message({
      chat: req.params.id,
      sender: req.user._id,
      type: 'text',
      content: req.body.content,
      replyTo: parentMessage._id
    });
    await replyMessage.save();

    // Add this reply to the parent message's replies array
    parentMessage.replies.push(replyMessage._id);
    await parentMessage.save();

    // Populate the reply message
    await replyMessage.populate('sender', 'name username avatar');
    await replyMessage.populate('replyTo', 'content.text sender');
    if (replyMessage.replyTo && replyMessage.replyTo.sender) {
      await replyMessage.populate({ path: 'replyTo.sender', select: 'name username avatar' });
    }

    res.status(201).json({
      success: true,
      message: 'Хариу амжилттай илгээгдлээ',
      data: {
        message: replyMessage
      }
    });
  } catch (error) {
    console.error('Reply to message error:', error);
    res.status(500).json({
      success: false,
      message: 'Серверийн алдаа'
    });
  }
});

// @route   DELETE /api/chats/:id
// @desc    Delete a chat (soft delete for current user only)
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    console.log(`🗑️ User ${req.user._id} requesting to delete chat ${req.params.id}`);
    
    const chat = await Chat.findOne({
      _id: req.params.id,
      participants: req.user._id,
      isActive: true
    });

    if (!chat) {
      console.log(`🗑️ Chat ${req.params.id} not found for user ${req.user._id}`);
      return res.status(404).json({
        success: false,
        message: 'Чат олдсонгүй'
      });
    }

    console.log(`🗑️ Chat ${req.params.id} found, participants: [${chat.participants}], deletedBy: [${chat.deletedBy}]`);

    // Soft delete the chat for current user only
    await chat.deleteForUser(req.user._id);
    
    console.log(`🗑️ Chat ${req.params.id} soft deleted for user ${req.user._id}`);

    res.json({
      success: true,
      message: 'Чат амжилттай устгагдлаа'
    });
  } catch (error) {
    console.error('Delete chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Серверийн алдаа'
    });
  }
});

module.exports = router; 