const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { initDatabase } = require('./database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 3000;
const JWT_SECRET = 'your-secret-key-change-in-production';

// Authentication middleware
function authenticate(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));
app.use(express.static('public'));

// Initialize database
let db;
(async () => {
  db = await initDatabase();
  console.log('✅ Server connected to database');
})();

// Check for expired auctions every 10 seconds
setInterval(checkExpiredAuctions, 10000);

// ============================================
// FILE UPLOAD CONFIGURATION
// ============================================
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads', 'items');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'item-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images (jpeg, jpg, png, gif) are allowed'));
    }
  }
});

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// ============================================
// HELPER FUNCTIONS
// ============================================

async function checkExpiredAuctions() {
  console.log('🕐 Checking for expired auctions...');
  
  try {
    // Find expired items - MAKE SURE TO SELECT host_id!
const expiredItems = await db.all(
  `SELECT i.item_id, i.item_name, i.end_time, i.host_id, i.item_status,
          datetime(i.end_time) as end_dt,
          datetime('now') as now_dt
   FROM ITEMS i
WHERE datetime(i.end_time) <= datetime('now')
   AND i.item_status = 'available'`
);

// DEBUG: Show all items
const allItems = await db.all('SELECT item_id, item_name, end_time, item_status FROM ITEMS');
console.log('🔍 ALL ITEMS:', allItems);
console.log('🔍 ALL ITEMS count:', allItems.length);
console.log('🔍 Database file path:', require('path').resolve('./auction.db'));
console.log('🔍 Current time:', new Date().toISOString());
const serverLocalTime = await db.get("SELECT datetime('now', 'localtime') as time");
console.log('🔍 Server localtime:', serverLocalTime);
console.log(`📦 Found ${expiredItems.length} expired items`);


    for (let item of expiredItems) {
      console.log(`\n⏰ Processing item ${item.item_id}:`);
      console.log('   Item data:', item);  // This will show if host_id is there
      
      // Get highest bid
      const highestBid = await db.get(
        `SELECT bidder_id, bid_amount 
         FROM bids 
         WHERE item_id = ? 
         ORDER BY bid_amount DESC 
         LIMIT 1`,
        [item.item_id]
      );

      console.log('   Highest bid:', highestBid);

      if (highestBid) {
        console.log('   → Has winner, creating order...');
        console.log('   → Data:', {
          item_id: item.item_id,
          bidder_id: highestBid.bidder_id,
          host_id: item.host_id,
          final_price: highestBid.bid_amount
        });
        
        try {
          // Update item
          await db.run(
            `UPDATE ITEMS 
             SET item_status = 'sold', 
                 bidder_id = ?,
                 current_price = ?
             WHERE item_id = ?`,
            [highestBid.bidder_id, highestBid.bid_amount, item.item_id]
          );
          console.log('   ✅ Item updated to sold');

        } catch (updateError) {
          console.error('   ❌ Failed to update item:', updateError);
        }

        // CREATE ORDER
        try {
          console.log('   → Attempting to create order...');
          
          const orderResult = await db.run(
            `INSERT INTO Orders (item_id, bidder_id, host_id, final_price, order_status)
             VALUES (?, ?, ?, ?, ?)`,
            [item.item_id, highestBid.bidder_id, item.host_id, highestBid.bid_amount, 'pending_checkout']
          );
          
          console.log('   ✅✅✅ ORDER CREATED! ID:', orderResult.lastID);
          
          io.emit('auction_ended', {
            item_id: item.item_id,
            winner_id: highestBid.bidder_id,
            final_price: highestBid.bid_amount,
            order_id: orderResult.lastID
          });
          
        } catch (orderError) {
          console.error('   ❌❌❌ FAILED TO CREATE ORDER!');
          console.error('   Error:', orderError.message);
        }
        
      } else {
        // No bids
        console.log('   → No bids, marking as ended');
        
        await db.run(
          `UPDATE ITEMS SET item_status = 'ended' WHERE item_id = ?`,
          [item.item_id]
        );
        
        console.log('   ✅ Item marked as ENDED');

        io.emit('auction_ended', {
          item_id: item.item_id,
          winner_id: null,
          final_price: null
        });
      }
    }

    console.log(`\n✅ Processed ${expiredItems.length} expired items\n`);
    return expiredItems.length;
    
  } catch (error) {
    console.error('❌ Error in checkExpiredAuctions:', error);
    return 0;
  }
}
// ============================================
// DB ROUTES
// ============================================
// Download database file
app.get('/admin/download-db', (req, res) => {
  res.download('./auction.db', 'auction.db');
});


