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


// books.routes.js - Main Browse Route (GET /)
router.get('/', async (req, res) => {
  const { category } = req.query;

  if (!category) {
      // Category is now mandatory for this route, as it drives the frontend display
      return res.status(400).json({ error: 'Category parameter is required.' });
  }
  if (!allowedCategories.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
  }

  let sql = `
    SELECT 
        B.id,
        B.title, 
        B.author, 
        B.isbn, 
        B.category,
        COUNT(C.id) AS totalCopies,
        SUM(CASE WHEN C.status = 'Available' THEN 1 ELSE 0 END) AS availableCopies
    FROM Books B
    LEFT JOIN BookCopies C ON B.id = C.book_id
    WHERE B.category = ?
    GROUP BY B.id, B.title, B.author, B.isbn, B.category
    ORDER BY B.title ASC
  `;
  
  try {
    const [rows] = await pool.execute(sql, [category]);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching aggregated books:', err.message);
    res.status(500).json({ error: 'Database error fetching aggregated books.' });
  }
});


// books.routes.js - Search by Title Route (GET /search-title)
router.get('/search-title', async (req, res) => {
  const { category, search } = req.query;
  
  if (!search) {
      return res.status(400).json({ error: 'Search term is required.' });
  }
  
  let sql = `
    SELECT 
        B.title, 
        B.author, 
        B.isbn, 
        B.category,
        COUNT(C.id) AS totalCopies,
        SUM(CASE WHEN C.status = 'Available' THEN 1 ELSE 0 END) AS availableCopies
    FROM Books B
    LEFT JOIN BookCopies C ON B.id = C.book_id
    WHERE B.title LIKE ?
  `;
  
  let params = [`%${search}%`];

  try {
    if (category) {
      if (!allowedCategories.includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      sql += ' AND B.category = ?';
      params.push(category);
    } 

    sql += ' GROUP BY B.id, B.title, B.author, B.isbn, B.category ORDER BY B.title ASC';

    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Error searching aggregated books by title:', err.message);
    res.status(500).json({ error: 'Database error during title search.' });
  }
});

// books.routes.js - Search by Author Route (GET /search-author)
router.get('/search-author', async (req, res) => {
  const { category, search } = req.query;
  
  if (!search) {
      return res.status(400).json({ error: 'Search term is required.' });
  }

  let sql = `
    SELECT 
        B.title, 
        B.author, 
        B.isbn, 
        B.category,
        COUNT(C.id) AS totalCopies,
        SUM(CASE WHEN C.status = 'Available' THEN 1 ELSE 0 END) AS availableCopies
    FROM Books B
    LEFT JOIN BookCopies C ON B.id = C.book_id
    WHERE B.author LIKE ?
  `;
  
  let params = [`%${search}%`];

  try {
    if (category) {
      if (!allowedCategories.includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      sql += ' AND B.category = ?';
      params.push(category);
    } 

    sql += ' GROUP BY B.id, B.title, B.author, B.isbn, B.category ORDER BY B.title ASC';

    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Error searching aggregated books by author:', err.message);
    res.status(500).json({ error: 'Database error during author search.' });
  }
});

// Get all unique categories
router.get('/categories', async (req, res) => {
  // Target the metadata table: Books
  const sql = 'SELECT DISTINCT category FROM Books ORDER BY category';
  try {
    const [rows] = await pool.execute(sql);
    const categories = rows.map(row => row.category);
    res.json(categories);
  } catch (err) {
    console.error('Error fetching categories:', err.message);
    res.status(500).json({ error: 'Server error fetching categories.' });
  }
});


// --- Add New Book/Copy (POST /api/books/add) ---
router.post('/add', async (req, res) => {
  const { title, isbn, author, category } = req.body; // Status is always 'Available' for a new entry

  if (!title || !isbn || !author || !category) {
    return res.status(400).json({ success: false, message: 'Missing required book fields.' });
  }
  if (!allowedCategories.includes(category)) {
    return res.status(400).json({ success: false, message: 'Invalid category provided.' });
  }

  try {
    // 1. Check if the book metadata already exists (by ISBN, which should be unique)
    let [bookRows] = await pool.execute('SELECT id FROM Books WHERE isbn = ?', [isbn]);
    let bookId;

    if (bookRows.length > 0) {
      // Metadata found: Use existing book ID
      bookId = bookRows[0].id;
      
    } else {
      // Metadata NOT found: Insert new entry into the Books table
      const insertBookSql = `
        INSERT INTO Books (title, isbn, author, category)
        VALUES (?, ?, ?, ?)
      `;
      const [result] = await pool.execute(insertBookSql, [title, isbn, author, category]);
      bookId = result.insertId; // Get the auto-incremented ID of the new metadata record
    }

    // 2. Insert the physical copy into the BookCopies table
    const insertCopySql = `
      INSERT INTO BookCopies (book_id, status)
      VALUES (?, 'Available')
    `;
    const [copyResult] = await pool.execute(insertCopySql, [bookId]);
    const copyId = copyResult.insertId; // ID of the newly created physical copy

    res.status(201).json({
      success: true,
      message: 'Book copy added successfully.',
      book: { 
          id: copyId, // Frontend now deals with the Copy ID when borrowing
          book_id: bookId, 
          title, 
          isbn, 
          author, 
          category, 
          status: 'Available' 
      }
    });

  } catch (err) {
    console.error('Error adding new book/copy:', err.message);
    res.status(500).json({ success: false, error: 'Database error while adding book.' });
  }
});

// --- Mark Book Copy as Returned (POST /api/books/return) ---
router.post('/return', authorize(['librarian']), async (req, res) => {
  // book_id here refers to the physical copy ID (from the BookCopies table)
  const { book_id } = req.body; 

  if (!book_id) {
    return res.status(400).json({ success: false, message: 'Book copy ID is required to return a book.' });
  }

  const newStatus = 'Available';

  try {
    // 1. Get current status and title metadata using JOIN
    const [bookRows] = await pool.execute(
      `SELECT C.status, B.title 
       FROM BookCopies C 
       JOIN Books B ON C.book_id = B.id 
       WHERE C.id = ?`, 
      [book_id]
    );
    
    if (bookRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Book copy not found.' });
    }
    
    const currentStatus = bookRows[0].status;
    const bookTitle = bookRows[0].title;

    if (currentStatus === newStatus) {
       return res.json({ success: true, message: `Book copy of "${bookTitle}" was already Available.`, bookTitle });
    }

    // 2. Update the status in the BookCopies table
    const [result] = await pool.execute('UPDATE BookCopies SET status = ? WHERE id = ?', [newStatus, book_id]);

    if (result.affectedRows === 0) {
      return res.status(500).json({ success: false, message: 'Failed to update book copy status in database.' });
    }

    res.json({ success: true, message: `Book copy of "${bookTitle}" successfully marked as Available.`, bookTitle });
  } catch (err) {
    console.error('Error marking book copy as returned:', err.message);
    res.status(500).json({ success: false, error: 'Database error while returning book copy.' });
  }
});

// --- Mark Book Copy as Borrowed (POST /api/books/borrow) ---
router.post('/borrow', authorize(['librarian']), async (req, res) => {
    // book_id here refers to the physical copy ID (from the BookCopies table)
    const { book_id } = req.body; 

    if (!book_id) {
      return res.status(400).json({ success: false, message: 'Book copy ID is required to borrow a book.' });
    }

    const newStatus = 'Borrowed';

    try {
      // 1. Get current status and title metadata using JOIN
      const [bookRows] = await pool.execute(
          `SELECT C.status, B.title 
           FROM BookCopies C 
           JOIN Books B ON C.book_id = B.id 
           WHERE C.id = ?`, 
          [book_id]
      );
      
      if (bookRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Book copy not found.' });
      }
      
      const currentStatus = bookRows[0].status;
      const bookTitle = bookRows[0].title;

      if (currentStatus === newStatus) {
          return res.json({ success: true, message: `Book copy of "${bookTitle}" was already Borrowed.`, bookTitle });
      }
      
      // We should ideally check if the status is currently 'Available' before borrowing
      if (currentStatus !== 'Available') {
         return res.status(400).json({ success: false, message: `Book copy of "${bookTitle}" is currently marked as ${currentStatus} and cannot be borrowed.` });
      }


      // 2. Update the status in the BookCopies table
      const [result] = await pool.execute('UPDATE BookCopies SET status = ? WHERE id = ?', [newStatus, book_id]);

      if (result.affectedRows === 0) {
        return res.status(500).json({ success: false, message: 'Failed to update book copy status in database.' });
      }

      res.json({ success: true, message: `Book copy of "${bookTitle}" successfully marked as Borrowed.`, bookTitle });
    } catch (err) {
      console.error('Error marking book copy as borrowed:', err.message);
      res.status(500).json({ success: false, error: 'Database error while borrowing book.' });
    }
});


// Toggle book status (targets the specific physical copy)
router.post('/toggle-status', async (req, res) => {
  // book_id here refers to the physical copy ID (BookCopies.id)
  const { book_id, new_status } = req.body; 
  
  if (!book_id || !new_status) {
    return res.status(400).json({ success: false, message: 'Missing book copy ID or new status.' });
  }
  
  // Ensure new_status is one of the allowed values
  const allowedStatuses = ['Available', 'Borrowed', 'Missing', 'Damaged', 'Lost'];
  if (!allowedStatuses.includes(new_status)) {
    return res.status(400).json({ success: false, message: 'Invalid status provided.' });
  }

  // 1. Update the status in the BookCopies table
  const updateSql = 'UPDATE BookCopies SET status = ? WHERE id = ?';
  
  try {
    const [result] = await pool.execute(updateSql, [new_status, book_id]);

    if (result.affectedRows === 0) { 
      // It's possible the copy ID doesn't exist
      return res.status(404).json({ success: false, message: 'Book copy not found.' });
    }
    
    // Optional: Fetch the title for a friendlier response message
    const [copyInfo] = await pool.execute(
        `SELECT B.title FROM BookCopies C JOIN Books B ON C.book_id = B.id WHERE C.id = ?`, 
        [book_id]
    );
    const title = copyInfo.length > 0 ? copyInfo[0].title : 'Unknown Book';

    res.json({ success: true, message: `Status of copy "${title}" updated to ${new_status}.`, new_status });
  } catch (err) {
    console.error('Error toggling book copy status:', err.message);
    res.status(500).json({ success: false, error: 'Database error updating book copy status.' });
  }
});

// ===================== API FOR UPDATING & DELETING BOOKS =====================

// Update a book (targets the metadata in the Books table)
router.put('/:id', async (req, res) => {
  // bookId here refers to the metadata ID (Books.id)
  const bookId = req.params.id; 
  const { title, author, isbn, category } = req.body; 
  
  // NOTE: Status is removed as it belongs to BookCopies, not Books metadata

  if (!title || !author || !isbn || !category) {
    return res.status(400).json({ success: false, message: 'Missing required metadata fields.' });
  }

  try {
    // 1. Update the metadata in the Books table
    const updateSql = `
      UPDATE Books 
      SET title = ?, author = ?, isbn = ?, category = ?
      WHERE id = ?
    `;
    const [result] = await pool.execute(
      updateSql,
      [title, author, isbn, category, bookId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Book metadata not found.' });
    }

    res.json({ success: true, message: 'Book metadata updated successfully (all copies reflect this change).' });
  } catch (err) {
    console.error('Error updating book metadata:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
         return res.status(409).json({ success: false, message: 'ISBN already exists for another book.' });
    }
    res.status(500).json({ success: false, error: 'Database error updating book metadata.' });
  }
});

// Delete a book (targets the metadata in the Books table, cascades to copies)
router.delete('/:id', async (req, res) => {
  // bookId here refers to the metadata ID (Books.id)
  const bookId = req.params.id;

  try {
    // 1. Fetch the title for the response message (before deletion)
    const [bookRows] = await pool.execute('SELECT title FROM Books WHERE id = ?', [bookId]);
    const bookTitle = bookRows.length > 0 ? bookRows[0].title : 'Unknown Book';

    // 2. Delete the metadata entry. This automatically deletes all copies due to CASCADE.
    const [result] = await pool.execute('DELETE FROM Books WHERE id = ?', [bookId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Book metadata not found.' });
    }

    // Note: To delete a single copy (instead of the entire title), you would need a separate route 
    // targeting the BookCopies table ID.
    
    res.json({ success: true, message: `All copies of book "${bookTitle}" have been deleted successfully.` });
  } catch (err) {
    console.error('Error deleting book metadata:', err.message);
    res.status(500).json({ success: false, error: 'Database error deleting book metadata.' });
  }
});

module.exports = router;
