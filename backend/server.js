require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

// 1. DATABASE SETUP
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query(`
  CREATE TABLE IF NOT EXISTS bulldawgs_messages (
    id SERIAL PRIMARY KEY,
    chat_id TEXT NOT NULL,
    sender_id INTEGER,
    sender_name TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    media_url TEXT,
    is_deleted BOOLEAN DEFAULT FALSE,
    reply_to_id INTEGER DEFAULT NULL,
    reactions JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`).then(() => console.log('✅ Connected to Supabase Database securely.'))
  .catch(err => console.error('❌ Database connection error', err.stack));

// 2. WEBSOCKETS (CHAT ENGINE)
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || "http://localhost:3000", methods: ["GET", "POST"] }
});

io.on('connection', (socket) => {
  console.log(`User connected to socket: ${socket.id}`);
  
  const sendChannels = async () => {
    try {
      const channels = await pool.query('SELECT * FROM bulldawgs_channels ORDER BY id ASC');
      socket.emit('load_channels', channels.rows);
    } catch (err) { console.error(err); }
  };
  sendChannels();

  socket.on('create_channel', async (name) => {
    try {
      const uniqueId = 'group_' + Math.random().toString(36).substr(2, 9);
      await pool.query('INSERT INTO bulldawgs_channels (channel_id, name) VALUES ($1, $2)', [uniqueId, name]);
      const channels = await pool.query('SELECT * FROM bulldawgs_channels ORDER BY id ASC');
      io.emit('load_channels', channels.rows);
    } catch (err) { console.error('Error creating channel', err); }
  });

  socket.on('rename_channel', async ({ channelId, newName }) => {
    try {
      await pool.query('UPDATE bulldawgs_channels SET name = $1 WHERE channel_id = $2', [newName, channelId]);
      const channels = await pool.query('SELECT * FROM bulldawgs_channels ORDER BY id ASC');
      io.emit('load_channels', channels.rows);
    } catch (err) { console.error('Error renaming channel', err); }
  });

  socket.on('join_chat', async (chatId) => {
    socket.join(chatId);
    try {
      const history = await pool.query('SELECT * FROM bulldawgs_messages WHERE chat_id = $1 ORDER BY created_at ASC LIMIT 100', [chatId]);
      socket.emit('load_history', history.rows);
    } catch (err) { console.error('Error loading history:', err); }
  });

  socket.on('leave_chat', (chatId) => { socket.leave(chatId); });

  // UPGRADED: Now accepts replies!
  socket.on('send_message', async (data) => {
    try {
      const savedMsg = await pool.query(
        'INSERT INTO bulldawgs_messages (chat_id, sender_id, sender_name, content, timestamp, media_url, reply_to_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
        [data.chatId, data.senderId, data.senderName, data.content, data.timestamp, data.mediaUrl || null, data.replyToId || null]
      );
      io.to(data.chatId).emit('receive_message', savedMsg.rows[0]);
    } catch (err) { console.error('Error saving message:', err); }
  });

  // UPGRADED: Commander Admin Deletions
  socket.on('delete_message', async ({ chatId, messageId, senderId, isAdmin }) => {
    try {
      let updated;
      if (isAdmin) {
        updated = await pool.query("UPDATE bulldawgs_messages SET is_deleted = TRUE, content = '🚫 Redacted by Commander.', media_url = NULL WHERE id = $1 RETURNING *", [messageId]);
      } else {
        updated = await pool.query("UPDATE bulldawgs_messages SET is_deleted = TRUE, content = '🚫 This secure transmission was redacted.', media_url = NULL WHERE id = $1 AND sender_id = $2 RETURNING *", [messageId, senderId]);
      }
      
      if (updated.rows.length > 0) {
        io.to(chatId).emit('message_deleted', { messageId, content: updated.rows[0].content });
      }
    } catch (err) { console.error('❌ Error deleting message:', err); }
  });

  // NEW: Emoji Reactions
  socket.on('update_reaction', async ({ chatId, messageId, reactions }) => {
    try {
      await pool.query('UPDATE bulldawgs_messages SET reactions = $1 WHERE id = $2', [reactions, messageId]);
      io.to(chatId).emit('reaction_updated', { messageId, reactions });
    } catch (err) { console.error('Error updating reaction:', err); }
  });

  // NEW: Profile Picture Updates
  socket.on('update_profile', async ({ userId, avatarUrl }) => {
    try {
      await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, userId]);
      io.emit('profile_updated', { userId, avatarUrl });
    } catch (err) { console.error('Error updating profile:', err); }
  });

  socket.on('disconnect', () => console.log(`User disconnected: ${socket.id}`));
});

// 3. AUTHENTICATION API ROUTES (Upgraded to load Avatars and Admin status)
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password, inviteCode } = req.body;
  try {
    const inviteCheck = await pool.query('SELECT * FROM invites WHERE code = $1 AND is_used = FALSE', [inviteCode]);
    if (inviteCheck.rows.length === 0) return res.status(403).json({ error: "Invalid or expired invite code." });

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await pool.query('INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, avatar_url, is_admin', [username, email, passwordHash]);
    await pool.query('UPDATE invites SET is_used = TRUE WHERE code = $1', [inviteCode]);
    
    const token = jwt.sign({ userId: newUser.rows[0].id }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '7d' });
    res.status(201).json({ user: newUser.rows[0], token });
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ error: "Username or email already exists." });
    res.status(500).json({ error: "Server error during registration." });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: "Invalid credentials." });
    const user = userResult.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(401).json({ error: "Invalid credentials." });
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '7d' });
    res.json({ user: { id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url, is_admin: user.is_admin }, token });
  } catch (error) { res.status(500).json({ error: "Server error during login." }); }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await pool.query('SELECT id, username, avatar_url, is_admin FROM users ORDER BY username ASC');
    res.json(users.rows);
  } catch (error) { res.status(500).json({ error: "Failed to fetch users." }); }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`BULLDAWGS Backend running on port ${PORT}`));