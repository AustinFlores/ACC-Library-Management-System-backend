const express = require('express');
const QRCode = require('qrcode');
const cors = require('cors');
const bcrypt = require('bcrypt');
const booksRouter = require('./routes/books');
const db = require('./db'); // This now connects to SQLite
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(cors());

const SALT_ROUNDS = 10;

// ===================== SIGNUP =====================
app.post('/signup', (req, res) => {
  const { id, name, email, course, year_level, password } = req.body;

  const checkQuery = 'SELECT * FROM student WHERE id = ? OR email = ?';
  db.get(checkQuery, [id, email], async (err, row) => {
    if (err) {
      console.error("Signup check error:", err.message);
      return res.json({ success: false, message: 'Database error' });
    }
    if (row) {
      return res.json({ success: false, message: 'ID or email already exists' });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

      const insertQuery = `
        INSERT INTO student (id, name, email, course, year_level, password)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      db.run(insertQuery, [id, name, email, course, year_level, hashedPassword], (err) => {
        if (err) {
          console.error("Signup insert error:", err.message);
          return res.json({ success: false, message: 'Database error during insert' });
        }
        res.json({
          success: true,
          message: 'Signup successful. You can now generate your QR code.'
        });
      });
    } catch (hashError) {
      console.error(hashError);
      res.json({ success: false, message: 'Error during signup' });
    }
  });
});

// ===================== SIGNIN =====================
app.post('/signin', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  // Step 1: Check if the user is a librarian
  const librarianQuery = 'SELECT * FROM librarians WHERE email = ?';
  db.get(librarianQuery, [email], async (err, librarian) => {
    if (err) {
      console.error("Database error (librarian check):", err.message);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    // --- If a librarian is found ---
    if (librarian) {
      const isMatch = await bcrypt.compare(password, librarian.password);
      if (isMatch) {
        // Successful librarian login
        return res.json({
          success: true,
          name: librarian.name,
          role: librarian.role, // e.g., 'librarian'
        });
      } else {
        // Found the user but the password was wrong. Fail immediately.
        return res.json({ success: false, message: 'Invalid credentials' });
      }
    }

    // --- Step 2: If no librarian was found, check if the user is a student ---
    const studentQuery = 'SELECT id, name, email, course, year_level, password, role FROM student WHERE email = ?';
    db.get(studentQuery, [email], async (err, student) => {
      if (err) {
        console.error("Database error (student check):", err.message);
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      // --- If a student is found ---
      if (student) {
        console.log("Student found:", student.email);
        const isMatch = await bcrypt.compare(password, student.password);
        if (isMatch) {
          // Successful student login
          return res.json({
            success: true,
            name: student.name,
            studentId: student.id,
            role: student.role || 'student'
          });
        }
      }

      // --- If user is not found in either table or password was wrong for student ---
      // We use a generic message for security to prevent attackers from knowing if an email exists.
      return res.json({ success: false, message: 'Invalid credentials' });
    });
  });
});

// ===================== GENERATE QR (On-Demand) =====================
app.get('/generate-qr', (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ success: false, message: "Missing student ID" });

  const query = 'SELECT * FROM student WHERE id = ?';
  db.get(query, [id], async (err, row) => {
    if (err) {
      console.error(err);
      return res.json({ success: false, message: 'Database error' });
    }
    if (!row) {
      return res.json({ success: false, message: 'Student not found' });
    }

    try {
      const qrData = `http://localhost:3000/scan?id=${id}`;
      const qrBase64 = await QRCode.toDataURL(qrData);
      res.json({ success: true, qrImage: qrBase64 });
    } catch (error) {
      console.error(error);
      res.json({ success: false, message: 'Failed to generate QR code' });
    }
  });
});

// ===================== VERIFY (Using Student ID) =====================
app.get('/verify', (req, res) => {
  const { id } = req.query;
  if (!id) return res.json({ success: false, message: 'No ID provided' });

  db.get('SELECT id, name, email, course, year_level, password, role FROM student WHERE id = ?', [id], (err, row) => {
    if (err) {
      console.error(err);
      return res.json({ success: false, message: 'Database error' });
    }
    if (!row) {
      return res.json({ success: false, message: 'Invalid QR code' });
    }
    res.json({ success: true, user: row });
  });
});

