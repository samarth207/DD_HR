#!/bin/bash

echo "=== HR Portal Security Testing Script ==="
echo "Starting security tests..."
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

# Function to check test result
check_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓ PASS${NC}: $2"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAIL${NC}: $2"
        ((FAILED++))
    fi
}

echo "=== 1. Health Check Test ==="
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/health)
check_result $HEALTH_RESPONSE "Health endpoint accessible"
echo ""

echo "=== 2. Security Headers Test ==="
echo "Checking security headers..."
HEADERS=$(curl -I -s http://localhost:3000/api/v1/health)

if echo "$HEADERS" | grep -q "X-Content-Type-Options"; then
    check_result 0 "X-Content-Type-Options header present"
else
    check_result 1 "X-Content-Type-Options header missing"
fi

if echo "$HEADERS" | grep -q "X-Frame-Options"; then
    check_result 0 "X-Frame-Options header present"
else
    check_result 1 "X-Frame-Options header missing"
fi

if echo "$HEADERS" | grep -q "X-XSS-Protection"; then
    check_result 0 "X-XSS-Protection header present"
else
    check_result 1 "X-XSS-Protection header missing"
fi
echo ""

echo "=== 3. Rate Limiting Test ==="
echo "Testing rate limiting (making 105 requests)..."
RATE_LIMITHits=0
for i in {1..105}; do
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/health)
    if [ "$RESPONSE" = "429" ]; then
        ((RATE_LIMITHits++))
    fi
done

if [ $RATE_LIMITHits -gt 0 ]; then
    check_result 0 "Rate limiting working ($RATE_LIMITHits requests blocked)"
else
    check_result 1 "Rate limiting not triggered (may need adjustment)"
fi
echo ""

echo "=== 4. CSRF Token Endpoint Test ==="
CSRF_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/csrf-token)
if [ "$CSRF_RESPONSE" = "401" ]; then
    check_result 0 "CSRF endpoint requires authentication (expected)"
else
    check_result 1 "CSRF endpoint authentication check failed"
fi
echo ""

echo "=== 5. CORS Configuration Test ==="
echo "Testing CORS with unauthorized origin..."
CORS_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Origin: http://malicious-site.com" \
  -H "Access-Control-Request-Method: GET" \
  http://localhost:3000/api/v1/health)

# CORS preflight should be rejected or not return proper CORS headers
if [ "$CORS_RESPONSE" != "200" ] || ! curl -s -I -H "Origin: http://malicious-site.com" http://localhost:3000/api/v1/health | grep -q "Access-Control-Allow-Origin"; then
    check_result 0 "CORS properly configured for unauthorized origins"
else
    check_result 1 "CORS may be too permissive"
fi
echo ""

echo "=== 6. API Versioning Test ==="
V1_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/health)
LEGACY_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health)

check_result $V1_RESPONSE "API v1 endpoint accessible"
check_result $LEGACY_RESPONSE "Legacy API endpoint accessible (backward compatibility)"
echo ""

echo "=== 7. Input Sanitization Test ==="
echo "Testing XSS protection..."
# This would require authentication to properly test
echo -e "${YELLOW}⚠ SKIP${NC}: Requires authentication to test properly"
echo ""

echo "=== Test Summary ==="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo "Total: $((PASSED + FAILED))"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All basic security tests passed!${NC}"
    echo "Note: Some tests require authentication for complete validation."
else
    echo -e "${RED}Some security tests failed. Please review the results above.${NC}"
fi

echo "=== Testing Complete ==="