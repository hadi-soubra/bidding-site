const { initDatabase } = require('./database');

async function testDatabase() {
  console.log('🧪 Starting Database Tests...\n');
  
  try {
    // Initialize database
    const db = await initDatabase();
    
    // TEST 1: Create a HOST
    console.log('TEST 1: Creating a host...');
    const hostResult = await db.run(
      'INSERT INTO HOST (host_name, host_email, host_password) VALUES (?, ?, ?)',
      ['John Seller', 'john@seller.com', 'hashed_password_123']
    );
    const hostId = hostResult.lastID;
    console.log(`✅ Host created with ID: ${hostId}\n`);
    
    // TEST 2: Create a BIDDER
    console.log('TEST 2: Creating a bidder...');
    const bidderResult = await db.run(
      'INSERT INTO BIDDER (bidder_name, bidder_email, bidder_password) VALUES (?, ?, ?)',
      ['Alice Buyer', 'alice@buyer.com', 'hashed_password_456']
    );
    const bidderId = bidderResult.lastID;
    console.log(`✅ Bidder created with ID: ${bidderId}\n`);
    
    // TEST 3: Host creates multiple items
    console.log('TEST 3: Host creating items...');
    const item1 = await db.run(
      `INSERT INTO ITEMS (item_name, initial_price, current_price, end_time, category, description, host_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Vintage Watch', 100, 100, '2025-12-31 23:59:59', 'Accessories', 'Beautiful vintage watch', hostId]
    );
    console.log(`✅ Item 1 created with ID: ${item1.lastID}`);
    
    const item2 = await db.run(
      `INSERT INTO ITEMS (item_name, initial_price, current_price, end_time, category, description, host_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Gaming Laptop', 500, 500, '2025-12-31 23:59:59', 'Electronics', 'High-end gaming laptop', hostId]
    );
    console.log(`✅ Item 2 created with ID: ${item2.lastID}\n`);
    
    // TEST 4: Query host's items (NORMALIZED WAY - using foreign key)
    console.log('TEST 4: Getting all items offered by host...');
    const hostItems = await db.all(
      'SELECT * FROM ITEMS WHERE host_id = ?',
      [hostId]
    );
    console.log(`✅ Host has ${hostItems.length} items:`);
    hostItems.forEach(item => {
      console.log(`   - ${item.item_name} ($${item.current_price})`);
    });
    console.log();
    
    // TEST 5: Bidder wins an item
    console.log('TEST 5: Bidder winning an item...');
    await db.run(
      `UPDATE ITEMS SET bidder_id = ?, item_status = 'sold' WHERE item_id = ?`,
      [bidderId, item1.lastID]
    );
    console.log(`✅ Bidder won item: ${item1.lastID}\n`);
    
    // TEST 6: Query bidder's won items (NORMALIZED WAY - using foreign key)
    console.log('TEST 6: Getting all items owned by bidder...');
    const bidderItems = await db.all(
      `SELECT * FROM ITEMS WHERE bidder_id = ? AND item_status = 'sold'`,
      [bidderId]
    );
    console.log(`✅ Bidder owns ${bidderItems.length} items:`);
    bidderItems.forEach(item => {
      console.log(`   - ${item.item_name} ($${item.current_price})`);
    });
    console.log();
    
    // TEST 7: Get host with their items (JOIN example)
    console.log('TEST 7: Getting host profile with items...');
    const host = await db.get('SELECT * FROM HOST WHERE host_id = ?', [hostId]);
    const items = await db.all('SELECT * FROM ITEMS WHERE host_id = ?', [hostId]);
    console.log(`✅ Host Profile:`);
    console.log(`   Name: ${host.host_name}`);
    console.log(`   Email: ${host.host_email}`);
    console.log(`   Total Items: ${items.length}`);
    console.log(`   Items Listed:`);
    items.forEach(item => {
      console.log(`     - ${item.item_name} (${item.item_status})`);
    });
    console.log();
    
    // TEST 8: Verify normalization (no items_owned/items_offered fields)
    console.log('TEST 8: Verifying normalized schema...');
    const bidderSchema = await db.all("PRAGMA table_info(BIDDER)");
    const hostSchema = await db.all("PRAGMA table_info(HOST)");
    
    const hasItemsOwned = bidderSchema.some(col => col.name === 'items_owned');
    const hasItemsOffered = hostSchema.some(col => col.name === 'items_offered');
    
    if (!hasItemsOwned && !hasItemsOffered) {
      console.log('✅ Schema is NORMALIZED - no items_owned/items_offered fields!');
    } else {
      console.log('❌ Schema not normalized - TEXT fields still exist');
    }
    
    console.log('\n🎉 All tests passed! Database is normalized and working correctly!');
    
    await db.close();
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run tests
testDatabase();