// ===================== LIBRARIAN STATS =====================
app.get('/api/librarian/stats', async (req, res) => {
  try {
    // Helper function to run a single query and return its result
    const getCount = (sql) => new Promise((resolve, reject) => {
      db.get(sql, [], (err, row) => {
        if (err) return reject(err);
        resolve(row ? Object.values(row)[0] : 0); // Get the first column value (e.g., count)
      });
    });

    const totalBooks = await getCount('SELECT COUNT(*) FROM books');
    const borrowedBooks = await getCount('SELECT COUNT(*) FROM books WHERE status = "Borrowed"');
    const activeStudents = await getCount('SELECT COUNT(*) FROM student');
    
    // For visits today, SQLite's date('now') returns YYYY-MM-DD
    const visitsToday = await getCount('SELECT COUNT(*) FROM bookings WHERE date = date("now")');

    res.json({
      totalBooks,
      borrowedBooks,
      activeStudents,
      visitsToday,
    });

  } catch (err) {
    console.error("Error fetching admin stats:", err.message);
    res.status(500).json({ error: "Failed to fetch dashboard statistics" });
  }
});


// ===================== BOOKINGS =====================
app.post("/api/bookings", (req, res) => {
  const { name, email, date, timeSlot, purpose, notes } = req.body || {};
  if (!name || !email || !date || !timeSlot || !purpose) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const sql = `
    INSERT INTO bookings (id, name, email, date, timeSlot, purpose, notes, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.run(
    sql,
    [id, name, email, date, timeSlot, purpose, notes || "", createdAt],
    (err) => {
      if (err) {
        console.error("Insert booking error:", err.message);
        return res.status(500).json({ error: "Database error" });
      }
      return res.status(201).json({ id, message: "Booking created" });
    }
  );
});

// ===================== CONTACT FORM SUBMISSION =====================
app.post("/api/contact", (req, res) => {
  const { name, email, subject, message } = req.body || {};
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const sql = `
    INSERT INTO contact_messages (id, name, email, subject, message, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  const params = [id, name, email, subject, message, createdAt];

  db.run(sql, params, function (err) {
    if (err) {
      console.error("Insert contact message error:", err.message);
      return res.status(500).json({ error: "Database error" });
    }
    return res.status(201).json({ id, message: "Message received successfully" });
  });
});

// ===================== API FOR MANAGING STUDENTS =====================
app.get('/api/students', (req, res) => {
  const sql = `
    SELECT id, name, email, year_level, password, role
    FROM student
    ORDER BY id ASC
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Error fetching students:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Database error fetching students.',
      });
    }

    // rows is ALWAYS an array with sqlite3
    res.json({
      success: true,
      students: rows || [],
    });
  });
});

//for future use (suspend/activate student)
app.post('/api/students/toggle-status', async (req, res) => {
  // TODO: Add authorization middleware here
  const { studentId, newStatus } = req.body;
  if (!studentId || !newStatus) {
    return res.status(400).json({ success: false, message: 'Missing student ID or new status.' });
  }
  if (!['Active', 'Suspended'].includes(newStatus)) {
    return res.status(400).json({ success: false, message: 'Invalid status provided.' });
  }

  try {
    const result = db.run('UPDATE student SET status = ? WHERE id = ?', [newStatus, studentId]);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    res.json({ success: true, message: 'Student status updated.' });
  } catch (err) {
    console.error('Error toggling student status:', err.message);
    res.status(500).json({ success: false, error: 'Database error updating student status.' });
  }
});

// ===================== API FOR MANAGING BOOKINGS =====================
app.get('/api/bookings', (req, res) => {
  // TODO: Add authorization middleware here
  db.all(
    `SELECT id, name, email, date, timeSlot, purpose, notes, createdAt, status 
     FROM bookings 
     ORDER BY createdAt DESC`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Error fetching bookings:', err.message);
        return res.status(500).json({ success: false, error: 'Database error fetching bookings.' });
      }
      res.json({ success: true, bookings: rows || [] });
    }
  );
});

app.post('/api/bookings/update-status', (req, res) => {
  const { bookingId, newStatus } = req.body;

  if (!bookingId || !newStatus) {
    return res.status(400).json({ success: false, message: 'Missing booking ID or new status.' });
  }
  if (!['Pending', 'Confirmed', 'Cancelled'].includes(newStatus)) {
    return res.status(400).json({ success: false, message: 'Invalid status provided.' });
  }

  db.run(
    'UPDATE bookings SET request_status = ? WHERE id = ?',
    [newStatus, bookingId],
    function (err) {
      if (err) {
        console.error('Error updating booking status:', err.message);
        return res.status(500).json({ success: false, error: 'Database error updating booking status.' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'Booking not found.' });
      }

      res.json({ success: true, message: 'Booking status updated.' });
    }
  );
});


app.use('/api/books', booksRouter);

// ===================== START SERVER =====================
const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));