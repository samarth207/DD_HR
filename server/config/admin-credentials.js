/**
 * Admin credentials — passwords stored as scrypt hashes only.
 * TOKEN_SECRET signs all auth tokens (never expose to client).
 */
module.exports = {
    // Admin delete + login password hash (scrypt)
    deletePasswordHash: '5fc09edf52c59fcc3f852e07b5ebb31fcc083bbc163531cb5ea20e478fc7335ed526dc864f4568649e5a03fc846a9f2e9cbecf5cb8ed8a3dad9424c3e8712f32',
    deletePasswordSalt: '3c1a25baf72ea1cc4af0edf40e9a951fa03c2c7889f7dfff579e4a3316a158c7',

    // HMAC secret for signing auth tokens — never stored in the browser
    TOKEN_SECRET: '123286372348175a0174c3edda0b480b11a83df82834287fc6ff856a04355c5c4a8b12aa1248f096b9cf19bcf56bd78a',

    // Token lifetime in milliseconds (8 hours)
    TOKEN_TTL_MS: 8 * 60 * 60 * 1000
};
