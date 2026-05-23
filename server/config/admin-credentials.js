/**
 * Admin credentials — password is stored as a scrypt hash only.
 * The plaintext password is NEVER stored here.
 * Generated with: crypto.scryptSync(password, salt, 64).toString('hex')
 */
module.exports = {
    deletePasswordHash: '5fc09edf52c59fcc3f852e07b5ebb31fcc083bbc163531cb5ea20e478fc7335ed526dc864f4568649e5a03fc846a9f2e9cbecf5cb8ed8a3dad9424c3e8712f32',
    deletePasswordSalt: '3c1a25baf72ea1cc4af0edf40e9a951fa03c2c7889f7dfff579e4a3316a158c7'
};
