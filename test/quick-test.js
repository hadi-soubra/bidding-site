const http = require('http');

console.log('Testing server connection...');

const data = JSON.stringify({
  host_name: 'Test Host',
  host_email: 'test@example.com',
  host_password: 'password123'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/host/register',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    console.log('Response:', responseData);
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.write(data);
req.end();