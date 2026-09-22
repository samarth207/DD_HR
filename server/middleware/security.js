const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const validator = require('validator');
const sanitizeHtml = require('sanitize-html');
const crypto = require('crypto');

// Rate limiting configuration
const createRateLimiter = (windowMs = 15 * 60 * 1000, max = 100, message = 'Too many requests from this IP, please try again later.') => {
  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

// General API rate limiter (increased for testing)
const apiLimiter = createRateLimiter(15 * 60 * 1000, 1000);

// Stricter rate limiter for authentication endpoints
const authLimiter = createRateLimiter(15 * 60 * 1000, 5, 'Too many login attempts, please try again later.');

// Stricter rate limiter for sensitive operations
const sensitiveLimiter = createRateLimiter(15 * 60 * 1000, 20);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // In production, replace with your actual domains
    const allowedOrigins = process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',') 
      : ['http://localhost:3000', 'http://127.0.0.1:3000'];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 600 // 10 minutes
};

// Security headers configuration
const helmetConfig = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      manifestSrc: ["'self'"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  frameguard: { action: 'deny' },
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
};

// Input sanitization for XSS prevention
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  
  return sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
    textFilter: function(text) {
      return text.replace(/&/g, '&amp;')
                 .replace(/</g, '&lt;')
                 .replace(/>/g, '&gt;')
                 .replace(/"/g, '&quot;')
                 .replace(/'/g, '&#x27;');
    }
  });
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }
  
  const sanitized = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (typeof obj[key] === 'string') {
        sanitized[key] = sanitizeInput(obj[key]);
      } else if (typeof obj[key] === 'object') {
        sanitized[key] = sanitizeObject(obj[key]);
      } else {
        sanitized[key] = obj[key];
      }
    }
  }
  return sanitized;
}

// Password validation
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required' };
  }
  
  if (password.length < 12) {
    return { valid: false, message: 'Password must be at least 12 characters long' };
  }
  
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' };
  }
  
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' };
  }
  
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number' };
  }
  
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one special character' };
  }
  
  return { valid: true };
}

// Email validation
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, message: 'Email is required' };
  }
  
  if (!validator.isEmail(email)) {
    return { valid: false, message: 'Invalid email format' };
  }
  
  return { valid: true };
}

// Phone number validation
function validatePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, message: 'Phone number is required' };
  }
  
  // Remove all non-digit characters
  const cleanedPhone = phone.replace(/\D/g, '');
  
  if (cleanedPhone.length < 10 || cleanedPhone.length > 15) {
    return { valid: false, message: 'Phone number must be between 10 and 15 digits' };
  }
  
  return { valid: true };
}

// Security logging middleware
function securityLogger(req, res, next) {
  const startTime = Date.now();
  
  // Log request details
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - IP: ${req.ip}`);
  
  // Log on response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - Status: ${res.statusCode} - Duration: ${duration}ms`);
    
    // Log suspicious activities
    if (res.statusCode >= 400) {
      console.warn(`[${new Date().toISOString()}] WARNING: ${req.method} ${req.path} - Status: ${res.statusCode} - IP: ${req.ip}`);
    }
  });
  
  next();
}

// Security monitoring middleware
function securityMonitor(req, res, next) {
  // Skip security monitoring for GET requests to health endpoint and static files
  if (req.method === 'GET' && (req.path === '/api/v1/health' || req.path === '/api/health' || req.path === '/health')) {
    return next();
  }

  // Check for suspicious patterns
  const suspiciousPatterns = [
    /\.\./,           // Path traversal
    /<script>/i,      // XSS attempt
    /javascript:/i,   // JavaScript protocol
    /union.*select/i, // SQL injection attempt
    /eval\(/i,        // Code execution attempt
    /exec\(/i,        // Command execution attempt
  ];
  
  const bodyString = req.body ? JSON.stringify(req.body) : '';
  const queryString = req.query ? JSON.stringify(req.query) : '';
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(bodyString) || pattern.test(queryString)) {
      console.error(`[${new Date().toISOString()}] SECURITY ALERT: Suspicious pattern detected - IP: ${req.ip}, Path: ${req.path}`);
      return res.status(403).json({ error: 'Suspicious activity detected' });
    }
  }
  
  next();
}

// CSRF Token Generation and Validation
const csrfTokens = new Map();

function generateCSRFToken() {
  return crypto.randomBytes(32).toString('hex');
}

function csrfProtection(req, res, next) {
  // Skip CSRF for GET requests and auth endpoints
  if (req.method === 'GET') {
    return next();
  }

  // Skip CSRF for authentication endpoints (login, password change, etc.)
  if (req.path.startsWith('/api/auth/') || req.path.startsWith('/api/v1/auth/')) {
    return next();
  }

  // Skip CSRF for CSRF token endpoint itself
  if (req.path.includes('/csrf-token')) {
    return next();
  }

  const token = req.headers['x-csrf-token'] || req.body._csrf;
  const sessionToken = req.headers['authorization']?.replace('Bearer ', '');

  if (!token || !sessionToken) {
    return res.status(403).json({ error: 'CSRF token missing' });
  }

  const expectedToken = csrfTokens.get(sessionToken);
  if (!expectedToken || expectedToken !== token) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  next();
}

function getCSRFToken(req, res) {
  const sessionToken = req.headers['authorization']?.replace('Bearer ', '');
  if (!sessionToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = generateCSRFToken();
  csrfTokens.set(sessionToken, token);

  // Clean up old tokens (simple cleanup - in production use proper session management)
  if (csrfTokens.size > 10000) {
    const firstKey = csrfTokens.keys().next().value;
    csrfTokens.delete(firstKey);
  }

  return res.json({ csrfToken: token });
}

module.exports = {
  apiLimiter,
  authLimiter,
  sensitiveLimiter,
  corsOptions,
  helmetConfig,
  sanitizeInput,
  sanitizeObject,
  validatePassword,
  validateEmail,
  validatePhone,
  securityLogger,
  securityMonitor,
  csrfProtection,
  getCSRFToken
};