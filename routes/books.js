const express = require('express');
const router = express.Router();
const db = require('../db'); 
const allowedCategories = [
  'General Works', 'Philosophy & Psychology', 'Religion', 'Social Sciences',
  'Language', 'Science', 'Technology', 'Arts & Recreation', 'Literature',
  'History, Geography, & Biography'
];

// Simulated role-based auth for demo
const getUserRole = (req) => req.headers['x-role'] || 'student';

// Get books by category
router.get('/', (req, res) => {
  const category = req.query.category || 'Science';
  if (!allowedCategories.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }

  const sql = 'SELECT id, title, author, isbn, status FROM books WHERE category = ? ORDER BY title ASC';
  db.all(sql, [category], (err, rows) => {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Search by title
router.get('/search-title', (req, res) => {
  const { category, search } = req.query;
  if (!allowedCategories.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }

  const sql = 'SELECT id, title, author, status FROM books WHERE category = ? AND title LIKE ? ORDER BY title ASC';
  db.all(sql, [category, `%${search}%`], (err, rows) => {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Search by author
router.get('/search-author', (req, res) => {
  const { category, search } = req.query;
  if (!allowedCategories.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }

  const sql = 'SELECT id, title, author, status FROM books WHERE category = ? AND author LIKE ? ORDER BY title ASC';
  db.all(sql, [category, `%${search}%`], (err, rows) => {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Get all categories
router.get('/categories', (req, res) => {
  const sql = 'SELECT DISTINCT category FROM books ORDER BY category';
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Error fetching categories:', err);
      return res.status(500).json({ error: 'Server error' });
    }
    const categories = rows.map(row => row.category);
    res.json(categories);
  });
});

// --- Mark Book as Returned (POST /api/books/return) ---
router.post('/return', async (req, res) => {
  // TODO: Add authorization middleware here to ensure only librarians/admin can use this
  const { book_id } = req.body;

  if (!book_id) {
    return res.status(400).json({ success: false, message: 'Book ID is required to return a book.' });
  }

  const newStatus = 'Available'; // A returned book becomes available

  try {
    // First, get book details for the success message
    const book = await allDb('SELECT title, status FROM books WHERE id = ?', [book_id]);
    if (book.length === 0) {
      return res.status(404).json({ success: false, message: 'Book not found.' });
    }
    const currentStatus = book[0].status;
    const bookTitle = book[0].title;

    // Update the book status
    const result = await runDb('UPDATE books SET status = ? WHERE id = ?', [newStatus, book_id]);
    
    if (result.changes === 0 && currentStatus === newStatus) {
      // If no changes, but status was already Available, it's still a success
      return res.json({ success: true, message: `Book "${bookTitle}" was already Available.`, bookTitle });
    } else if (result.changes === 0) {
      return res.status(500).json({ success: false, message: 'Failed to update book status in database.' });
    }

    //log this return event in a 'transactions' or 'borrow_history' table
    // For example: await runDb('INSERT INTO transactions (book_id, student_id, type, date) VALUES (?, ?, ?, ?)', [book_id, student_id, 'return', new Date().toISOString()]);

    res.json({ success: true, message: `Book "${bookTitle}" successfully marked as Available.`, bookTitle });
  } catch (err) {
    console.error('Error marking book as returned:', err.message);
    res.status(500).json({ success: false, error: 'Database error while returning book.' });
  }
});

// Toggle book status
router.post('/toggle-status', (req, res) => {
  const { book_id, new_status } = req.body;
  if (!book_id || !new_status) {
    return res.status(400).json({ success: false, message: 'Missing data' });
  }

  const sql = 'UPDATE books SET status = ? WHERE id = ?';
  db.run(sql, [new_status, book_id], function(err) { // Use `function` to get `this` scope
    if (err) {
      console.error(err.message);
      return res.status(500).json({ success: false, error: 'Update failed' });
    }
    res.json({ success: true, new_status });
  });
});

module.exports = router;