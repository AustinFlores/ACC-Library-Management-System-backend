// db.js
const mysql = require('mysql2/promise');
require('dotenv').config();

let dbConfig;

if (process.env.DATABASE_URL) {
  dbConfig = { uri: process.env.DATABASE_URL };
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