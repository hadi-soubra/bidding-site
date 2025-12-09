const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const API_URL = 'http://localhost:3000/api';

async function testItems() {
  console.log('🧪 Starting Item Management Tests...\n');

  try {
    // First, login as a host to get token
    console.log('Step 1: Logging in as host...');
    const hostLogin = await axios.post(`${API_URL}/host/login`, {
      host_email: 'seller@test.com',
      host_password: 'password123'
    });
    const hostToken = hostLogin.data.token;
    console.log(`✅ Host logged in\n`);

    // TEST 1: Create item without images
    console.log('TEST 1: Creating item without images...');
    const item1 = await axios.post(`${API_URL}/items`, {
      item_name: 'Vintage Watch',
      initial_price: 100,
      end_time: '2025-12-31 23:59:59',
      category: 'Accessories',
      description: 'Beautiful vintage watch in excellent condition'
    }, {
      headers: { Authorization: `Bearer ${hostToken}` }
    });
    console.log(`✅ Item created: ID ${item1.data.item_id}`);
    console.log(`✅ Images uploaded: ${item1.data.images_uploaded}\n`);

    // TEST 2: Create another item
    console.log('TEST 2: Creating another item...');
    const item2 = await axios.post(`${API_URL}/items`, {
      item_name: 'Gaming Laptop',
      initial_price: 500,
      end_time: '2025-12-31 23:59:59',
      category: 'Electronics',
      description: 'High-end gaming laptop with RTX graphics'
    }, {
      headers: { Authorization: `Bearer ${hostToken}` }
    });
    console.log(`✅ Item created: ID ${item2.data.item_id}\n`);

    // TEST 3: Get all items
    console.log('TEST 3: Getting all items...');
    const allItems = await axios.get(`${API_URL}/items`);
    console.log(`✅ Found ${allItems.data.length} items:`);
    allItems.data.forEach(item => {
      console.log(`   - ${item.item_name} ($${item.current_price})`);
    });
    console.log();

    // TEST 4: Get items by category
    console.log('TEST 4: Filtering items by category (Electronics)...');
    const electronicsItems = await axios.get(`${API_URL}/items?category=Electronics`);
    console.log(`✅ Found ${electronicsItems.data.length} electronics items\n`);

    // TEST 5: Get single item details
    console.log('TEST 5: Getting item details...');
    const itemDetails = await axios.get(`${API_URL}/items/${item1.data.item_id}`);
    console.log(`✅ Item details:`);
    console.log(`   Name: ${itemDetails.data.item_name}`);
    console.log(`   Price: $${itemDetails.data.current_price}`);
    console.log(`   Host: ${itemDetails.data.host.host_name}`);
    console.log(`   Images: ${itemDetails.data.images.length}`);
    console.log(`   Bids: ${itemDetails.data.bids.length}\n`);

    // TEST 6: Check host profile shows items
    console.log('TEST 6: Checking host profile...');
    const hostProfile = await axios.get(`${API_URL}/host/profile`, {
      headers: { Authorization: `Bearer ${hostToken}` }
    });
    console.log(`✅ Host has ${hostProfile.data.items_count} items listed\n`);

    console.log('🎉 All item management tests passed!');

  } catch (error) {
    if (error.response) {
      console.error('❌ Test failed:', error.response.data);
    } else {
      console.error('❌ Test failed:', error.message);
    }
  }
}

testItems();
