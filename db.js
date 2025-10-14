// db.js
const mysql = require('mysql2/promise');
require('dotenv').config();

let dbConfig;

if (process.env.DB_URI) {
  dbConfig = process.env.DB_URI;
} else {
  // Fallback to individual env vars
  dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123',
    database: process.env.DB_NAME || 'lms_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true,
  };
}

// Create a connection pool for the database.
// This pool will be used globally by the application.
const pool = mysql.createPool(dbConfig);

// Test the connection once when the module loads
pool.getConnection()
  .then(connection => {
    console.log('MySQL connection pool created and tested successfully.');
    connection.release(); // Release the connection immediately after testing
  })
  .catch(err => {
    console.error('Failed to connect to MySQL pool:', err.message);
    // It's critical to exit if we can't connect to the DB on startup
    process.exit(1);
  });

module.exports = pool;