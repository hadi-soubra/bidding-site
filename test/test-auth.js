const axios = require('axios');

const API_URL = 'http://localhost:3000/api';

async function testAuthentication() {
  console.log('🧪 Starting Authentication Tests...\n');

  try {
    // TEST 1: Register a HOST
    console.log('TEST 1: Registering a host...');
    const hostRegister = await axios.post(`${API_URL}/host/register`, {
      host_name: 'Test Seller',
      host_email: 'seller@test.com',
      host_password: 'password123',
      host_phone: '+1234567890'
    });
    console.log(`✅ Host registered: ${hostRegister.data.host_id}`);
    const hostToken = hostRegister.data.token;
    console.log(`✅ Host token received\n`);

    // TEST 2: Login HOST
    console.log('TEST 2: Logging in as host...');
    const hostLogin = await axios.post(`${API_URL}/host/login`, {
      host_email: 'seller@test.com',
      host_password: 'password123'
    });
    console.log(`✅ Host logged in: ${hostLogin.data.host_name}\n`);

    // TEST 3: Get HOST profile
    console.log('TEST 3: Getting host profile...');
    const hostProfile = await axios.get(`${API_URL}/host/profile`, {
      headers: { Authorization: `Bearer ${hostToken}` }
    });
    console.log(`✅ Host profile:`);
    console.log(`   Name: ${hostProfile.data.host_name}`);
    console.log(`   Email: ${hostProfile.data.host_email}`);
    console.log(`   Items: ${hostProfile.data.items_count}\n`);

    // TEST 4: Register a BIDDER
    console.log('TEST 4: Registering a bidder...');
    const bidderRegister = await axios.post(`${API_URL}/bidder/register`, {
      bidder_name: 'Test Buyer',
      bidder_email: 'buyer@test.com',
      bidder_password: 'password456',
      bidder_phone: '+0987654321'
    });
    console.log(`✅ Bidder registered: ${bidderRegister.data.bidder_id}`);
    const bidderToken = bidderRegister.data.token;
    console.log(`✅ Bidder token received\n`);

    // TEST 5: Login BIDDER
    console.log('TEST 5: Logging in as bidder...');
    const bidderLogin = await axios.post(`${API_URL}/bidder/login`, {
      bidder_email: 'buyer@test.com',
      bidder_password: 'password456'
    });
    console.log(`✅ Bidder logged in: ${bidderLogin.data.bidder_name}\n`);

    // TEST 6: Get BIDDER profile
    console.log('TEST 6: Getting bidder profile...');
    const bidderProfile = await axios.get(`${API_URL}/bidder/profile`, {
      headers: { Authorization: `Bearer ${bidderToken}` }
    });
    console.log(`✅ Bidder profile:`);
    console.log(`   Name: ${bidderProfile.data.bidder_name}`);
    console.log(`   Email: ${bidderProfile.data.bidder_email}`);
    console.log(`   Items Won: ${bidderProfile.data.items_won}\n`);

    // TEST 7: Try accessing host profile with bidder token (should fail)
    console.log('TEST 7: Testing authorization (bidder trying host endpoint)...');
    try {
      await axios.get(`${API_URL}/host/profile`, {
        headers: { Authorization: `Bearer ${bidderToken}` }
      });
      console.log('❌ Security issue: Bidder accessed host endpoint!');
    } catch (error) {
      if (error.response && error.response.status === 403) {
        console.log('✅ Authorization working: Access denied as expected\n');
      }
    }

    console.log('🎉 All authentication tests passed!');

  } catch (error) {
    if (error.response) {
      console.error('❌ Test failed:', error.response.data);
    } else if (error.code === 'ECONNREFUSED') {
      console.error('❌ Server not running! Start it with: npm start');
    } else {
      console.error('❌ Test failed:', error.message);
    }
  }
}

testAuthentication();