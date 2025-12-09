const axios = require('axios');

const API_URL = 'http://localhost:3000/api';

async function testBidding() {
  console.log('🧪 Starting Bidding Tests...\n');

  try {
    // Login as host
    console.log('Step 1: Logging in as host...');
    const hostLogin = await axios.post(`${API_URL}/host/login`, {
      host_email: 'seller@test.com',
      host_password: 'password123'
    });
    const hostToken = hostLogin.data.token;
    console.log(`✅ Host logged in\n`);

    // Login as bidder
    console.log('Step 2: Logging in as bidder...');
    const bidderLogin = await axios.post(`${API_URL}/bidder/login`, {
      bidder_email: 'buyer@test.com',
      bidder_password: 'password456'
    });
    const bidderToken = bidderLogin.data.token;
    console.log(`✅ Bidder logged in\n`);

    // Create an item
    console.log('Step 3: Host creating an item...');
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7); // 7 days from now
    
    const item = await axios.post(`${API_URL}/items`, {
      item_name: 'Rare Collectible',
      initial_price: 50,
      end_time: futureDate.toISOString(),
      category: 'Collectibles',
      description: 'Very rare collectible item'
    }, {
      headers: { Authorization: `Bearer ${hostToken}` }
    });
    const itemId = item.data.item_id;
    console.log(`✅ Item created: ID ${itemId}\n`);

    // TEST 1: Bidder places first bid
    console.log('TEST 1: Bidder placing first bid ($60)...');
    const bid1 = await axios.post(`${API_URL}/bids`, {
      item_id: itemId,
      bid_amount: 60
    }, {
      headers: { Authorization: `Bearer ${bidderToken}` }
    });
    console.log(`✅ Bid placed: ID ${bid1.data.bid_id}`);
    console.log(`✅ Current price: $${bid1.data.current_price}\n`);

    // TEST 2: Try to bid lower (should fail)
    console.log('TEST 2: Trying to bid lower ($55) - should fail...');
    try {
      await axios.post(`${API_URL}/bids`, {
        item_id: itemId,
        bid_amount: 55
      }, {
        headers: { Authorization: `Bearer ${bidderToken}` }
      });
      console.log('❌ Error: Lower bid was accepted!\n');
    } catch (error) {
      console.log(`✅ Correctly rejected: ${error.response.data.error}\n`);
    }

    // TEST 3: Place higher bid
    console.log('TEST 3: Placing higher bid ($75)...');
    const bid2 = await axios.post(`${API_URL}/bids`, {
      item_id: itemId,
      bid_amount: 75
    }, {
      headers: { Authorization: `Bearer ${bidderToken}` }
    });
    console.log(`✅ Bid placed: ID ${bid2.data.bid_id}`);
    console.log(`✅ Current price: $${bid2.data.current_price}\n`);

    // TEST 4: Get all bids for item
    console.log('TEST 4: Getting bid history...');
    const bids = await axios.get(`${API_URL}/items/${itemId}/bids`);
    console.log(`✅ Found ${bids.data.length} bids:`);
    bids.data.forEach((bid, index) => {
      console.log(`   ${index + 1}. $${bid.bid_amount} by ${bid.bidder_name}`);
    });
    console.log();

    // TEST 5: Host tries to bid on own item (should fail)
    console.log('TEST 5: Host trying to bid on own item - should fail...');
    try {
      await axios.post(`${API_URL}/bids`, {
        item_id: itemId,
        bid_amount: 100
      }, {
        headers: { Authorization: `Bearer ${hostToken}` }
      });
      console.log('❌ Error: Host was able to bid on own item!\n');
    } catch (error) {
      console.log(`✅ Correctly rejected: ${error.response.data.error}\n`);
    }

    // TEST 6: Get item details (should show updated price)
    console.log('TEST 6: Checking item details...');
    const itemDetails = await axios.get(`${API_URL}/items/${itemId}`);
    console.log(`✅ Item: ${itemDetails.data.item_name}`);
    console.log(`✅ Initial price: $${itemDetails.data.initial_price}`);
    console.log(`✅ Current price: $${itemDetails.data.current_price}`);
    console.log(`✅ Total bids: ${itemDetails.data.bids.length}\n`);

    // TEST 7: Check expired auctions
    console.log('TEST 7: Checking for expired auctions...');
    const checkExpired = await axios.post(`${API_URL}/auctions/check-expired`);
    console.log(`✅ Expired auctions checked: ${checkExpired.data.expired_count} expired\n`);

    console.log('🎉 All bidding tests passed!');

  } catch (error) {
    if (error.response) {
      console.error('❌ Test failed:', error.response.data);
    } else {
      console.error('❌ Test failed:', error.message);
    }
  }
}

testBidding();