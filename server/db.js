import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, 'carepulse.db');

const verboseSqlite = sqlite3.verbose();
const db = new verboseSqlite.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err.message);
  } else {
    console.log('Connected to CarePulse SQLite database at:', dbPath);
  }
});

// Helper for Promisified Queries
export const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

export const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

export const initDb = async () => {
  console.log('Initializing database tables...');

  // Users table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'patient',
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Doctors table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS doctors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL,
      specialty TEXT NOT NULL,
      qualification TEXT NOT NULL,
      experience INTEGER NOT NULL,
      fee REAL NOT NULL,
      timing TEXT NOT NULL,
      rating REAL DEFAULT 4.8,
      phone TEXT NOT NULL,
      whatsapp_number TEXT NOT NULL,
      photo_url TEXT NOT NULL,
      about TEXT,
      available_days TEXT DEFAULT 'Mon,Tue,Wed,Thu,Fri,Sat'
    )
  `);

  // Appointments table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER,
      doctor_id INTEGER NOT NULL,
      patient_name TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      patient_email TEXT,
      patient_age INTEGER,
      patient_gender TEXT,
      appointment_date TEXT NOT NULL,
      time_slot TEXT NOT NULL,
      reason TEXT,
      status TEXT DEFAULT 'confirmed',
      booking_source TEXT DEFAULT 'web',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    )
  `);

  // WhatsApp bot sessions table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions (
      phone TEXT PRIMARY KEY,
      step TEXT DEFAULT 'START',
      selected_specialty TEXT,
      selected_doctor_id INTEGER,
      selected_date TEXT,
      selected_slot TEXT,
      patient_name TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed Data if empty
  const userCount = await dbGet('SELECT COUNT(*) as count FROM users');
  if (userCount.count === 0) {
    console.log('Seeding initial database data...');
    const hashedPass = await bcrypt.hash('password123', 10);
    
    // Seed Admin
    await dbRun(
      `INSERT INTO users (name, email, password, role, phone) VALUES (?, ?, ?, ?, ?)`,
      ['Hospital Admin', 'admin@carepulse.com', hashedPass, 'admin', '+919999988888']
    );

    // Seed Demo Patient
    const patientResult = await dbRun(
      `INSERT INTO users (name, email, password, role, phone) VALUES (?, ?, ?, ?, ?)`,
      ['Rahul Kumar', 'rahul@example.com', hashedPass, 'patient', '+919876500000']
    );

    // Seed Doctors
    const doctorsList = [
      {
        name: 'Dr. Rajesh Sharma',
        specialty: 'Cardiology',
        qualification: 'MBBS, MD - Cardiology, FACC',
        experience: 15,
        fee: 800,
        timing: '09:00 AM - 01:00 PM',
        rating: 4.9,
        phone: '+919876543210',
        whatsapp_number: '+919876543210',
        photo_url: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=400&auto=format&fit=crop&q=80',
        about: 'Senior Cardiologist specializing in heart blockages, angioplasty, hypertension, and preventative heart health care.'
      },
      {
        name: 'Dr. Anjali Mehta',
        specialty: 'Neurology',
        qualification: 'MBBS, DM - Neurology',
        experience: 12,
        fee: 1000,
        timing: '10:00 AM - 03:00 PM',
        rating: 4.8,
        phone: '+919876543211',
        whatsapp_number: '+919876543211',
        photo_url: 'https://images.unsplash.com/photo-1594824813566-88855ce78961?w=400&auto=format&fit=crop&q=80',
        about: 'Expert Neurologist with extensive experience treating migraine, epilepsy, stroke, and neuromuscular disorders.'
      },
      {
        name: 'Dr. Vikram Verma',
        specialty: 'Pediatrics',
        qualification: 'MBBS, MD - Pediatrics',
        experience: 10,
        fee: 600,
        timing: '11:00 AM - 05:00 PM',
        rating: 4.9,
        phone: '+919876543212',
        whatsapp_number: '+919876543212',
        photo_url: 'https://images.unsplash.com/photo-1537368910025-700350fe46c7?w=400&auto=format&fit=crop&q=80',
        about: 'Compassionate Child Specialist focusing on newborn care, pediatric vaccinations, growth monitoring, and seasonal infections.'
      },
      {
        name: 'Dr. Priya Nair',
        specialty: 'Dermatology',
        qualification: 'MBBS, MD - Dermatology & Cosmetology',
        experience: 8,
        fee: 700,
        timing: '02:00 PM - 07:00 PM',
        rating: 4.7,
        phone: '+919876543213',
        whatsapp_number: '+919876543213',
        photo_url: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=400&auto=format&fit=crop&q=80',
        about: 'Specialist in skin allergies, acne treatment, anti-aging therapies, laser treatments, and hair care solutions.'
      },
      {
        name: 'Dr. Amit Patel',
        specialty: 'Orthopedics',
        qualification: 'MBBS, MS - Orthopedics, Joint Replacement Specialist',
        experience: 14,
        fee: 900,
        timing: '09:30 AM - 02:30 PM',
        rating: 4.8,
        phone: '+919876543214',
        whatsapp_number: '+919876543214',
        photo_url: 'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=400&auto=format&fit=crop&q=80',
        about: 'Top Orthopedic Surgeon skilled in joint replacements, sports injuries, fracture management, and spine problems.'
      },
      {
        name: 'Dr. Sunita Gupta',
        specialty: 'General Physician',
        qualification: 'MBBS, MD - General Medicine',
        experience: 18,
        fee: 500,
        timing: '08:00 AM - 01:00 PM',
        rating: 4.9,
        phone: '+919876543215',
        whatsapp_number: '+919876543215',
        photo_url: 'https://images.unsplash.com/photo-1651008376811-b90baee60c1f?w=400&auto=format&fit=crop&q=80',
        about: 'Primary Care Physician specializing in diabetes management, hypertension, viral fevers, and comprehensive health checkups.'
      }
    ];

    for (const doc of doctorsList) {
      await dbRun(
        `INSERT INTO doctors (name, specialty, qualification, experience, fee, timing, rating, phone, whatsapp_number, photo_url, about)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          doc.name,
          doc.specialty,
          doc.qualification,
          doc.experience,
          doc.fee,
          doc.timing,
          doc.rating,
          doc.phone,
          doc.whatsapp_number,
          doc.photo_url,
          doc.about
        ]
      );
    }

    // Seed Sample Appointments
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    await dbRun(
      `INSERT INTO appointments (patient_id, doctor_id, patient_name, patient_phone, patient_email, patient_age, patient_gender, appointment_date, time_slot, reason, status, booking_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [patientResult.lastID, 1, 'Rahul Kumar', '+919876500000', 'rahul@example.com', 29, 'Male', tomorrow, '10:00 AM', 'Routine Heart Checkup', 'confirmed', 'web']
    );

    await dbRun(
      `INSERT INTO appointments (patient_id, doctor_id, patient_name, patient_phone, patient_email, patient_age, patient_gender, appointment_date, time_slot, reason, status, booking_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [null, 2, 'Suresh Sharma', '+919811122233', 'suresh@example.com', 45, 'Male', tomorrow, '11:30 AM', 'Migraine consultation', 'confirmed', 'whatsapp']
    );

    console.log('Database seeded successfully!');
  }
};

export default db;
