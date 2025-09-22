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

  const query = 'SELECT * FROM student WHERE email = ?';
  db.get(query, [email], async (err, user) => { // db.get for a single row
    if (err) {
      console.error(err);
      return res.json({ success: false, message: 'Database error' });
    }
    if (!user) {
      return res.json({ success: false, message: 'Student not found' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.json({ success: false, message: 'Incorrect password' });
    }

    res.json({
      success: true,
      name: user.name,
      studentId: user.id
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

  db.get('SELECT * FROM student WHERE id = ?', [id], (err, row) => {
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

app.use('/api/books', booksRouter);

// ===================== START SERVER =====================
const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));