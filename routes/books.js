// routes/books.js (Converted to mysql2)
const express = require('express');
const router = express.Router();
const pool = require('../db'); // Import the MySQL connection pool
const crypto = require("crypto"); // Assuming you might use this for new book IDs

const allowedCategories = [
  'General Works', 'Philosophy & Psychology', 'Religion', 'Social Sciences',
  'Language', 'Science', 'Technology', 'Arts & Recreation', 'Literature',
  'History, Geography, & Biography'
];

// Simulated role-based auth for demo (middleware pattern)
const authorize = (allowedRoles) => (req, res, next) => {
  const userRole = req.headers['x-role'] || 'student'; // Get role from header for demo
  if (allowedRoles.includes(userRole)) {
    next(); // User is authorized, proceed
  } else {
    res.status(403).json({ message: 'Forbidden: You do not have permission to perform this action.' });
  }
};


// Get all books (or filter by category if provided)
router.get('/', async (req, res) => {
  const category = req.query.category; // Now optional to get all books
  let sql;
  let params = [];

  try {
    if (category) {
      if (!allowedCategories.includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      sql = 'SELECT id, title, author, isbn, category, status FROM books WHERE category = ? ORDER BY title ASC';
      params = [category];
    } else {
      // If no category is provided, fetch all books
      sql = 'SELECT id, title, author, isbn, category, status FROM books ORDER BY title ASC';
      // No params needed here
    }

    const [rows] = await pool.execute(sql, params); // pool.execute returns [rows, fields]
    res.json(rows);
  } catch (err) {
    console.error('Error fetching books:', err.message);
    res.status(500).json({ error: 'Database error fetching books.' });
  }
});


// Search by title
router.get('/search-title', async (req, res) => {
  const { category, search } = req.query;
  // Category is now optional for search, but if provided, validate it.
  // If not provided, search across all categories.

  let sql;
  let params = [];

  try {
    if (category) {
      if (!allowedCategories.includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      sql = 'SELECT id, title, author, isbn, category, status FROM books WHERE category = ? AND title LIKE ? ORDER BY title ASC';
      params = [category, `%${search}%`];
    } else {
      sql = 'SELECT id, title, author, isbn, category, status FROM books WHERE title LIKE ? ORDER BY title ASC';
      params = [`%${search}%`];
    }

    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Error searching books by title:', err.message);
    res.status(500).json({ error: 'Database error during title search.' });
  }
});

// Search by author
router.get('/search-author', async (req, res) => {
  const { category, search } = req.query;
  
  let sql;
  let params = [];

  try {
    if (category) {
      if (!allowedCategories.includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      sql = 'SELECT id, title, author, isbn, category, status FROM books WHERE category = ? AND author LIKE ? ORDER BY title ASC';
      params = [category, `%${search}%`];
    } else {
      sql = 'SELECT id, title, author, isbn, category, status FROM books WHERE author LIKE ? ORDER BY title ASC';
      params = [`%${search}%`];
    }

    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Error searching books by author:', err.message);
    res.status(500).json({ error: 'Database error during author search.' });
  }
});

// Get all unique categories
router.get('/categories', async (req, res) => {
  const sql = 'SELECT DISTINCT category FROM books ORDER BY category';
  try {
    const [rows] = await pool.execute(sql);
    const categories = rows.map(row => row.category);
    res.json(categories);
  } catch (err) {
    console.error('Error fetching categories:', err.message);
    res.status(500).json({ error: 'Server error fetching categories.' });
  }
});

// --- Add New Book (POST /api/books/add) ---
router.post('/add', async (req, res) => {
  const { title, isbn, author, category } = req.body;

  if (!title || !isbn || !author || !category) {
    return res.status(400).json({ success: false, message: 'Missing required book fields.' });
  }
  if (!allowedCategories.includes(category)) {
    return res.status(400).json({ success: false, message: 'Invalid category provided.' });
  }

  try {
    // Generate a UUID for the new book ID
    const id = crypto.randomUUID();

    const insertSql = `
      INSERT INTO books (id, title, isbn, author, category, status)
      VALUES (?, ?, ?, ?, ?, 'Available')
    `;
    const [result] = await pool.execute(insertSql, [id, title, isbn, author, category]);

    if (result.affectedRows === 1) {
      res.status(201).json({
        success: true,
        message: 'Book added successfully.',
        book: { id, title, isbn, author, category, status: 'Available' }
      });
    } else {
      res.status(500).json({ success: false, message: 'Failed to add book to the database.' });
    }
  } catch (err) {
    console.error('Error adding new book:', err.message);
    if (err.code === 'ER_DUP_ENTRY') { // MySQL specific error for duplicate unique key
        return res.status(409).json({ success: false, message: 'ISBN already exists.' });
    }
    res.status(500).json({ success: false, error: 'Database error while adding book.' });
  }
});

// --- Mark Book as Returned (POST /api/books/return) ---
router.post('/return', authorize(['librarian']), async (req, res) => {
  const { book_id } = req.body;

  if (!book_id) {
    return res.status(400).json({ success: false, message: 'Book ID is required to return a book.' });
  }

  const newStatus = 'Available';

  try {
    const [bookRows] = await pool.execute('SELECT title, status FROM books WHERE id = ?', [book_id]);
    if (bookRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Book not found.' });
    }
    const currentStatus = bookRows[0].status;
    const bookTitle = bookRows[0].title;

    const [result] = await pool.execute('UPDATE books SET status = ? WHERE id = ?', [newStatus, book_id]);

    if (result.affectedRows === 0 && currentStatus === newStatus) {
      return res.json({ success: true, message: `Book "${bookTitle}" was already Available.`, bookTitle });
    } else if (result.affectedRows === 0) {
      return res.status(500).json({ success: false, message: 'Failed to update book status in database.' });
    }

    // You can uncomment and implement logging to a transactions/borrow_history table here
    // await pool.execute('INSERT INTO transactions (book_id, student_id, type, date) VALUES (?, ?, ?, NOW())', [book_id, student_id_from_auth, 'return']);

    res.json({ success: true, message: `Book "${bookTitle}" successfully marked as Available.`, bookTitle });
  } catch (err) {
    console.error('Error marking book as returned:', err.message);
    res.status(500).json({ success: false, error: 'Database error while returning book.' });
  }
});

// --- Mark Book as Borrowed (POST /api/books/borrow) ---
router.post('/borrow', authorize(['librarian']), async (req, res) => {
    const { book_id } = req.body; // Assuming student_id will come from auth/session later

    if (!book_id) {
      return res.status(400).json({ success: false, message: 'Book ID is required to borrow a book.' });
    }

    const newStatus = 'Borrowed';

    try {
      const [bookRows] = await pool.execute('SELECT title, status FROM books WHERE id = ?', [book_id]);
      if (bookRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Book not found.' });
      }
      const currentStatus = bookRows[0].status;
      const bookTitle = bookRows[0].title;

      if (currentStatus === newStatus) {
          return res.json({ success: true, message: `Book "${bookTitle}" was already Borrowed.`, bookTitle });
      }

      const [result] = await pool.execute('UPDATE books SET status = ? WHERE id = ?', [newStatus, book_id]);

      if (result.affectedRows === 0) {
        return res.status(500).json({ success: false, message: 'Failed to update book status in database.' });
      }

      // You can uncomment and implement logging to a transactions/borrow_history table here
      // await pool.execute('INSERT INTO transactions (book_id, student_id, type, date) VALUES (?, ?, ?, NOW())', [book_id, student_id_from_auth, 'borrow']);

      res.json({ success: true, message: `Book "${bookTitle}" successfully marked as Borrowed.`, bookTitle });
    } catch (err) {
      console.error('Error marking book as borrowed:', err.message);
      res.status(500).json({ success: false, error: 'Database error while borrowing book.' });
    }
});



// Toggle book status
router.post('/toggle-status', async (req, res) => {
  const { book_id, new_status } = req.body;
  if (!book_id || !new_status) {
    return res.status(400).json({ success: false, message: 'Missing book ID or new status.' });
  }
  // Ensure new_status is one of the allowed values
  if (!['Available', 'Borrowed', 'Lost', 'Damaged'].includes(new_status)) {
    return res.status(400).json({ success: false, message: 'Invalid status provided.' });
  }

  const sql = 'UPDATE books SET status = ? WHERE id = ?';
  try {
    const [result] = await pool.execute(sql, [new_status, book_id]);

    if (result.affectedRows === 0) { // Check affectedRows for update/delete
      return res.status(404).json({ success: false, message: 'Book not found.' });
    }
    res.json({ success: true, message: `Book status updated to ${new_status}.`, new_status });
  } catch (err) {
    console.error('Error toggling book status:', err.message);
    res.status(500).json({ success: false, error: 'Database error updating book status.' });
  }
});

// ===================== API FOR UPDATING & DELETING BOOKS =====================

// Update a book
router.put('/:id', async (req, res) => {
  const bookId = req.params.id;
  const { title, author, isbn, category, status } = req.body;

  if (!title || !author || !isbn || !category) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE books 
       SET title = ?, author = ?, isbn = ?, category = ?, status = ?
       WHERE id = ?`,
      [title, author, isbn, category, status || 'Available', bookId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Book not found.' });
    }

    res.json({ success: true, message: 'Book updated successfully.' });
  } catch (err) {
    console.error('Error updating book:', err.message);
    res.status(500).json({ success: false, error: 'Database error updating book.' });
  }
});

// Delete a book
router.delete('/:id', async (req, res) => {
  const bookId = req.params.id;

  try {
    const [result] = await pool.execute('DELETE FROM books WHERE id = ?', [bookId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Book not found.' });
    }

    res.json({ success: true, message: 'Book deleted successfully.' });
  } catch (err) {
    console.error('Error deleting book:', err.message);
    res.status(500).json({ success: false, error: 'Database error deleting book.' });
  }
});

module.exports = router;