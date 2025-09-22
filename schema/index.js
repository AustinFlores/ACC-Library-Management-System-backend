const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');
const fs = require('fs');
const bcrypt = require('bcrypt'); // Added for hashing the default password

// Construct the path to the database in the user's Documents folder
const dbDir = path.join(os.homedir(), 'Documents', 'LMS');
const dbPath = path.join(dbDir, 'lms.db');

// Ensure the directory exists
fs.mkdirSync(dbDir, { recursive: true });

// Connect to the database file.
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    return console.error('Error opening database:', err.message);
  }
  console.log(`Connected to the SQLite database at ${dbPath} for schema setup.`);
});

// Use serialize to run commands in order. The db.close() is now at the end.
db.serialize(() => {
  // --- Student Table ---
  const createStudentTableSql = `
    CREATE TABLE IF NOT EXISTS student (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      course TEXT, year_level TEXT, password TEXT NOT NULL
    );`;
  db.run(createStudentTableSql, (err) => {
    if (err) console.error('Error creating student table:', err.message);
    else console.log('Table "student" created or already exists.');
  });

  // --- Books Table ---
  const createBooksTableSql = `
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, isbn TEXT NOT NULL,
      author TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Available'
    );`;
  db.run(createBooksTableSql, (err) => {
    if (err) console.error('Error creating books table:', err.message);
    else console.log('Table "books" created or already exists.');
  });
  
  // --- Bookings Table ---
  const createBookingsTableSql = `
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, date TEXT NOT NULL, 
      timeSlot TEXT NOT NULL, purpose TEXT NOT NULL, notes TEXT, createdAt TEXT NOT NULL
    );`;
  db.run(createBookingsTableSql, (err) => {
    if (err) console.error('Error creating bookings table:', err.message);
    else console.log('Table "bookings" created or already exists.');
  });

  // --- Contact Messages Table ---
  const createContactsTableSql = `
    CREATE TABLE IF NOT EXISTS contact_messages (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, subject TEXT NOT NULL, 
      message TEXT NOT NULL, createdAt TEXT NOT NULL
    );`;
  db.run(createContactsTableSql, (err) => {
    if (err) console.error('Error creating contact_messages table:', err.message);
    else console.log('Table "contact_messages" created or already exists.');
  });

  // --- Librarians Table (NEW) ---
  const createLibrariansTableSql = `
    CREATE TABLE IF NOT EXISTS librarians (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'librarian'
    );`;
  db.run(createLibrariansTableSql, function(err) {
    if (err) {
      console.error('Error creating librarians table:', err.message);
    } else {
      console.log('Table "librarians" created or already exists.');
      // After creating the table, check if it's empty to add a default admin
      const checkLibrarianSql = `SELECT COUNT(*) as count FROM librarians`;
      db.get(checkLibrarianSql, [], (err, row) => {
        if (err) return console.error('DB check failed:', err.message);
        
        if (row && row.count === 0) {
          // Hash the password and then insert the default librarian
          bcrypt.hash('admin123', 10, (err, hashedPassword) => {
            if (err) return console.error('Password hash failed:', err.message);
            
            const insertAdminSql = `INSERT INTO librarians (name, email, password) VALUES (?, ?, ?)`;
            db.run(insertAdminSql, ['Admin User', 'admin@acc.edu.ph', hashedPassword], (err) => {
              if (err) console.error('Error inserting default librarian:', err.message);
              else console.log('Default librarian (admin@acc.edu.ph / admin123) created.');
              
              // Close the database connection ONLY after the final operation is complete
              closeDb();
            });
          });
        } else {
          // If admin already exists, we are done, so close the database.
          closeDb();
        }
      });
    }
  });
});

function closeDb() {
  db.close((err) => {
    if (err) {
      return console.error(err.message);
    }
    console.log('Closed the database connection.');
  });
}