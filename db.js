// db.js (Refactored)
const mysql = require('mysql2/promise');
require('dotenv').config(); // Load environment variables

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'your_mysql_password', // !!! CHANGE THIS !!!
  database: process.env.DB_NAME || 'lms_db', // Ensure this database exists in MySQL
  waitForConnections: true,
  connectionLimit: 10, // Adjust as needed
  queueLimit: 0,
  dateStrings: true
};

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