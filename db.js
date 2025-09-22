const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');
const fs = require('fs');

// Construct the path to the database in the user's Documents folder
// e.g., C:\Users\YourUser\Documents\LMS\lms.db
const dbDir = path.join(os.homedir(), 'Documents', 'LMS');
const dbPath = path.join(dbDir, 'lms.db');

// Ensure the directory exists before trying to connect
fs.mkdirSync(dbDir, { recursive: true });

// Connect to the SQLite database file
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log(`Connected to the SQLite database at ${dbPath}`);
  }
});

module.exports = db;  