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

  const sql = 'SELECT id, title, author, status FROM books WHERE category = ? ORDER BY title ASC';
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