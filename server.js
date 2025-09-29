const express = require('express');
const QRCode = require('qrcode');
const cors = require('cors');
const bcrypt = require('bcrypt');
const booksRouter = require('./routes/books');
const db = require('./db'); // <-- should export mysql2 pool.promise()
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(cors());

const SALT_ROUNDS = 10;

// ===================== SIGNUP =====================
app.post('/signup', async (req, res) => {
  const { id, name, email, course, year_level, password } = req.body;

  try {
    const [existing] = await db.query(
      'SELECT * FROM students WHERE id = ? OR email = ?',
      [id, email]
    );

    if (existing.length > 0) {
      return res.json({ success: false, message: 'ID or email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    await db.query(
      `INSERT INTO students (id, name, email, course, year_level, password)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name, email, course, year_level, hashedPassword]
    );

    res.json({
      success: true,
      message: 'Signup successful. You can now generate your QR code.'
    });
  } catch (err) {
    console.error("Signup error:", err.message);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ===================== SIGNIN =====================
app.post('/signin', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  try {
    // 1. Check librarian first
    const [librarians] = await db.query('SELECT * FROM librarians WHERE email = ?', [email]);
    const librarian = librarians[0];

    if (librarian) {
      const isMatch = await bcrypt.compare(password, librarian.password);
      if (isMatch) {
        return res.json({
          success: true,
          name: librarian.name,
          role: librarian.role, // e.g., "librarian"
        });
      } else {
        return res.json({ success: false, message: 'Invalid credentials' });
      }
    }

    // 2. Check admin table next
    const [admins] = await db.query('SELECT * FROM admins WHERE email = ?', [email]);
    const admin = admins[0];

    if (admin) {
      const isMatch = password === admin.password;
      if (isMatch) {
        return res.json({
          success: true,
          name: admin.name,
          role: 'admin', // explicitly mark role as admin
        });
      } else {
        return res.json({ success: false, message: 'Invalid credentials' });
      }
    }

    // 3. Otherwise check student
    const [students] = await db.query(
      'SELECT id, name, email, course, year_level, password, role FROM students WHERE email = ?',
      [email]
    );
    const student = students[0];

    if (student) {
      const isMatch = await bcrypt.compare(password, student.password);
      if (isMatch) {
        return res.json({
          success: true,
          name: student.name,
          studentId: student.id,
          role: student.role || 'student', // default to student if role missing
        });
      }
    }

    // 4. If none matched
    return res.json({ success: false, message: 'Invalid credentials' });
  } catch (err) {
    console.error("Signin error:", err.message);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});




// ===================== GENERATE QR (On-Demand) =====================
app.get('/generate-qr', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ success: false, message: "Missing student ID" });

  try {
    const [rows] = await db.query('SELECT * FROM students WHERE id = ?', [id]);
    const student = rows[0];
    if (!student) {
      return res.json({ success: false, message: 'Student not found' });
    }

    const qrData = `${id}`;
    const qrBase64 = await QRCode.toDataURL(qrData);
    res.json({ success: true, qrImage: qrBase64 });
  } catch (err) {
    console.error("QR generation error:", err.message);
    res.json({ success: false, message: 'Failed to generate QR code' });
  }
});

// ===================== VERIFY (Using Student ID) =====================
app.get('/verify', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.json({ success: false, message: 'No ID provided' });

  try {
    const [rows] = await db.query(
      'SELECT id, name, email, course, year_level, password, role FROM students WHERE id = ?',
      [id]
    );
    const student = rows[0];
    if (!student) {
      return res.json({ success: false, message: 'Invalid QR code' });
    }
    res.json({ success: true, user: student });
  } catch (err) {
    console.error("Verify error:", err.message);
    res.json({ success: false, message: 'Database error' });
  }
});

// ===================== API for Student Dashboard Stats =====================
app.get('/api/student/dashboard-stats', async (req, res) => {
  const { studentId } = req.query;

  if (!studentId) {
    return res.status(400).json({ success: false, message: 'Student ID is required for dashboard stats.' });
  }

  try {
    const getCount = async (sql, params) => {
      const [rows] = await db.query(sql, params);
      return Object.values(rows[0])[0];
    };

    // Count books currently on loan by this student
    const booksOnLoan = await getCount(
      'SELECT COUNT(*) FROM borrow_records WHERE student_id = ? AND status = "Active"',
      [studentId]
    );

    // Count overdue books for this student
    const overdueBooks = await getCount(
      'SELECT COUNT(*) FROM borrow_records WHERE student_id = ? AND status = "Active" AND due_date < CURDATE()',
      [studentId]
    );

    // Count active (pending or confirmed) bookings for this student
    const activeBookings = await getCount(
      'SELECT COUNT(*) FROM bookings WHERE email = (SELECT email FROM students WHERE id = ?)',
      [studentId]
    );

    res.json({
      success: true,
      booksOnLoan,
      overdueBooks,
      activeBookings,
    });

  } catch (err) {
    console.error("Error fetching student dashboard stats for ID", studentId, ":", err.message);
    res.status(500).json({ success: false, error: 'Database error fetching student dashboard statistics.' });
  }
});

// ===================== API for Student's Borrowed Books =====================
app.get('/api/student/borrowed-books', async (req, res) => {
  // TODO: Add authorization middleware here to ensure studentId matches logged-in user
  const { studentId } = req.query;

  if (!studentId) {
    return res.status(400).json({ success: false, message: 'Student ID is required.' });
  }

  try {
    const [books] = await db.query(
      `SELECT 
        br.id AS borrowId,
        b.id AS bookId,
        b.title,
        b.author,
        b.isbn,
        br.borrow_date AS borrowDate,
        br.due_date AS dueDate,
        br.status
       FROM borrow_records br
       JOIN books b ON br.book_id = b.id
       WHERE br.student_id = ?
       ORDER BY br.due_date ASC`,
      [studentId]
    );
    
    res.json({ success: true, books: books || [] });
  } catch (err) {
    console.error("Error fetching student's borrowed books for ID", studentId, ":", err.message);
    res.status(500).json({ success: false, error: 'Database error fetching borrowed books.' });
  }
});


// ===================== API for Student Recommendations =====================
app.get('/api/student/recommendations', async (req, res) => {
    // TODO: Add authorization middleware here to ensure studentId matches logged-in user
    const { studentId } = req.query;

    if (!studentId) {
        return res.status(400).json({ success: false, message: 'Student ID is required for recommendations.' });
    }

    try {
        // 1. Find categories the student has borrowed from
        const [borrowedCategoriesRows] = await db.query(
            `SELECT DISTINCT b.category
             FROM borrow_records br
             JOIN books b ON br.book_id = b.id
             WHERE br.student_id = ?`,
            [studentId]
        );
        const borrowedCategories = borrowedCategoriesRows.map(row => row.category);

        let recommendedBooks = [];

        if (borrowedCategories.length > 0) {
            const [booksFromPreferredCategories] = await db.query(
                `SELECT DISTINCT b.id, b.title, b.author, b.isbn, b.category
                 FROM books b
                 LEFT JOIN borrow_records br ON b.id = br.book_id AND br.student_id = ?
                 WHERE b.category IN (?) AND b.status = 'Available' AND br.id IS NULL
                 ORDER BY RAND() LIMIT 3`,
                [studentId, borrowedCategories]
            );
            recommendedBooks = booksFromPreferredCategories;
        }
        if (recommendedBooks.length < 3) {
            const limit = 3 - recommendedBooks.length;
            const [generalRecommendations] = await db.query(
                `SELECT DISTINCT b.id, b.title, b.author, b.isbn, b.category
                 FROM books b
                 LEFT JOIN borrow_records br ON b.id = br.book_id AND br.student_id = ?
                 WHERE b.status = 'Available' AND br.id IS NULL
                 ORDER BY RAND() LIMIT ?`,
                [studentId, limit]
            );
            recommendedBooks = [...recommendedBooks, ...generalRecommendations];
        }
        
        res.json({ success: true, books: recommendedBooks });

    } catch (err) {
        console.error("Error fetching student recommendations for ID", studentId, ":", err.message);
        res.status(500).json({ success: false, error: 'Database error fetching recommendations.' });
    }
});

// ===================== API for Student's Overdue Books =====================
app.get('/api/student/overdue-books', async (req, res) => {
  const { studentId } = req.query;

  if (!studentId) {
    return res.status(400).json({ success: false, message: 'Student ID is required.' });
  }

  try {
    const [overdueBooks] = await db.query(
      `SELECT 
        br.id AS borrowId,
        b.id AS bookId,
        b.title,
        b.author,
        br.borrow_date AS borrowDate,
        br.due_date AS dueDate,
        br.status
       FROM borrow_records br
       JOIN books b ON br.book_id = b.id
       WHERE br.student_id = ? 
         AND br.status = 'Active' 
         AND br.due_date < CURDATE()
       ORDER BY br.due_date ASC`,
      [studentId]
    );
    
    res.json({ success: true, books: overdueBooks || [] });
  } catch (err) {
    console.error("Error fetching student's overdue books for ID", studentId, ":", err.message);
    res.status(500).json({ success: false, error: 'Database error fetching overdue books.' });
  }
});

// ===================== API for Student's Active Bookings =====================
app.get('/api/student/bookings', async (req, res) => {
  const { studentEmail } = req.query;

  if (!studentEmail) {
    return res.status(400).json({ success: false, message: 'Student email is required to fetch bookings.' });
  }

  try {
    const [bookings] = await db.query(
      `SELECT 
        id, date, timeSlot, purpose, status, createdAt
       FROM bookings 
       WHERE email = ? AND (status = 'pending' OR status = 'confirmed')
       ORDER BY date ASC, timeSlot ASC`,
      [studentEmail]
    );
    
    res.json({ success: true, bookings: bookings || [] });
  } catch (err) {
    console.error("Error fetching student's bookings", studentEmail, ":", err.message);
    res.status(500).json({ success: false, error: 'Database error fetching student bookings.' });
  }
});


// ===================== API for Cancelling Student Booking =====================
app.post('/api/bookings/cancel', async (req, res) => {
  const { bookingId } = req.body;

  if (!bookingId) {
    return res.status(400).json({ success: false, message: 'Booking ID is required to cancel a booking.' });
  }

  try {
    const [result] = await db.query(
      "UPDATE bookings SET status = 'cancelled' WHERE id = ? AND (status = 'Pending' OR status = 'confirmed')",
      [bookingId]
    );

    if (result.affectedRows === 0) {
      // Check if it was already cancelled or not found
      const [bookingCheck] = await db.query('SELECT request_status FROM bookings WHERE id = ?', [bookingId]);
      if (bookingCheck.length === 0) {
          return res.status(404).json({ success: false, message: 'Booking not found.' });
      } else if (bookingCheck[0].request_status === 'Cancelled') {
          return res.status(400).json({ success: false, message: 'Booking already cancelled.' });
      } else {
          return res.status(400).json({ success: false, message: 'Booking cannot be cancelled in its current state.' });
      }
    }
    
    res.json({ success: true, message: 'Booking cancelled successfully.' });
  } catch (err) {
    console.error("Error cancelling booking:", err.message);
    res.status(500).json({ success: false, error: 'Database error while cancelling booking.' });
  }
});

// ===================== LIBRARIAN STATS =====================
app.get('/api/librarian/stats', async (req, res) => {
  try {
    const getCount = async (sql) => {
      const [rows] = await db.query(sql);
      return Object.values(rows[0])[0];
    };

    const totalBooks = await getCount('SELECT COUNT(*) FROM books');
    const borrowedBooks = await getCount('SELECT COUNT(*) FROM books WHERE status = "Borrowed"');
    const activeStudents = await getCount('SELECT COUNT(*) FROM students');
    const visitsToday = await getCount('SELECT COUNT(*) FROM bookings WHERE date = CURDATE()');

    res.json({
      totalBooks,
      borrowedBooks,
      activeStudents,
      visitsToday,
    });
  } catch (err) {
    console.error("Error fetching stats:", err.message);
    res.status(500).json({ error: "Failed to fetch dashboard statistics" });
  }
});

// ===================== BOOKINGS =====================
app.post("/api/bookings", async (req, res) => {
  const { name, email, date, timeSlot, purpose, notes } = req.body || {};
  if (!name || !email || !date || !timeSlot || !purpose) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const id = crypto.randomUUID();

  try {
    await db.query(
      `INSERT INTO bookings (id, name, email, date, timeSlot, purpose, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name, email, date, timeSlot, purpose, notes || ""]
    );
    res.status(201).json({ id, message: "Booking created" });
  } catch (err) {
    console.error("Insert booking error:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

// ===================== CONTACT FORM SUBMISSION =====================
app.post("/api/contact", async (req, res) => {
  const { name, email, subject, message } = req.body || {};
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  try {
    await db.query(
      `INSERT INTO contact_messages (id, name, email, subject, message, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name, email, subject, message, createdAt]
    );
    res.status(201).json({ id, message: "Message received successfully" });
  } catch (err) {
    console.error("Insert contact error:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

// ===================== API FOR MANAGING STUDENTS =====================
app.get('/api/students', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, email, course, year_level, password, role
       FROM students
       ORDER BY id ASC`
    );
    res.json({ success: true, students: rows || [] });
  } catch (err) {
    console.error("Fetch students error:", err.message);
    res.status(500).json({ success: false, error: 'Database error fetching students.' });
  }
});

// ===================== DELETE STUDENT =====================
app.delete('/api/students/:id', async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ success: false, message: 'Student ID is required.' });
  }

  try {
    const [result] = await db.query('DELETE FROM students WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    res.json({ success: true, message: `Student ${id} deleted successfully.` });
  } catch (err) {
    console.error("Delete student error:", err.message);
    res.status(500).json({ success: false, error: 'Database error deleting student.' });
  }
});


// ===================== API for Borrow Requests =====================
app.post('/api/borrow/request', async (req, res) => {
  const { bookId, studentId, pickupDate, pickupTime } = req.body;
  console.log("Received borrow request:", { bookId, studentId, pickupDate, pickupTime }); // Debug log

  if (!bookId || !studentId || !pickupDate || !pickupTime) {
    return res.status(400).json({ success: false, message: 'Missing required fields for borrow request.' });
  }

  const id = crypto.randomUUID();
  // Ensure requested_at is correctly formatted for MySQL DATETIME
  const requested_at = new Date().toISOString().slice(0, 19).replace('T', ' '); 

  try {
    await db.query(
      `INSERT INTO borrow_requests (id, student_id, book_id, pickup_date, pickup_time, request_status, requested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, studentId, bookId, pickupDate, pickupTime, 'Pending', requested_at]
    );
    res.status(201).json({ success: true, message: 'Borrow request submitted successfully.', requestId: id });
  } catch (err) {
    console.error("Borrow request error:", err.message);
    res.status(500).json({ success: false, error: 'Database error submitting borrow request.' });
  }
});

// ===================== API for Borrow Requests Actions (Accept/Reject) =====================
app.post('/api/librarian/borrow-requests/update-status', async (req, res) => {
  // TODO: Add authorization middleware here for 'librarian' or 'admin' role
  const { requestId, actionType } = req.body;

  if (!requestId || !actionType || !['Accept', 'Reject'].includes(actionType)) {
    return res.status(400).json({ success: false, message: 'Invalid request: missing ID or invalid action type.' });
  }

  let connection;
  try {
    connection = await db.getConnection(); // Get a connection from the pool
    await connection.beginTransaction(); // Start a transaction

    // 1. Get the details of the borrow request
    const [requestRows] = await connection.query(
      'SELECT br.student_id, br.book_id, b.title, b.status AS book_status FROM borrow_requests br JOIN books b ON br.book_id = b.id WHERE br.id = ? AND br.request_status = "Pending"',
      [requestId]
    );
    const request = requestRows[0];

    if (!request) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Pending borrow request not found or already processed.' });
    }

    const { student_id, book_id, title: bookTitle, book_status } = request;

    if (actionType === 'Accept') {
      if (book_status !== 'Available') {
        await connection.rollback();
        return res.status(400).json({ success: false, message: `Book "${bookTitle}" is not currently available for borrowing. Current status: ${book_status}.` });
      }

      // 2a. Update the borrow_requests table to 'Accepted'
      await connection.query('UPDATE borrow_requests SET request_status = "Accepted" WHERE id = ?', [requestId]);

      // 2b. Add a record to borrow_records (actual loan)
      const borrowDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 14); // Example: Due in 14 days
      const dueDateFormatted = dueDate.toISOString().slice(0, 10); // YYYY-MM-DD

      await connection.query(
        `INSERT INTO borrow_records (student_id, book_id, borrow_date, due_date, status)
         VALUES (?, ?, ?, ?, ?)`,
        [student_id, book_id, borrowDate, dueDateFormatted, 'Active']
      );

      // 2c. Update the books table status to 'Borrowed'
      await connection.query('UPDATE books SET status = "Borrowed" WHERE id = ?', [book_id]);

      await connection.commit(); // Commit the transaction
      res.json({ success: true, message: `Borrow request for "${bookTitle}" accepted. Book marked as Borrowed.`, bookTitle });

    } else if (actionType === 'Reject') {
      // 3. Update the borrow_requests table to 'Rejected'
      await connection.query('UPDATE borrow_requests SET request_status = "Rejected" WHERE id = ?', [requestId]);
      await connection.commit(); // Commit the transaction
      res.json({ success: true, message: `Borrow request for "${bookTitle}" rejected.`, bookTitle });
    }

  } catch (err) {
    if (connection) await connection.rollback(); // Rollback on error
    console.error(`Error processing borrow request action (${actionType}):`, err.message);
    res.status(500).json({ success: false, error: 'Database error processing borrow request.' });
  } finally {
    if (connection) connection.release(); // Release the connection
  }
});

// ===================== API FOR MANAGING BOOKINGS =====================
app.get('/api/bookings', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, email, DATE_FORMAT(date, '%Y-%m-%d') AS date, timeSlot, purpose, notes, createdAt, status
       FROM bookings 
       ORDER BY createdAt DESC`
    );
    
    res.json({ success: true, bookings: rows || [] });
  } catch (err) {
    console.error("Fetch bookings error:", err.message);
    res.status(500).json({ success: false, error: 'Database error fetching bookings.' });
  }
});

// Update booking status
app.post('/api/bookings/update-status', async (req, res) => {
  const { bookingId, newStatus } = req.body;

  if (!bookingId || !newStatus) {
    return res.status(400).json({ success: false, message: 'Missing booking ID or new status.' });
  }
  if (!['Pending', 'Confirmed', 'Cancelled'].includes(newStatus)) {
    return res.status(400).json({ success: false, message: 'Invalid status provided.' });
  }

  try {
    const [result] = await db.query(
      'UPDATE bookings SET request_status = ? WHERE id = ?',
      [newStatus, bookingId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    res.json({ success: true, message: 'Booking status updated.' });
  } catch (err) {
    console.error("Update booking status error:", err.message);
    res.status(500).json({ success: false, error: 'Database error updating booking status.' });
  }
});

// Fetch Recent Activity
app.get('/api/librarian/recent-activity', async (req, res) => {
  try {
    const [activity] = await db.query(`
      SELECT b.title as item, s.name as user, DATE_FORMAT(br.borrow_date, '%Y-%m-%d') as date
      FROM borrow_records br
      JOIN books b ON br.book_id = b.id
      JOIN students s ON br.student_id = s.id
      WHERE br.borrow_date IS NOT NULL
      ORDER BY br.borrow_date DESC
      LIMIT 5
    `);


    res.json({ success: true, activity: activity || [] });
  } catch (err) {
    console.error("Error fetching recent activity:", err.message);
    res.status(500).json({ success: false, error: 'Database error fetching recent activity.' });
  }
});

// Fetch Overdue Books
app.get('/api/librarian/overdue-books', async (req, res) => {
  // TODO: Add authorization middleware for librarians here
  try {
    const [overdueBooks] = await db.query(`
      SELECT b.id, b.title, s.name as student, DATE_FORMAT(br.due_date, '%Y-%m-%d') as dueDate
      FROM borrow_records br
      JOIN books b ON br.book_id = b.id
      JOIN students s ON br.student_id = s.id
      WHERE br.return_date IS NULL AND br.due_date < CURDATE()
      ORDER BY br.due_date ASC
    `);

    res.json({ success: true, books: overdueBooks || [] });
  } catch (err) {
    console.error("Error fetching overdue books:", err.message);
    res.status(500).json({ success: false, error: 'Database error fetching overdue books.' });
  }
});


//Accept Borrow Request
app.post('/api/borrow/accept', async (req, res) => {
  const { requestId } = req.body;
  if (!requestId) {
    return res.status(400).json({ success: false, message: 'Missing request ID.' });
  }
  try {
    // Get the borrow request details
    const [requests] = await db.query('SELECT * FROM borrow_requests WHERE id = ? AND request_status = "Pending"', [requestId]);
    const request = requests[0];
    if (!request) {
      return res.status(404).json({ success: false, message: 'Borrow request not found or already processed.' });
    }
    // Update the book status to 'Borrowed'
    const [updateBook] = await db.query('UPDATE books SET status = "Borrowed" WHERE id = ? AND status = "Available"', [request.book_id]);
    if (updateBook.affectedRows === 0) {
      return res.status(400).json({ success: false, message: 'Book is not available for borrowing.' });
    }
    // Update the borrow request status to 'Accepted' and create a borrow record
    await db.query('UPDATE borrow_requests SET request_status = "Accepted" WHERE id = ?', [requestId]);
    
    // Insert into borrow_records
    const borrowDate = new Date();
    const dueDate = new Date(borrowDate);
    dueDate.setDate(dueDate.getDate() + 7); // 7 days loan period
    await db.query(
      `INSERT INTO borrow_records (id, student_id, book_id, borrow_date, due_date, status)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), request.student_id, request.book_id, borrowDate.toISOString().slice(0, 19).replace('T', ' '), dueDate.toISOString().slice(0, 19).replace('T', ' '), 'Active']
    );
    // Commit transaction
    await db.query('COMMIT');
    res.json({ success: true, message: 'Borrow request accepted and book marked as Borrowed.' });
  } catch (err) {
    console.error("Accept borrow request error:", err.message);
    res.status(500).json({ success: false, error: 'Database error processing borrow request.' });
  }
});


// Fetch Pending Borrow Requests
app.get('/api/librarian/pending-borrows', async (req, res) => {
  // TODO: Add authorization middleware for librarians here
  try {
    const [pendingRequests] = await db.query(`
      SELECT br.id, s.name as student, b.title as book, DATE_FORMAT(br.requested_at, '%Y-%m-%d %H:%i') as requestedDate
      FROM borrow_requests br
      JOIN students s ON br.student_id = s.id
      JOIN books b ON br.book_id = b.id
      WHERE br.request_status = 'Pending'
      ORDER BY br.requested_at ASC
    `);
    
    res.json({ success: true, requests: pendingRequests || [] });
  } catch (err) {
    console.error("Error fetching pending borrow requests:", err.message);
    res.status(500).json({ success: false, error: 'Database error fetching pending borrow requests.' });
  }
});

// ===================== API FOR BOOK RETURN =====================
app.post('/api/books/return', async (req, res) => {
  // TODO: Add authorization middleware here for 'librarian' or 'admin' role
  const { book_id } = req.body;
  console.log(`Received book return request for book_id: ${book_id}`);

  if (!book_id) {
    return res.status(400).json({ success: false, message: 'Book ID is required to return a book.' });
  }

  try {
    // 1. Find the latest 'Active' record for this book
    const [borrowRecords] = await db.query(
      'SELECT id, student_id FROM borrow_records WHERE book_id = ? AND status = "Active" ORDER BY borrow_date DESC LIMIT 1',
      [book_id]
    );

    if (borrowRecords.length === 0) {
      // If no active borrowed record, check if the book even exists
      const [bookCheck] = await db.query('SELECT title, status FROM books WHERE id = ?', [book_id]);
      if (bookCheck.length === 0) {
        return res.status(404).json({ success: false, message: 'Book not found in the system.' });
      } else if (bookCheck[0].status === 'Available') {
        return res.status(400).json({ success: false, message: `Book "${bookCheck[0].title}" (ID: ${book_id}) is already marked as Available.` });
      } else {
        // Book exists but isn't marked 'Borrowed' in borrow_records or books table
        return res.status(400).json({ success: false, message: `Book "${bookCheck[0].title}" (ID: ${book_id}) is not currently marked as borrowed. Current status: ${bookCheck[0].status}.` });
      }
    }

    const borrowRecordId = borrowRecords[0].id;
    const studentId = borrowRecords[0].student_id; // For potential logging/audit

    // 2. Update the borrow_records status to 'Returned' and set return_date
    await db.query(
      'UPDATE borrow_records SET status = "Returned", return_date = NOW() WHERE id = ?',
      [borrowRecordId]
    );
    console.log(`Borrow record ${borrowRecordId} updated to Returned for book ${book_id}.`);

    // 3. Update the books table status to 'Available'
    await db.query(
      'UPDATE books SET status = "Available" WHERE id = ?',
      [book_id]
    );
    console.log(`Book ${book_id} status updated to Available in books table.`);

    // 4. Get book title for response message
    const [bookInfo] = await db.query('SELECT title FROM books WHERE id = ?', [book_id]);
    const bookTitle = bookInfo.length > 0 ? bookInfo[0].title : book_id;

    res.json({ success: true, message: `Book "${bookTitle}" returned successfully.`, bookTitle, borrowRecordId, studentId });

  } catch (err) {
    console.error('Error marking book as returned:', err.message);
    res.status(500).json({ success: false, error: 'Database error while returning book.' });
  }
});

// ===================== API for Announcements =====================
app.get('/api/announcements', async (req, res) => {
    try {
        const [announcements] = await db.query(
            `SELECT id, title, message, created_at FROM announcements ORDER BY created_at DESC`
        );
        res.json({ success: true, announcements: announcements || [] });
    } catch (err) {
        console.error("Error fetching announcements:", err.message);
        res.status(500).json({ success: false, error: 'Database error fetching announcements.' });
    }
});

// ===================== Create Announcement =====================
app.post('/api/announcements', async (req, res) => {
    const { title, message } = req.body;

    if (!title || !message) {
        return res.status(400).json({ success: false, message: "Title and message are required." });
    }

    try {
        const [result] = await db.query(
            `INSERT INTO announcements (title, message) VALUES (?, ?)`,
            [title, message]
        );

        res.status(201).json({
            success: true,
            message: "Announcement created successfully.",
            announcement: {
                id: result.insertId,
                title,
                message,
                created_at: new Date()
            }
        });
    } catch (err) {
        console.error("Error creating announcement:", err.message);
        res.status(500).json({ success: false, error: 'Database error creating announcement.' });
    }
});

// ===================== Update an Announcement =====================
app.put('/api/announcements/:id', async (req, res) => {
    const { id } = req.params;
    const { title, message } = req.body;

    if (!title || !message) {
        return res.status(400).json({ success: false, message: 'Title and message are required.' });
    }

    try {
        const [result] = await db.query(
            `UPDATE announcements SET title = ?, message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [title, message, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Announcement not found.' });
        }

        res.json({ success: true, message: 'Announcement updated successfully.' });
    } catch (err) {
        console.error("Error updating announcement:", err.message);
        res.status(500).json({ success: false, error: 'Database error updating announcement.' });
    }
});


// ===================== Delete an Announcement =====================
app.delete('/api/announcements/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await db.query(
            `DELETE FROM announcements WHERE id = ?`,
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Announcement not found.' });
        }

        res.json({ success: true, message: 'Announcement deleted successfully.' });
    } catch (err) {
        console.error("Error deleting announcement:", err.message);
        res.status(500).json({ success: false, error: 'Database error deleting announcement.' });
    }
});

// ------------------ GET ALL LIBRARIANS ------------------
app.get('/api/librarians', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, email FROM librarians ORDER BY name ASC'
    );
    res.json({ success: true, librarians: rows });
  } catch (err) {
    console.error('Error fetching librarians:', err.message);
    res.status(500).json({ success: false, message: 'Database error fetching librarians.' });
  }
});

// ------------------ ADD NEW LIBRARIAN ------------------
app.post('/api/librarians', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }

  try {
    // Check if email already exists
    const [existing] = await pool.execute('SELECT id FROM librarians WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO librarians (name, email, password) VALUES (?, ?, ?)',
      [name, email, hashedPassword]
    );

    res.status(201).json({
      success: true,
      message: 'Librarian added successfully.',
      librarian: { id: result.insertId, name, email, role }
    });
  } catch (err) {
    console.error('Error adding librarian:', err.message);
    res.status(500).json({ success: false, message: 'Database error adding librarian.' });
  }
});

// ------------------ DELETE LIBRARIAN ------------------
app.delete('/api/librarians/:id', async (req, res) => {
  const librarianId = req.params.id;

  try {
    const [result] = await pool.execute('DELETE FROM librarians WHERE id = ?', [librarianId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Librarian not found.' });
    }
    res.json({ success: true, message: 'Librarian deleted successfully.' });
  } catch (err) {
    console.error('Error deleting librarian:', err.message);
    res.status(500).json({ success: false, message: 'Database error deleting librarian.' });
  }
});

app.use('/api/books', booksRouter);

// ===================== START SERVER =====================
const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
