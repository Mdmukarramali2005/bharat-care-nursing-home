import sqlite3
import os
from werkzeug.security import generate_password_hash

DB_FILE = os.path.join(os.path.dirname(__file__), "carepulse.db")


def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(reset=False):
    conn = get_db_connection()
    cursor = conn.cursor()

    if reset:
        for table in [
            "lab_bill_items",
            "lab_bills",
            "lab_tests",
            "follow_up_notifications",
            "follow_up_plans",
            "queue_events",
            "login_attempts",
            "patient_preferences",
            "appointments",
            "whatsapp_sessions",
            "patient_reviews",
            "doctors",
            "users",
        ]:
            cursor.execute(f"DROP TABLE IF EXISTS {table}")

    # ==============================
    # USERS TABLE
    # ==============================
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'patient',
            phone TEXT,
            doctor_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (doctor_id) REFERENCES doctors(id)
        )
    """)

    # ==============================
    # DOCTORS TABLE
    # ==============================
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS doctors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            specialty TEXT NOT NULL,
            qualification TEXT NOT NULL,
            experience INTEGER NOT NULL,
            fee REAL NOT NULL,
            timing TEXT NOT NULL,
            rating REAL DEFAULT 4.9,
            phone TEXT NOT NULL,
            whatsapp_number TEXT NOT NULL,
            photo_url TEXT NOT NULL,
            about TEXT,
            available_days TEXT DEFAULT 'Mon,Tue,Wed,Thu,Fri,Sat,Sun'
        )
    """)

    # ==============================
    # APPOINTMENTS TABLE
    # ==============================
    cursor.execute("""
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP,
            FOREIGN KEY (doctor_id) REFERENCES doctors(id),
            FOREIGN KEY (patient_id) REFERENCES users(id)
        )
    """)

    # ==============================
    # WHATSAPP SESSIONS TABLE
    # ==============================
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS whatsapp_sessions (
            phone TEXT PRIMARY KEY,
            step TEXT DEFAULT 'START',
            selected_specialty TEXT,
            selected_doctor_id INTEGER,
            selected_date TEXT,
            selected_slot TEXT,
            patient_name TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # ==============================
    # PATIENT REVIEWS TABLE
    # ==============================
    cursor.execute("""
     CREATE TABLE IF NOT EXISTS patient_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        appointment_id INTEGER,
        patient_id INTEGER,
        doctor_id INTEGER,
        patient_name TEXT NOT NULL,
        patient_phone TEXT,
        doctor_name TEXT,
        rating INTEGER NOT NULL,
        review_text TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        approved_at TIMESTAMP,
        FOREIGN KEY (appointment_id) REFERENCES appointments(id),
        FOREIGN KEY (patient_id) REFERENCES users(id),
        FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    )
""")

    # ==============================
    # SAFE MIGRATIONS FOR EXISTING DATABASES
    # ==============================
    existing = {
        row[1] for row in cursor.execute("PRAGMA table_info(appointments)").fetchall()
    }
    appointment_columns = {
        "token_number": "TEXT",
        "queue_status": "TEXT DEFAULT 'waiting'",
        "fee": "REAL",
        "is_free_followup": "INTEGER DEFAULT 0",
        "original_fee": "REAL",
        "followup_of_appointment_id": "INTEGER",
        "follow_up_category": "TEXT",
        "follow_up_date": "TEXT",
        "follow_up_enabled": "INTEGER DEFAULT 1",
        "do_not_disturb": "INTEGER DEFAULT 0",
        "prescribed_tests": "TEXT",
    }
    for name, definition in appointment_columns.items():
        if name not in existing:
            cursor.execute(f"ALTER TABLE appointments ADD COLUMN {name} {definition}")

    # Backfill fee for old appointments from the doctor's current configured fee.
    cursor.execute(
        "UPDATE appointments SET fee=(SELECT fee FROM doctors WHERE doctors.id=appointments.doctor_id) WHERE fee IS NULL"
    )

    user_existing = {
        row[1] for row in cursor.execute("PRAGMA table_info(users)").fetchall()
    }
    user_columns = {
        "failed_login_attempts": "INTEGER DEFAULT 0",
        "locked_until": "TIMESTAMP",
        "last_login_at": "TIMESTAMP",
    }
    for name, definition in user_columns.items():
        if name not in user_existing:
            cursor.execute(f"ALTER TABLE users ADD COLUMN {name} {definition}")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS patient_preferences (
            patient_id INTEGER PRIMARY KEY,
            follow_up_enabled INTEGER DEFAULT 1,
            do_not_disturb INTEGER DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES users(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS follow_up_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            appointment_id INTEGER NOT NULL,
            patient_id INTEGER,
            doctor_id INTEGER NOT NULL,
            category TEXT NOT NULL,
            interval_days INTEGER,
            follow_up_date TEXT,
            enabled INTEGER DEFAULT 1,
            do_not_disturb INTEGER DEFAULT 0,
            custom_note TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (appointment_id) REFERENCES appointments(id),
            FOREIGN KEY (patient_id) REFERENCES users(id),
            FOREIGN KEY (doctor_id) REFERENCES doctors(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS feedback_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            appointment_id INTEGER UNIQUE NOT NULL,
            patient_id INTEGER,
            phone TEXT,
            doctor_name TEXT,
            message TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (appointment_id) REFERENCES appointments(id),
            FOREIGN KEY (patient_id) REFERENCES users(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS follow_up_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            follow_up_plan_id INTEGER NOT NULL,
            patient_id INTEGER,
            phone TEXT,
            message TEXT NOT NULL,
            scheduled_for TEXT NOT NULL,
            sent_at TIMESTAMP,
            status TEXT DEFAULT 'pending',
            FOREIGN KEY (follow_up_plan_id) REFERENCES follow_up_plans(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS queue_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            appointment_id INTEGER NOT NULL,
            old_status TEXT,
            new_status TEXT NOT NULL,
            changed_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (appointment_id) REFERENCES appointments(id),
            FOREIGN KEY (changed_by) REFERENCES users(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT,
            success INTEGER DEFAULT 0,
            ip_address TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Department-wise defaults. These are workflow presets, not medical advice; doctors can override them.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS lab_tests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            fee REAL NOT NULL,
            active INTEGER DEFAULT 1
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS lab_bills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER,
            patient_name TEXT NOT NULL,
            created_by INTEGER,
            total REAL NOT NULL DEFAULT 0,
            payment_status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(patient_id) REFERENCES users(id),
            FOREIGN KEY(created_by) REFERENCES users(id)
        )
    """)

    # ==============================
    # LAB BILL TOKEN / APPOINTMENT MIGRATION
    # (must run after lab_bills exists, so it works on a brand-new
    #  database too, not only on an already-populated one)
    # ==============================

    lab_bill_existing = {
       row[1] for row in cursor.execute("PRAGMA table_info(lab_bills)").fetchall()
    }

    lab_bill_columns = {
       "appointment_id": "INTEGER",
       "token_number": "TEXT",
       "doctor_id": "INTEGER",
       "doctor_name": "TEXT",
    }

    for name, definition in lab_bill_columns.items():
       if name not in lab_bill_existing:
         cursor.execute(f"ALTER TABLE lab_bills ADD COLUMN {name} {definition}")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS lab_bill_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bill_id INTEGER NOT NULL,
            test_id INTEGER NOT NULL,
            test_name TEXT NOT NULL,
            fee REAL NOT NULL,
            FOREIGN KEY(bill_id) REFERENCES lab_bills(id),
            FOREIGN KEY(test_id) REFERENCES lab_tests(id)
        )
    """)
    for name, fee in [
        ("CBC", 250),
        ("Urine Routine", 150),
        ("Blood Sugar", 100),
        ("LFT", 500),
        ("KFT", 600),
        ("Lipid Profile", 450),
        ("Thyroid Profile", 600),
        ("HbA1c", 350),
        ("Urine Culture", 450),
        ("Vitamin B12", 700),
    ]:
        cursor.execute(
            "INSERT OR IGNORE INTO lab_tests(name,fee) VALUES(?,?)", (name, fee)
        )

    appointment_existing = {
        row[1] for row in cursor.execute("PRAGMA table_info(appointments)").fetchall()
    }
    if "payment_status" not in appointment_existing:
        cursor.execute(
            "ALTER TABLE appointments ADD COLUMN payment_status TEXT DEFAULT 'pending'"
        )
    cursor.execute(
        "UPDATE appointments SET payment_status='pending' WHERE payment_status IS NULL"
    )

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS follow_up_options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            department TEXT NOT NULL,
            label TEXT NOT NULL,
            interval_days INTEGER,
            sort_order INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1
        )
    """)
    defaults = [
        ("Urology", "After 7 days", 7, 1),
        ("Urology", "After 10 days", 10, 2),
        ("Urology", "After 15 days", 15, 3),
        ("Urology", "No Follow-up", None, 4),
        ("Gynecologist & Obstetrician", "After 30 days", 30, 1),
        ("Gynecologist & Obstetrician", "After 45 days", 45, 2),
        ("Gynecologist & Obstetrician", "After 60 days", 60, 3),
        ("Gynecologist & Obstetrician", "No Follow-up", None, 4),
        ("Gynecologist & Fertility Specialist", "After 14 days", 14, 1),
        ("Gynecologist & Fertility Specialist", "After 30 days", 30, 2),
        ("Gynecologist & Fertility Specialist", "After 60 days", 60, 3),
        ("Gynecologist & Fertility Specialist", "No Follow-up", None, 4),
        ("ENT Specialist", "After 7 days", 7, 1),
        ("ENT Specialist", "After 14 days", 14, 2),
        ("ENT Specialist", "After 30 days", 30, 3),
        ("ENT Specialist", "No Follow-up", None, 4),
    ]
    for row in defaults:
        exists = cursor.execute(
            "SELECT id FROM follow_up_options WHERE department=? AND label=?",
            (row[0], row[1]),
        ).fetchone()
        if not exists:
            cursor.execute(
                "INSERT INTO follow_up_options (department,label,interval_days,sort_order) VALUES (?,?,?,?)",
                row,
            )

    # Ensure authorized cashier accounts exist even when the database was already seeded.
    default_staff_pw = generate_password_hash("password123")
    for name, email, role in [
        ("Bharat Care Cashier", "cashier@bharatcare.com", "cashier"),
        ("Bharat Care Lab Cashier", "labcashier@bharatcare.com", "lab_cashier"),
    ]:
        cursor.execute("SELECT id FROM users WHERE LOWER(email)=LOWER(?)", (email,))
        if not cursor.fetchone():
            cursor.execute(
                "INSERT INTO users (name,email,password,role,phone) VALUES (?,?,?,?,?)",
                (name, email, default_staff_pw, role, "+919472396918"),
            )

    conn.commit()

    # ==============================
    # SEED DATA
    # ==============================
    cursor.execute("SELECT COUNT(*) FROM doctors")

    if cursor.fetchone()[0] == 0:

        print("Seeding Bharat Care Nursing Home doctors & users...")

        hashed_pw = generate_password_hash("password123")

        # --------------------------
        # ADD DOCTORS FIRST
        # --------------------------

        doctors_data = [
            (
                "Dr. Bharat Prasad",
                "Urology",
                "MBBS, MS (Surgery) | Professor MGM Medical College",
                20,
                500,
                "10:00 AM - 05:00 PM (Sun: 10:00 AM - 01:00 PM)",
                4.9,
                "+919472396918",
                "+919472396918",
                "https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=400&auto=format&fit=crop&q=80",
                "Senior Urologist & Surgeon specializing in kidney stones, prostate care, laparoscopic surgery, and urinary tract disorders.",
            ),
            (
                "Dr. Nidhi Kumari",
                "Gynecologist & Obstetrician",
                "MBBS, MS (OBS & GYN) | Assistant Professor MGM Medical College",
                12,
                500,
                "10:00 AM - 05:00 PM (Sun: 10:00 AM - 01:00 PM)",
                4.9,
                "+919472396918",
                "+919472396918",
                "https://images.unsplash.com/photo-1594824813566-88855ce78961?w=400&auto=format&fit=crop&q=80",
                "Expert Gynecologist & Obstetrician specializing in high-risk pregnancy care, women's health, laparoscopic gynecology, and delivery.",
            ),
            (
                "Dr. Shalini Prasad",
                "Gynecologist & Fertility Specialist",
                "MBBS, MS (OBS & GYN) | IVF Specialist, Professor MGM Medical College",
                16,
                500,
                "10:00 AM - 05:00 PM (Sun: 10:00 AM - 01:00 PM)",
                4.9,
                "+919472396918",
                "+919472396918",
                "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=400&auto=format&fit=crop&q=80",
                "Renowned Infertility & IVF Specialist providing advanced fertility care, IUI/IVF treatments, and reproductive medicine.",
            ),
            (
                "Dr. Sachin Prasad",
                "ENT Specialist",
                "MBBS, MS (ENT) - Gold Medalist | Professor MGM Medical College",
                15,
                500,
                "10:00 AM - 05:00 PM (Sun: 10:00 AM - 01:00 PM)",
                5.0,
                "+919472396918",
                "+919472396918",
                "https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=400&auto=format&fit=crop&q=80",
                "Gold Medalist ENT Specialist expert in ear microsurgery, sinus surgery, throat disorders, hearing loss, and endoscopic nasal surgery.",
            ),
        ]

        doctor_ids = []

        for doc in doctors_data:

            cursor.execute(
                """
                INSERT INTO doctors (
                    name,
                    specialty,
                    qualification,
                    experience,
                    fee,
                    timing,
                    rating,
                    phone,
                    whatsapp_number,
                    photo_url,
                    about
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                doc,
            )

            doctor_ids.append(cursor.lastrowid)

        # --------------------------
        # MANAGER LOGIN
        # --------------------------

        cursor.execute(
            """
            INSERT INTO users
            (name, email, password, role, phone)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                "Bharat Care Manager",
                "manager@bharatcare.com",
                hashed_pw,
                "manager",
                "+919472396918",
            ),
        )

        # --------------------------
        # DOCTOR LOGINS
        # --------------------------

        doctor_logins = [
            ("Dr. Bharat Prasad", "doctor1@bharatcare.com", doctor_ids[0]),
            ("Dr. Nidhi Kumari", "doctor2@bharatcare.com", doctor_ids[1]),
            ("Dr. Shalini Prasad", "doctor3@bharatcare.com", doctor_ids[2]),
            ("Dr. Sachin Prasad", "doctor4@bharatcare.com", doctor_ids[3]),
        ]

        for name, email, doctor_id in doctor_logins:

            cursor.execute(
                """
                INSERT INTO users
                (name, email, password, role, phone, doctor_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (name, email, hashed_pw, "doctor", "+919472396918", doctor_id),
            )

        # --------------------------
        # CASHIER / LAB CASHIER LOGINS
        # --------------------------
        for name, email, role in [
            ("Bharat Care Cashier", "cashier@bharatcare.com", "cashier"),
            ("Bharat Care Lab Cashier", "labcashier@bharatcare.com", "lab_cashier"),
        ]:
            cursor.execute(
                "INSERT OR IGNORE INTO users (name,email,password,role,phone) VALUES (?,?,?,?,?)",
                (name, email, hashed_pw, role, "+919472396918"),
            )

        # --------------------------
        # DEMO PATIENT
        # --------------------------

        cursor.execute(
            """
            INSERT INTO users
            (name, email, password, role, phone)
            VALUES (?, ?, ?, ?, ?)
            """,
            ("Rahul Kumar", "rahul@example.com", hashed_pw, "patient", "+919876500000"),
        )

        patient_id = cursor.lastrowid

        # --------------------------
        # SAMPLE APPOINTMENTS
        # --------------------------

        cursor.execute(
            """
            INSERT INTO appointments (
                patient_id,
                doctor_id,
                patient_name,
                patient_phone,
                patient_email,
                patient_age,
                patient_gender,
                appointment_date,
                time_slot,
                reason,
                status,
                booking_source
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                patient_id,
                doctor_ids[0],
                "Rahul Kumar",
                "+919876500000",
                "rahul@example.com",
                30,
                "Male",
                "2026-08-10",
                "10:30 AM",
                "Kidney Checkup",
                "confirmed",
                "web",
            ),
        )

        conn.commit()

        print("Bharat Care database seeded successfully!")
        print("Manager and doctor login accounts created.")

    conn.close()


if __name__ == "__main__":
    init_db(reset=True)
