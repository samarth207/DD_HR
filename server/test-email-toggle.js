/**
 * Simple API test for email toggle functionality
 * This script tests the email settings API endpoints using curl-like commands
 */

const http = require('http');

// Test the email settings endpoints
async function testEmailToggleAPI() {
    console.log('🧪 Testing Email Toggle API Endpoints\n');
    
    const baseUrl = 'http://localhost:3000';
    
    // Test 1: Get current email settings
    console.log('� Test 1: GET /api/admin/email-settings');
    try {
        const response = await fetch(`${baseUrl}/api/admin/email-settings`);
        const data = await response.json();
        console.log('Response:', data);
        console.log('✅ GET endpoint working\n');
    } catch (error) {
        console.log('❌ GET endpoint failed (expected if auth required)\n');
    }
    
    // Test 2: Try to update email settings (will fail without auth, but confirms endpoint exists)
    console.log('📋 Test 2: PUT /api/admin/email-settings');
    try {
        const response = await fetch(`${baseUrl}/api/admin/email-settings`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ enabled: false })
        });
        const data = await response.json();
        console.log('Response:', data);
        if (response.ok) {
            console.log('✅ PUT endpoint working\n');
        } else {
            console.log('⚠️ PUT endpoint requires authentication (expected)\n');
        }
    } catch (error) {
        console.log('❌ PUT endpoint failed:', error.message, '\n');
    }
    
    console.log('✅ API endpoint tests completed!');
    console.log('\n� Manual Testing Instructions:');
    console.log('1. Log in as admin at http://localhost:3000/login.html');
    console.log('2. Go to Account Settings page');
    console.log('3. Toggle the "Email Sending" switch');
    console.log('4. Verify the banner appears/disappears on dashboard');
    console.log('5. Test email functionality in various features (incentives, leaves, etc.)');
}

// Run the test
testEmailToggleAPI();