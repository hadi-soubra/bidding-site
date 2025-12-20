const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

async function initDatabase() {
  const db = await open({
    filename: path.join(__dirname, 'auction.db'),
    driver: sqlite3.Database
  });

  await db.exec('PRAGMA foreign_keys = ON;');

  await db.exec(`
    -- BIDDER table
    CREATE TABLE IF NOT EXISTS BIDDER (
      bidder_id INTEGER PRIMARY KEY AUTOINCREMENT,
      bidder_name TEXT NOT NULL,
      bidder_email TEXT UNIQUE NOT NULL,
      bidder_password TEXT NOT NULL,
      bidder_phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- HOST table
    CREATE TABLE IF NOT EXISTS HOST (
      host_id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_name TEXT NOT NULL,
      host_email TEXT UNIQUE NOT NULL,
      host_password TEXT NOT NULL,
      host_phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ITEMS table
    CREATE TABLE IF NOT EXISTS ITEMS (
      item_id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name TEXT NOT NULL,
      item_description TEXT,
      initial_price REAL NOT NULL,
      current_price REAL NOT NULL,
      end_time DATETIME NOT NULL,
      item_category TEXT NOT NULL,
      item_status TEXT DEFAULT 'available',
      host_id INTEGER NOT NULL,
      bidder_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (host_id) REFERENCES HOST(host_id),
      FOREIGN KEY (bidder_id) REFERENCES BIDDER(bidder_id)
    );

    -- Item images table
    CREATE TABLE IF NOT EXISTS item_images (
      image_id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      image_path TEXT NOT NULL,
      is_primary INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES ITEMS(item_id) ON DELETE CASCADE
    );

    -- Bids table
    CREATE TABLE IF NOT EXISTS bids (
      bid_id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      bidder_id INTEGER NOT NULL,
      bid_amount REAL NOT NULL,
      bid_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES ITEMS(item_id) ON DELETE CASCADE,
      FOREIGN KEY (bidder_id) REFERENCES BIDDER(bidder_id) ON DELETE CASCADE
    );

    -- Shipping_address table
    CREATE TABLE IF NOT EXISTS Shipping_address (
      address_id INTEGER PRIMARY KEY AUTOINCREMENT,
      bidder_id INTEGER NOT NULL,
      address_line1 TEXT NOT NULL,
      address_line2 TEXT,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      country TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bidder_id) REFERENCES BIDDER(bidder_id) ON DELETE CASCADE
    );

    -- Payment_method table
    CREATE TABLE IF NOT EXISTS Payment_method (
      payment_id INTEGER PRIMARY KEY AUTOINCREMENT,
      bidder_id INTEGER NOT NULL,
      payment_type TEXT NOT NULL,
      card_last_four TEXT,
      card_brand TEXT,
      expiry_month INTEGER,
      expiry_year INTEGER,
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bidder_id) REFERENCES BIDDER(bidder_id) ON DELETE CASCADE
    );

    -- Orders table
CREATE TABLE IF NOT EXISTS Orders (
  order_id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  bidder_id INTEGER NOT NULL,
  host_id INTEGER NOT NULL,
  final_price REAL NOT NULL,
  payment_id INTEGER,
  address_id INTEGER,
  order_status TEXT DEFAULT 'pending',
  order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_id) REFERENCES ITEMS(item_id),
  FOREIGN KEY (bidder_id) REFERENCES BIDDER(bidder_id),
  FOREIGN KEY (host_id) REFERENCES HOST(host_id),
  FOREIGN KEY (payment_id) REFERENCES Payment_method(payment_id),
  FOREIGN KEY (address_id) REFERENCES Shipping_address(address_id)
);

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_items_host ON ITEMS(host_id);
    CREATE INDEX IF NOT EXISTS idx_items_bidder ON ITEMS(bidder_id);
    CREATE INDEX IF NOT EXISTS idx_items_status ON ITEMS(item_status);
    CREATE INDEX IF NOT EXISTS idx_items_end_time ON ITEMS(end_time);
    CREATE INDEX IF NOT EXISTS idx_bids_item ON bids(item_id);
    CREATE INDEX IF NOT EXISTS idx_item_images_item ON item_images(item_id);
    CREATE INDEX IF NOT EXISTS idx_shipping_address_bidder ON Shipping_address(bidder_id);
    CREATE INDEX IF NOT EXISTS idx_payment_method_bidder ON Payment_method(bidder_id);
    CREATE INDEX IF NOT EXISTS idx_orders_item ON Orders(item_id);
    CREATE INDEX IF NOT EXISTS idx_orders_bidder ON Orders(bidder_id);
    CREATE INDEX IF NOT EXISTS idx_orders_host ON Orders(host_id);
  `);

  // ============= VIEWS =============
await db.exec(`
  CREATE VIEW IF NOT EXISTS ActiveAuctions AS
  SELECT 
    i.item_id,
    i.item_name,
    i.item_category,
    i.current_price,
    i.end_time,
    h.host_name,
    COUNT(b.bid_id) as bid_count,
    MAX(b.bid_amount) as highest_bid
  FROM ITEMS i
  JOIN HOST h ON i.host_id = h.host_id
  LEFT JOIN bids b ON i.item_id = b.item_id
  WHERE i.item_status = 'available'
    AND datetime(i.end_time) > datetime('now')
  GROUP BY i.item_id
`);

console.log('✅ Views created');

// ============= TRIGGERS =============
await db.exec(`
  CREATE TRIGGER IF NOT EXISTS update_item_price_on_bid
  AFTER INSERT ON bids
  BEGIN
    UPDATE ITEMS
    SET current_price = NEW.bid_amount
    WHERE item_id = NEW.item_id
      AND NEW.bid_amount > current_price;
  END;
`);

console.log('✅ Triggers created');

  console.log('✅ Database initialized with Payment, Shipping, and Address tables');
  
  return db;
}

module.exports = { initDatabase };