// ============================================
// ADVANCED SQL FEATURES
// ============================================

// 1. Aggregate Query with GROUP BY - Sales by category
app.get('/api/host/stats/category', authenticateToken, async (req, res) => {
  if (req.user.role !== 'host') {
    return res.status(403).json({ error: 'Host access only' });
  }

  try {
    const stats = await db.all(`
      SELECT 
        i.item_category,
        COUNT(*) as total_items,
        COALESCE(SUM(o.final_price), 0) as total_revenue,
        COALESCE(AVG(o.final_price), 0) as avg_price,
        COALESCE(MAX(o.final_price), 0) as highest_sale
      FROM ITEMS i
      LEFT JOIN Orders o ON i.item_id = o.item_id
      WHERE i.host_id = ? AND i.item_status = 'sold'
      GROUP BY i.item_category
      ORDER BY total_revenue DESC
    `, [req.user.id]);

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Set Operation Query - UNION of all users
app.get('/api/admin/active-users', async (req, res) => {
  try {
    const users = await db.all(`
      SELECT host_id as user_id, host_name as name, host_email as email, 'host' as role
      FROM HOST
      UNION
      SELECT bidder_id as user_id, bidder_name as name, bidder_email as email, 'bidder' as role
      FROM BIDDER
      ORDER BY name
    `);

    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. View Query - Active Auctions
app.get('/api/auctions/active', async (req, res) => {
  try {
    const auctions = await db.all('SELECT * FROM ActiveAuctions ORDER BY end_time ASC');
    res.json(auctions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ============================================
// HOST ROUTES
// ============================================

app.post('/api/host/register', async (req, res) => {
  try {
    const { host_name, host_email, host_password, host_phone } = req.body;

    if (!host_name || !host_email || !host_password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const existingHost = await db.get(
      'SELECT * FROM HOST WHERE host_email = ?',
      [host_email]
    );

    if (existingHost) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(host_password, 10);

    const result = await db.run(
      'INSERT INTO HOST (host_name, host_email, host_password, host_phone) VALUES (?, ?, ?, ?)',
      [host_name, host_email, hashedPassword, host_phone || null]
    );

    const token = jwt.sign(
      { id: result.lastID, email: host_email, role: 'host' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'Host registered successfully',
      host_id: result.lastID,
      token: token
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/host/login', async (req, res) => {
  try {
    const { host_email, host_password } = req.body;

    if (!host_email || !host_password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const host = await db.get(
      'SELECT * FROM HOST WHERE host_email = ?',
      [host_email]
    );

    if (!host) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(host_password, host.host_password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: host.host_id, email: host.host_email, role: 'host' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      host_id: host.host_id,
      host_name: host.host_name,
      token: token
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/host/profile', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'host') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const host = await db.get(
      'SELECT host_id, host_name, host_email, host_phone FROM HOST WHERE host_id = ?',
      [req.user.id]
    );

    if (!host) {
      return res.status(404).json({ error: 'Host not found' });
    }

    const items = await db.all(
      `SELECT i.*, 
             (SELECT COUNT(*) FROM bids WHERE item_id = i.item_id) as bid_count
       FROM ITEMS i 
       WHERE host_id = ?
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    // Load images for each item
    for (let item of items) {
      item.images = await db.all(
        'SELECT image_path, is_primary FROM item_images WHERE item_id = ? ORDER BY is_primary DESC',
        [item.item_id]
      );
    }

    res.json({ ...host, items });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// BIDDER ROUTES
// ============================================

app.post('/api/bidder/register', async (req, res) => {
  try {
    const { bidder_name, bidder_email, bidder_password, bidder_phone } = req.body;

    if (!bidder_name || !bidder_email || !bidder_password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const existingBidder = await db.get(
      'SELECT * FROM BIDDER WHERE bidder_email = ?',
      [bidder_email]
    );

    if (existingBidder) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(bidder_password, 10);

    const result = await db.run(
      'INSERT INTO BIDDER (bidder_name, bidder_email, bidder_password, bidder_phone) VALUES (?, ?, ?, ?)',
      [bidder_name, bidder_email, hashedPassword, bidder_phone || null]
    );

    const token = jwt.sign(
      { id: result.lastID, email: bidder_email, role: 'bidder' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'Bidder registered successfully',
      bidder_id: result.lastID,
      token: token
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bidder/login', async (req, res) => {
  try {
    const { bidder_email, bidder_password } = req.body;

    if (!bidder_email || !bidder_password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const bidder = await db.get(
      'SELECT * FROM BIDDER WHERE bidder_email = ?',
      [bidder_email]
    );

    if (!bidder) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(bidder_password, bidder.bidder_password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: bidder.bidder_id, email: bidder.bidder_email, role: 'bidder' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      bidder_id: bidder.bidder_id,
      bidder_name: bidder.bidder_name,
      token: token
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bidder/profile', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'bidder') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const bidder = await db.get(
      'SELECT bidder_id, bidder_name, bidder_email, bidder_phone, created_at FROM BIDDER WHERE bidder_id = ?',
      [req.user.id]
    );

    if (!bidder) {
      return res.status(404).json({ error: 'Bidder not found' });
    }

    const wonItems = await db.all(
      `SELECT * FROM ITEMS WHERE bidder_id = ? AND item_status = 'sold'`,
      [req.user.id]
    );

    res.json({
      ...bidder,
      items_won: wonItems.length,
      won_items: wonItems
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ITEM ROUTES
// ============================================

app.post('/api/items', authenticate, upload.array('images', 3), async (req, res) => {
  try {
    // Only hosts can create items
    if (req.user.role !== 'host') {
      return res.status(403).json({ error: 'Only hosts can create items' });
    }

    const { item_name, item_description, item_category, initial_price, end_time } = req.body;

    if (!item_name || !item_description || !item_category || !initial_price || !end_time) {
      return res.status(400).json({ error: 'All fields are required' });
    }

const endTimeFormatted = end_time;

    // Insert item (current_price starts same as initial_price)
    const result = await db.run(
      `INSERT INTO ITEMS (item_name, item_description, item_category, initial_price, current_price, host_id, item_status, end_time) 
       VALUES (?, ?, ?, ?, ?, ?, 'available', ?)`,
      [item_name, item_description, item_category, initial_price, initial_price, req.user.id, endTimeFormatted]
    );

    const itemId = result.lastID;

    // Handle images
// Handle images
if (req.files && req.files.length > 0) {
  for (let i = 0; i < req.files.length; i++) {
    // Extract only the relative path (remove absolute path)
    const fullPath = req.files[i].path;
    const relativePath = fullPath.replace(/\\/g, '/').split('uploads/')[1];
    const imagePath = `uploads/${relativePath}`;
    
    console.log('💾 Saving image path:', imagePath);
    
    const isPrimary = i === 0 ? 1 : 0;
    
    await db.run(
      'INSERT INTO item_images (item_id, image_path, is_primary) VALUES (?, ?, ?)',
      [itemId, imagePath, isPrimary]
    );
  }
}

    res.status(201).json({
      message: 'Item created successfully',
      item_id: itemId
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/items', async (req, res) => {
  try {
    // Check for expired auctions first
    await checkExpiredAuctions();

    const { category, status } = req.query;
    
    let query = `
      SELECT i.*, 
             (SELECT COUNT(*) FROM bids WHERE item_id = i.item_id) as bid_count
      FROM ITEMS i
      WHERE 1=1
    `;
    const params = [];

    if (category) {
      query += ' AND i.item_category = ?';
      params.push(category);
    }

    if (status) {
      query += ' AND i.item_status = ?';
      params.push(status);
    }

    query += ' ORDER BY i.created_at DESC';

    const items = await db.all(query, params);

    // Get images for each item
    for (let item of items) {
      item.images = await db.all(
        'SELECT image_path, is_primary FROM item_images WHERE item_id = ? ORDER BY is_primary DESC',
        [item.item_id]
      );
    }

    res.json(items);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/items/:id', async (req, res) => {
  try {
    const item = await db.get(
      'SELECT * FROM ITEMS WHERE item_id = ?',
      [req.params.id]
    );

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const images = await db.all(
      'SELECT image_path, is_primary FROM item_images WHERE item_id = ?',
      [item.item_id]
    );

    const host = await db.get(
      'SELECT host_id, host_name FROM HOST WHERE host_id = ?',
      [item.host_id]
    );

    const bids = await db.all(
      `SELECT b.*, bi.bidder_name 
       FROM bids b 
       JOIN BIDDER bi ON b.bidder_id = bi.bidder_id 
       WHERE b.item_id = ? 
       ORDER BY b.bid_time DESC`,
      [item.item_id]
    );

    res.json({
      ...item,
      images,
      host,
      bids
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/items/:id/bids', async (req, res) => {
  try {
    const bids = await db.all(
      `SELECT b.*, bi.bidder_name 
       FROM bids b 
       JOIN BIDDER bi ON b.bidder_id = bi.bidder_id 
       WHERE b.item_id = ? 
       ORDER BY b.bid_time DESC`,
      [req.params.id]
    );

    res.json(bids);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check expired auctions manually
app.post('/api/auctions/check-expired', async (req, res) => {
  try {
    const expiredCount = await checkExpiredAuctions();
    res.json({ 
      message: 'Expired auctions checked',
      expired_count: expiredCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// BIDDING ROUTES (NEW!)
// ============================================

// Place a bid
app.post('/api/bids', authenticate, async (req, res) => {
  try {
    // Only bidders can place bids
    if (req.user.role !== 'bidder') {
      return res.status(403).json({ error: 'Only bidders can place bids' });
    }

    const { item_id, bid_amount } = req.body;

    if (!item_id || !bid_amount) {
      return res.status(400).json({ error: 'Item ID and bid amount are required' });
    }

    // Get item details
    const item = await db.get('SELECT * FROM ITEMS WHERE item_id = ?', [item_id]);

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Check if auction has ended - USE PROPER DATETIME COMPARISON
    const now = new Date();
    const endTime = new Date(item.end_time);
    
    console.log('🕐 Bid validation:');
    console.log('   Current time:', now.toISOString());
    console.log('   End time:', endTime.toISOString());
    console.log('   Has ended:', endTime <= now);

    if (endTime <= now) {
      return res.status(400).json({ error: 'Auction has ended' });
    }

    // Check if item is available
    if (item.item_status !== 'available') {
      return res.status(400).json({ error: 'Item is not available for bidding' });
    }

    // Validate bid amount
    if (parseFloat(bid_amount) <= parseFloat(item.current_price)) {
      return res.status(400).json({ 
        error: `Bid must be higher than current price ($${item.current_price})` 
      });
    }

    // Insert bid
    const result = await db.run(
      'INSERT INTO bids (item_id, bidder_id, bid_amount) VALUES (?, ?, ?)',
      [item_id, req.user.id, bid_amount]
    );

    // Update current price
    await db.run(
      'UPDATE ITEMS SET current_price = ? WHERE item_id = ?',
      [bid_amount, item_id]
    );

    // Emit WebSocket event
    io.emit('new_bid', {
      item_id,
      bidder_id: req.user.id,
      bid_amount,
      bid_id: result.lastID
    });

    res.json({
      message: 'Bid placed successfully',
      bid_id: result.lastID,
      new_price: bid_amount
    });

  } catch (error) {
    console.error('Bid error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== SHIPPING ADDRESS ROUTES ====================

// Get bidder's addresses
app.get('/api/bidder/addresses', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'bidder') {
      return res.status(403).json({ error: 'Only bidders can access addresses' });
    }

    const addresses = await db.all(
      'SELECT * FROM Shipping_address WHERE bidder_id = ? ORDER BY is_default DESC, created_at DESC',
      [req.user.id]
    );

    res.json(addresses);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add new address
app.post('/api/bidder/addresses', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'bidder') {
      return res.status(403).json({ error: 'Only bidders can add addresses' });
    }

    const { address_line1, address_line2, city, state, postal_code, country, is_default } = req.body;

    if (!address_line1 || !city || !state || !postal_code || !country) {
      return res.status(400).json({ error: 'Required fields: address_line1, city, state, postal_code, country' });
    }

    // If this is default, unset other defaults
    if (is_default) {
      await db.run(
        'UPDATE Shipping_address SET is_default = 0 WHERE bidder_id = ?',
        [req.user.id]
      );
    }

    const result = await db.run(
      `INSERT INTO Shipping_address (bidder_id, address_line1, address_line2, city, state, postal_code, country, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, address_line1, address_line2 || null, city, state, postal_code, country, is_default ? 1 : 0]
    );

    res.status(201).json({
      message: 'Address added successfully',
      address_id: result.lastID
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete address
app.delete('/api/bidder/addresses/:id', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'bidder') {
      return res.status(403).json({ error: 'Only bidders can delete addresses' });
    }

    await db.run(
      'DELETE FROM Shipping_address WHERE address_id = ? AND bidder_id = ?',
      [req.params.id, req.user.id]
    );

    res.json({ message: 'Address deleted successfully' });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PAYMENT METHOD ROUTES ====================

// Get bidder's payment methods
app.get('/api/bidder/payment-methods', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'bidder') {
      return res.status(403).json({ error: 'Only bidders can access payment methods' });
    }

    const methods = await db.all(
      'SELECT * FROM Payment_method WHERE bidder_id = ? ORDER BY is_default DESC, created_at DESC',
      [req.user.id]
    );

    res.json(methods);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add payment method
app.post('/api/bidder/payment-methods', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'bidder') {
      return res.status(403).json({ error: 'Only bidders can add payment methods' });
    }

    const { payment_type, card_last_four, card_brand, expiry_month, expiry_year, is_default } = req.body;

    if (!payment_type) {
      return res.status(400).json({ error: 'Payment type is required' });
    }

    // If this is default, unset other defaults
    if (is_default) {
      await db.run(
        'UPDATE Payment_method SET is_default = 0 WHERE bidder_id = ?',
        [req.user.id]
      );
    }

    const result = await db.run(
      `INSERT INTO Payment_method (bidder_id, payment_type, card_last_four, card_brand, expiry_month, expiry_year, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, payment_type, card_last_four || null, card_brand || null, expiry_month || null, expiry_year || null, is_default ? 1 : 0]
    );

    res.status(201).json({
      message: 'Payment method added successfully',
      payment_id: result.lastID
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete payment method
app.delete('/api/bidder/payment-methods/:id', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'bidder') {
      return res.status(403).json({ error: 'Only bidders can delete payment methods' });
    }

    await db.run(
      'DELETE FROM Payment_method WHERE payment_id = ? AND bidder_id = ?',
      [req.params.id, req.user.id]
    );

    res.json({ message: 'Payment method deleted successfully' });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== ORDER ROUTES ====================

// Get bidder's orders (won items needing checkout)
// Get bidder's orders (won items needing checkout)
app.get('/api/bidder/orders', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'bidder') {
      return res.status(403).json({ error: 'Only bidders can access orders' });
    }

    const orders = await db.all(
      `SELECT o.*, i.item_name, i.item_description, i.item_category,
              h.host_name, h.host_email,
              p.payment_type, p.card_last_four, p.card_brand,
              a.address_line1, a.city, a.state, a.postal_code, a.country
       FROM Orders o
       JOIN ITEMS i ON o.item_id = i.item_id
       JOIN HOST h ON o.host_id = h.host_id
       LEFT JOIN Payment_method p ON o.payment_id = p.payment_id
       LEFT JOIN Shipping_address a ON o.address_id = a.address_id
       WHERE o.bidder_id = ?
       ORDER BY o.order_date DESC`,
      [req.user.id]
    );

    res.json(orders);

  } catch (error) {
    console.error('Error loading bidder orders:', error);
    res.status(500).json({ error: error.message });
  }
});

// Complete checkout (select payment and shipping)
// 3. TRANSACTION - Checkout with BEGIN/COMMIT/ROLLBACK
app.post('/api/orders/:id/checkout', authenticateToken, async (req, res) => {
  if (req.user.role !== 'bidder') {
    return res.status(403).json({ error: 'Bidder access only' });
  }

  const { payment_id, address_id } = req.body;

  // START TRANSACTION
  await db.run('BEGIN TRANSACTION');

  try {
    // 1. Verify order belongs to bidder
    const order = await db.get(
      'SELECT * FROM Orders WHERE order_id = ? AND bidder_id = ?',
      [req.params.id, req.user.id]
    );

    if (!order) {
      await db.run('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.order_status !== 'pending_checkout') {
      await db.run('ROLLBACK');
      return res.status(400).json({ error: 'Order already completed' });
    }

    // 2. Update order with payment and address
    await db.run(
      `UPDATE Orders 
       SET payment_id = ?, address_id = ?, order_status = 'completed', 
           order_date = datetime('now')
       WHERE order_id = ?`,
      [payment_id, address_id, req.params.id]
    );

    // 3. Update item status
    await db.run(
      `UPDATE ITEMS SET item_status = 'completed' WHERE item_id = ?`,
      [order.item_id]
    );

    // COMMIT TRANSACTION
    await db.run('COMMIT');
    console.log('✅ Transaction committed successfully');

    res.json({ message: 'Checkout successful!' });
  } catch (error) {
    // ROLLBACK ON ERROR
    await db.run('ROLLBACK');
    console.error('❌ Transaction rolled back:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get host's orders (items they sold)
app.get('/api/host/orders', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'host') {
      return res.status(403).json({ error: 'Only hosts can access orders' });
    }

    const orders = await db.all(
      `SELECT o.*, i.item_name, i.item_description,
              b.bidder_name, b.bidder_email,
              a.address_line1, a.address_line2, a.city, a.state, a.postal_code, a.country
       FROM Orders o
       JOIN ITEMS i ON o.item_id = i.item_id
       JOIN BIDDER b ON o.bidder_id = b.bidder_id
       LEFT JOIN Shipping_address a ON o.address_id = a.address_id
       WHERE o.host_id = ?
       ORDER BY o.order_date DESC`,
      [req.user.id]
    );

    res.json(orders);

  } catch (error) {
    console.error('Error loading host orders:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update order status (host marks as shipped)
app.patch('/api/orders/:id/status', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'host') {
      return res.status(403).json({ error: 'Only hosts can update order status' });
    }

    const { order_status } = req.body;

    if (!order_status) {
      return res.status(400).json({ error: 'Order status is required' });
    }

    // Verify order belongs to this host
    const order = await db.get(
      'SELECT * FROM Orders WHERE order_id = ? AND host_id = ?',
      [req.params.id, req.user.id]
    );

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    await db.run(
      'UPDATE Orders SET order_status = ? WHERE order_id = ?',
      [order_status, req.params.id]
    );

    res.json({ message: 'Order status updated successfully' });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// WEBSOCKET CONNECTION
// ============================================
io.on('connection', (socket) => {
  console.log('✅ Client connected via WebSocket');

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected');
  });
});

// ============================================
// START SERVER
// ============================================
server.listen(PORT, () => {
  console.log(`✅ WebSocket server running`);
  console.log(`✅ Normalized database (BCNF compliant)`);
  console.log(`\n📋 Available endpoints:`);
  console.log(`   POST /api/host/register`);
  console.log(`   POST /api/host/login`);
  console.log(`   GET  /api/host/profile`);
  console.log(`   POST /api/bidder/register`);
  console.log(`   POST /api/bidder/login`);
  console.log(`   GET  /api/bidder/profile`);
  console.log(`   POST /api/items`);
  console.log(`   GET  /api/items`);
  console.log(`   GET  /api/items/:id`);
  console.log(`   POST /api/bids (real-time)`);
  console.log(`   GET  /api/items/:id/bids`);
  console.log(`   POST /api/auctions/check-expired`);
});


// DEBUG: Test order creation
app.get('/api/debug/create-order', async (req, res) => {
  try {
    console.log('🧪 Testing order creation...');
    
    // Get a sold item
    const item = await db.get(
      'SELECT * FROM ITEMS WHERE item_status = "sold" LIMIT 1'
    );
    
    if (!item) {
      return res.json({ error: 'No sold items found' });
    }
    
    console.log('Item:', item);
    
    // Try to create order
    const orderResult = await db.run(
      `INSERT INTO Orders (item_id, bidder_id, host_id, final_price, order_status)
       VALUES (?, ?, ?, ?, ?)`,
      [item.item_id, item.bidder_id, item.host_id, item.current_price, 'pending_checkout']
    );
    
    console.log('Order created:', orderResult.lastID);
    
    // Verify
    const order = await db.get('SELECT * FROM Orders WHERE order_id = ?', [orderResult.lastID]);
    
    res.json({
      success: true,
      order_id: orderResult.lastID,
      order: order
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.json({
      success: false,
      error: error.message,
      code: error.code
    });
  }
});
