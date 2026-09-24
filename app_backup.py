from flask import Flask, request, jsonify, render_template
import jwt
import datetime
import os
import secrets
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash
from database import get_db_connection, init_db

app = Flask(__name__, static_folder="static", template_folder="templates")

SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-change-this-secret")
app.config["SECRET_KEY"] = SECRET_KEY

# Initialize database
init_db()


# =========================================================
# APPOINTMENT BOOKING RULES
# =========================================================

MAX_PATIENTS_PER_SLOT = 15

TIME_SLOTS = {
    "10:00 AM - 11:15 AM": "10:00",
    "11:15 AM - 12:30 PM": "11:15",
    "12:45 PM - 02:00 PM": "12:45",
    "02:00 PM - 03:15 PM": "14:00",
}


def get_allowed_booking_dates():
    """Booking is allowed for Today, Tomorrow and Day After Tomorrow."""
    today = datetime.date.today()
    return [
        today,
        today + datetime.timedelta(days=1),
        today + datetime.timedelta(days=2),
    ]


def validate_booking_date(appointment_date):
    """Validate that the requested date is within the 3-day booking window."""
    try:
        selected_date = datetime.datetime.strptime(appointment_date, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return False, "Invalid appointment date. Use YYYY-MM-DD."

    if selected_date not in get_allowed_booking_dates():
        return (
            False,
            "Appointment booking is available only for today, tomorrow and the day after tomorrow.",
        )

    return True, selected_date


def is_past_slot(appointment_date, time_slot):
    """
    For today's appointment, a slot is unavailable once its start time
    has arrived or passed.
    """
    try:
        selected_date = datetime.datetime.strptime(appointment_date, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return True

    if selected_date != datetime.date.today():
        return False

    if time_slot not in TIME_SLOTS:
        return True

    slot_time = datetime.datetime.strptime(TIME_SLOTS[time_slot], "%H:%M").time()

    current_time = datetime.datetime.now().time()

    return current_time >= slot_time


def get_slot_count(conn, doctor_id, appointment_date, time_slot):
    """Return the number of confirmed patients in one doctor/date/slot."""
    row = conn.execute(
        """
        SELECT COUNT(*) AS count
        FROM appointments
        WHERE doctor_id = ?
          AND appointment_date = ?
          AND time_slot = ?
          AND status IN ('confirmed', 'completed')
        """,
        (doctor_id, appointment_date, time_slot),
    ).fetchone()

    return row["count"] if row else 0


def get_slot_status(conn, doctor_id, appointment_date):
    """
    Return live status for all four appointment slots.

    Slots open strictly in order: slot 2 is bookable only once slot 1 is
    completely full (or its time has passed), slot 3 only once slot 2 is
    full/past, and so on. Each slot's "is_locked" flag tells the caller
    (web form, WhatsApp bot) whether new bookings are allowed into it yet.
    """
    slots = []

    previous_cleared = True  # the first slot is always open

    for slot in TIME_SLOTS:
        booked = get_slot_count(conn, doctor_id, appointment_date, slot)

        seats_left = max(MAX_PATIENTS_PER_SLOT - booked, 0)

        is_full = booked >= MAX_PATIENTS_PER_SLOT
        is_past = is_past_slot(appointment_date, slot)

        is_locked = not previous_cleared

        slots.append(
            {
                "slot": slot,
                "booked": booked,
                "seats_left": seats_left,
                "is_full": is_full,
                "is_past": is_past,
                "is_locked": is_locked,
            }
        )

        # This slot clears the way for the next slot only once it is
        # itself full or its time has passed.
        previous_cleared = previous_cleared and (is_full or is_past)

    return slots


# =========================================================
# DASHBOARD HELPERS
# =========================================================


def get_dashboard_doctor_ids(current_user, conn):
    """
    Doctor can access only their own doctor_id.
    Manager, cashier and lab_cashier can access all doctors
    (front-desk/billing staff need to see every doctor's queue).
    """

    if current_user["role"] == "doctor":
        if not current_user.get("doctor_id"):
            return []

        return [current_user["doctor_id"]]

    if current_user["role"] in ("manager", "cashier", "lab_cashier"):
        doctors = conn.execute("SELECT id FROM doctors ORDER BY id").fetchall()

        return [doctor["id"] for doctor in doctors]

    return []


def get_doctor_today_summary(conn, doctor_id, date_value):
    """
    Return booking, completed, pending and vacant
    summary for one doctor on one date.
    """

    total_bookings = conn.execute(
        """
        SELECT COUNT(*) AS count
        FROM appointments
        WHERE doctor_id = ?
          AND appointment_date = ?
          AND status IN ('confirmed', 'completed')
        """,
        (doctor_id, date_value),
    ).fetchone()["count"]

    completed = conn.execute(
        """
        SELECT COUNT(*) AS count
        FROM appointments
        WHERE doctor_id = ?
          AND appointment_date = ?
          AND status = 'completed'
        """,
        (doctor_id, date_value),
    ).fetchone()["count"]

    pending = conn.execute(
        """
        SELECT COUNT(*) AS count
        FROM appointments
        WHERE doctor_id = ?
          AND appointment_date = ?
          AND status = 'confirmed'
        """,
        (doctor_id, date_value),
    ).fetchone()["count"]

    total_capacity = len(TIME_SLOTS) * MAX_PATIENTS_PER_SLOT

    vacant = max(total_capacity - total_bookings, 0)

    return {
        "total_bookings": total_bookings,
        "completed": completed,
        "pending": pending,
        "vacant": vacant,
        "total_capacity": total_capacity,
    }


def get_dashboard_slot_status(conn, doctor_id, date_value):

    slots = []

    for slot in TIME_SLOTS:

        booked = conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM appointments
            WHERE doctor_id = ?
              AND appointment_date = ?
              AND time_slot = ?
              AND status IN ('confirmed', 'completed')
            """,
            (doctor_id, date_value, slot),
        ).fetchone()["count"]

        completed = conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM appointments
            WHERE doctor_id = ?
              AND appointment_date = ?
              AND time_slot = ?
              AND status = 'completed'
            """,
            (doctor_id, date_value, slot),
        ).fetchone()["count"]

        pending = conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM appointments
            WHERE doctor_id = ?
              AND appointment_date = ?
              AND time_slot = ?
              AND status = 'confirmed'
            """,
            (doctor_id, date_value, slot),
        ).fetchone()["count"]

        vacant = max(MAX_PATIENTS_PER_SLOT - booked, 0)

        slots.append(
            {
                "slot": slot,
                "capacity": MAX_PATIENTS_PER_SLOT,
                "booked": booked,
                "completed": completed,
                "pending": pending,
                "vacant": vacant,
                "is_full": booked >= MAX_PATIENTS_PER_SLOT,
            }
        )

    return slots


# =========================================================
# QUEUE / FOLLOW-UP HELPERS
# =========================================================

DEPARTMENT_CODES = {
    "Urology": "URO",
    "Gynecologist & Obstetrician": "GYN",
    "Gynecologist & Fertility Specialist": "FRT",
    "ENT Specialist": "ENT",
}


def get_department_code(specialty):
    return DEPARTMENT_CODES.get(specialty, "OPD")


def next_token(conn, doctor_id, appointment_date, specialty):
    prefix = get_department_code(specialty)
    row = conn.execute(
        "SELECT COUNT(*) AS count FROM appointments WHERE doctor_id=? AND appointment_date=?",
        (doctor_id, appointment_date),
    ).fetchone()
    return f"{prefix}-{(row['count'] or 0) + 1:02d}"


def get_follow_up_options(conn, department):
    rows = conn.execute(
        "SELECT label, interval_days FROM follow_up_options WHERE department=? AND active=1 ORDER BY sort_order",
        (department,),
    ).fetchall()
    return [dict(r) for r in rows]


def build_followup_message(plan, doctor_name):
    return (
        f"🏥 Bharat Care reminder\\n\\n"
        f"Hello, your follow-up with {doctor_name} is due today.\\n"
        f"Reply BOOK to request an appointment or STOP to disable routine follow-up reminders."
    )


# =========================================================
# AUTHENTICATION
# =========================================================


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None

        if "Authorization" in request.headers:
            auth_header = request.headers["Authorization"]
            if auth_header.startswith("Bearer "):
                token = auth_header.split(" ", 1)[1]

        if not token:
            token = request.args.get("token")

        if not token:
            return jsonify({"message": "Token is missing!", "success": False}), 401

        try:
            data = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])

            conn = get_db_connection()
            user = conn.execute(
                """
                SELECT id, name, email, role, phone, doctor_id
                FROM users
                WHERE id = ?
                """,
                (data["user_id"],),
            ).fetchone()
            conn.close()

            if not user:
                return jsonify({"message": "User not found!", "success": False}), 401

            current_user = dict(user)

        except Exception as e:
            return (
                jsonify(
                    {"message": "Invalid token!", "error": str(e), "success": False}
                ),
                401,
            )

        return f(current_user, *args, **kwargs)

    return decorated


# =========================================================
# HOME
# =========================================================


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/dashboard")
def dashboard_page():
    return render_template("dashboard.html")


# =========================================================
# AUTH ENDPOINTS
# =========================================================


@app.route("/api/auth/register", methods=["POST"])
def register():
    data = request.get_json() or {}

    name = data.get("name")
    email = data.get("email")
    password = data.get("password")
    phone = data.get("phone", "")

    if not name or not email or not password:
        return (
            jsonify(
                {"message": "Name, email, and password are required.", "success": False}
            ),
            400,
        )

    conn = get_db_connection()

    existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()

    if existing:
        conn.close()
        return (
            jsonify({"message": "Email is already registered.", "success": False}),
            400,
        )

    hashed_pw = generate_password_hash(password)

    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO users (name, email, password, role, phone)
        VALUES (?, ?, ?, ?, ?)
        """,
        (name, email, hashed_pw, "patient", phone),
    )

    conn.commit()
    user_id = cursor.lastrowid
    conn.close()

    token = jwt.encode(
        {
            "user_id": user_id,
            "exp": (
                datetime.datetime.now(datetime.timezone.utc)
                + datetime.timedelta(days=7)
            ),
        },
        SECRET_KEY,
        algorithm="HS256",
    )

    return jsonify(
        {
            "success": True,
            "message": "Registration successful!",
            "token": token,
            "user": {
                "id": user_id,
                "name": name,
                "email": email,
                "role": "patient",
                "phone": phone,
            },
        }
    )


@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json() or {}
    identifier = str(data.get("identifier", data.get("email", ""))).strip()
    password = data.get("password") or ""
    login_type = str(data.get("login_type", "patient")).lower()
    requested_role = str(data.get("requested_role", "patient")).lower()

    staff_roles = {"doctor", "manager", "cashier", "lab_cashier"}
    if login_type not in {"patient", "staff"}:
        return jsonify({"message": "Invalid login type.", "success": False}), 400
    if login_type == "staff" and requested_role not in staff_roles:
        return jsonify({"message": "Invalid hospital staff role.", "success": False}), 400
    if not identifier or not password:
        return jsonify({"message": ("Hospital email and password are required." if login_type == "staff" else "Email/mobile number and password are required."), "success": False}), 400

    conn = get_db_connection()
    if login_type == "patient":
        user = conn.execute("SELECT * FROM users WHERE role = 'patient' AND (LOWER(email) = LOWER(?) OR phone = ?)", (identifier, identifier)).fetchone()
    else:
        user = conn.execute("SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND role = ?", (identifier, requested_role)).fetchone()

    now = datetime.datetime.now(datetime.timezone.utc)
    if user and user["locked_until"]:
        try:
            locked = datetime.datetime.fromisoformat(str(user["locked_until"]).replace("Z", "+00:00"))
            if locked.tzinfo is None:
                locked = locked.replace(tzinfo=datetime.timezone.utc)
            if locked > now:
                conn.close()
                return jsonify({"message": "Too many failed attempts. Please try again later.", "success": False}), 429
        except ValueError:
            pass

    valid = bool(user and check_password_hash(user["password"], password))
    conn.execute("INSERT INTO login_attempts (email, success, ip_address) VALUES (?,?,?)", (identifier.lower(), int(valid), request.remote_addr))
    if not valid:
        if user:
            attempts = (user["failed_login_attempts"] or 0) + 1
            locked_until = None
            if attempts >= 5:
                locked_until = (now + datetime.timedelta(minutes=15)).isoformat()
                attempts = 0
            conn.execute("UPDATE users SET failed_login_attempts=?, locked_until=? WHERE id=?", (attempts, locked_until, user["id"]))
        conn.commit(); conn.close()
        return jsonify({"message": "Invalid login details.", "success": False}), 401

    conn.execute("UPDATE users SET failed_login_attempts=0, locked_until=NULL, last_login_at=? WHERE id=?", (now.isoformat(), user["id"]))
    conn.commit(); conn.close()
    token = jwt.encode({"user_id": user["id"], "exp": now + datetime.timedelta(days=7)}, SECRET_KEY, algorithm="HS256")
    return jsonify({"success": True, "message": "Login successful!", "token": token, "user": {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"], "phone": user["phone"], "doctor_id": user["doctor_id"]}})


@app.route("/api/auth/me", methods=["GET"])
@token_required
def get_me(current_user):
    return jsonify({"success": True, "user": current_user})


# =========================================================
# DOCTOR ENDPOINTS
# =========================================================


@app.route("/api/doctors", methods=["GET"])
def get_doctors():
    specialty = request.args.get("specialty")
    search = request.args.get("search")

    query = "SELECT * FROM doctors WHERE 1=1"
    params = []

    if specialty and specialty.strip() and specialty != "All":
        query += " AND specialty = ?"
        params.append(specialty)

    if search and search.strip():
        query += """
            AND (
                name LIKE ?
                OR specialty LIKE ?
                OR qualification LIKE ?
            )
        """
        term = f"%{search.strip()}%"
        params.extend([term, term, term])

    conn = get_db_connection()
    doctors = conn.execute(query, params).fetchall()
    conn.close()

    return jsonify({"success": True, "doctors": [dict(doc) for doc in doctors]})


@app.route("/api/doctors/<int:doc_id>", methods=["GET"])
def get_doctor_detail(doc_id):
    conn = get_db_connection()

    doctor = conn.execute("SELECT * FROM doctors WHERE id = ?", (doc_id,)).fetchone()

    conn.close()

    if not doctor:
        return jsonify({"success": False, "message": "Doctor not found"}), 404

    return jsonify({"success": True, "doctor": dict(doctor)})


# =========================================================
# APPOINTMENT ENDPOINTS
# =========================================================


@app.route("/api/appointments/slots", methods=["GET"])
def get_appointment_slots():
    doctor_id = request.args.get("doctor_id", type=int)
    appointment_date = request.args.get("appointment_date")

    if not doctor_id or not appointment_date:
        return (
            jsonify(
                {
                    "success": False,
                    "message": "doctor_id and appointment_date are required.",
                }
            ),
            400,
        )

    valid, result = validate_booking_date(appointment_date)

    if not valid:
        return jsonify({"success": False, "message": result}), 400

    conn = get_db_connection()

    doctor = conn.execute(
        "SELECT id FROM doctors WHERE id = ?", (doctor_id,)
    ).fetchone()

    if not doctor:
        conn.close()
        return jsonify({"success": False, "message": "Doctor not found."}), 404

    slots = get_slot_status(conn, doctor_id, appointment_date)

    conn.close()

    return jsonify(
        {
            "success": True,
            "appointment_date": appointment_date,
            "max_patients_per_slot": MAX_PATIENTS_PER_SLOT,
            "slots": slots,
        }
    )


@app.route("/api/appointments", methods=["POST"])
def create_appointment():
    data = request.get_json() or {}

    doctor_id = data.get("doctor_id")
    patient_name = data.get("patient_name")
    patient_phone = data.get("patient_phone")
    patient_email = data.get("patient_email", "")
    patient_age = data.get("patient_age", 30)
    patient_gender = data.get("patient_gender", "Other")
    appointment_date = data.get("appointment_date")
    time_slot = data.get("time_slot")
    reason = data.get("reason", "General OPD Consultation")
    patient_id = data.get("patient_id")
    booking_source = data.get("booking_source", "web")

    if (
        not doctor_id
        or not patient_name
        or not patient_phone
        or not appointment_date
        or not time_slot
    ):
        return (
            jsonify(
                {
                    "success": False,
                    "message": (
                        "Doctor, patient name, phone, date, "
                        "and time slot are required."
                    ),
                }
            ),
            400,
        )

    valid, date_result = validate_booking_date(appointment_date)

    if not valid:
        return jsonify({"success": False, "message": date_result}), 400

    if time_slot not in TIME_SLOTS:
        return (
            jsonify({"success": False, "message": "Invalid appointment time slot."}),
            400,
        )

    if is_past_slot(appointment_date, time_slot):
        return (
            jsonify(
                {
                    "success": False,
                    "message": (
                        "This time slot has already started or passed. "
                        "Please select a future available slot."
                    ),
                }
            ),
            400,
        )

    conn = get_db_connection()

    try:
        # Lock before final count + insert so two users cannot take
        # the same last seat at the same time.
        conn.execute("BEGIN IMMEDIATE")

        doctor = conn.execute(
            """
            SELECT name, specialty
            FROM doctors
            WHERE id = ?
            """,
            (doctor_id,),
        ).fetchone()

        if not doctor:
            conn.rollback()
            conn.close()
            return jsonify({"success": False, "message": "Doctor not found"}), 404

        slot_status = get_slot_status(conn, doctor_id, appointment_date)
        current_slot_info = next(
            (s for s in slot_status if s["slot"] == time_slot), None
        )
        current_slot_count = current_slot_info["booked"] if current_slot_info else 0

        if current_slot_info and current_slot_info["is_locked"]:
            conn.rollback()
            conn.close()

            next_open = next(
                (s["slot"] for s in slot_status if not s["is_full"] and not s["is_past"]),
                None,
            )

            return (
                jsonify(
                    {
                        "success": False,
                        "message": (
                            f"{time_slot} is not open yet. "
                            + (
                                f"Please book the {next_open} slot first — "
                                "it will open once that fills up."
                                if next_open
                                else "Please select an earlier available slot."
                            )
                        ),
                    }
                ),
                400,
            )

        # Every new booking is charged the doctor's normal consultation
        # fee. "Free Follow-up" is no longer decided at booking time — it
        # is set manually by the front-desk Cashier, on the day of the
        # visit, after physically checking the doctor's prescription.
        is_free_followup = 0
        followup_of_id = None
        appointment_fee = float(conn.execute("SELECT fee FROM doctors WHERE id=?", (doctor_id,)).fetchone()["fee"])

        token_number = next_token(conn, doctor_id, appointment_date, doctor["specialty"])

        if current_slot_count >= MAX_PATIENTS_PER_SLOT:
            conn.rollback()
            conn.close()

            return (
                jsonify(
                    {
                        "success": False,
                        "message": (
                            f"Sorry, {time_slot} is fully booked. "
                            f"{MAX_PATIENTS_PER_SLOT}/{MAX_PATIENTS_PER_SLOT} "
                            "patients are already booked. "
                            "Please select another available slot."
                        ),
                    }
                ),
                400,
            )

        cursor = conn.cursor()

        cursor.execute(
            """
            INSERT INTO appointments
            (
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
                booking_source,
                token_number,
                queue_status,
                fee,
                is_free_followup,
                followup_of_appointment_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, 'waiting', ?, ?, ?)
            """,
            (
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
                booking_source,
                token_number,
                appointment_fee,
                is_free_followup,
                followup_of_id,
            ),
        )

        conn.commit()
        appt_id = cursor.lastrowid

    except Exception as e:
        conn.rollback()
        conn.close()

        return (
            jsonify(
                {"success": False, "message": f"Appointment booking failed: {str(e)}"}
            ),
            500,
        )

    conn.close()

    return jsonify(
        {
            "success": True,
            "message": (
                f"Appointment successfully booked with "
                f"{doctor['name']} at Bharat Care Nursing Home!"
            ),
            "appointment_id": appt_id,
            "details": {
                "id": appt_id,
                "doctor_name": doctor["name"],
                "specialty": doctor["specialty"],
                "appointment_date": appointment_date,
                "time_slot": time_slot,
                "patient_name": patient_name,
                "patient_phone": patient_phone,
                "status": "confirmed",
                "booking_source": booking_source,
                "token_number": token_number,
                "fee": appointment_fee,
                "is_free_followup": bool(is_free_followup),
            },
        }
    )


@app.route("/api/appointments/my", methods=["GET"])
def get_my_appointments():
    phone = request.args.get("phone")
    patient_id = request.args.get("patient_id")

    if not phone and not patient_id:
        return (
            jsonify({"success": False, "message": "Phone or patient_id is required"}),
            400,
        )

    conn = get_db_connection()

    if patient_id:
        query = """
            SELECT
                a.*,
                d.name AS doctor_name,
                d.specialty AS doctor_specialty,
                d.photo_url AS doctor_photo,
                d.fee AS doctor_fee
            FROM appointments a
            JOIN doctors d ON a.doctor_id = d.id
            WHERE a.patient_id = ? OR a.patient_phone = ?
            ORDER BY a.id DESC
        """

        appts = conn.execute(query, (patient_id, phone or "")).fetchall()

    else:
        query = """
            SELECT
                a.*,
                d.name AS doctor_name,
                d.specialty AS doctor_specialty,
                d.photo_url AS doctor_photo,
                d.fee AS doctor_fee
            FROM appointments a
            JOIN doctors d ON a.doctor_id = d.id
            WHERE a.patient_phone = ?
            ORDER BY a.id DESC
        """

        appts = conn.execute(query, (phone,)).fetchall()

    conn.close()

    return jsonify({"success": True, "appointments": [dict(a) for a in appts]})


@app.route("/api/appointments/all", methods=["GET"])
def get_all_appointments():
    conn = get_db_connection()

    query = """
        SELECT
            a.*,
            d.name AS doctor_name,
            d.specialty AS doctor_specialty,
            d.fee AS doctor_fee
        FROM appointments a
        JOIN doctors d ON a.doctor_id = d.id
        ORDER BY a.id DESC
    """

    appts = conn.execute(query).fetchall()
    conn.close()

    return jsonify({"success": True, "appointments": [dict(a) for a in appts]})


# =========================================================
# DOCTOR / MANAGER DASHBOARD
# =========================================================


@app.route("/api/dashboard/stats", methods=["GET"])
@token_required
def dashboard_stats(current_user):

    if current_user["role"] not in ["doctor", "manager", "cashier", "lab_cashier"]:
        return jsonify({"success": False, "message": "Access denied."}), 403

    selected_date = request.args.get("date", datetime.date.today().isoformat())

    conn = get_db_connection()

    doctor_ids = get_dashboard_doctor_ids(current_user, conn)

    if not doctor_ids:
        conn.close()

        return jsonify({"success": False, "message": "No doctor account linked."}), 403

    summaries = []

    for doctor_id in doctor_ids:

        doctor = conn.execute(
            """
            SELECT id, name, specialty
            FROM doctors
            WHERE id = ?
            """,
            (doctor_id,),
        ).fetchone()

        if not doctor:
            continue

        summary = get_doctor_today_summary(conn, doctor_id, selected_date)

        summaries.append({"doctor": dict(doctor), **summary})

    conn.close()

    total_bookings = sum(item["total_bookings"] for item in summaries)

    total_completed = sum(item["completed"] for item in summaries)

    total_pending = sum(item["pending"] for item in summaries)

    total_vacant = sum(item["vacant"] for item in summaries)

    return jsonify(
        {
            "success": True,
            "date": selected_date,
            "role": current_user["role"],
            "summary": {
                "total_bookings": total_bookings,
                "completed": total_completed,
                "pending": total_pending,
                "vacant": total_vacant,
            },
            "doctor_summaries": summaries,
        }
    )


@app.route("/api/dashboard/slots", methods=["GET"])
@token_required
def dashboard_slots(current_user):

    if current_user["role"] not in ["doctor", "manager", "cashier", "lab_cashier"]:
        return jsonify({"success": False, "message": "Access denied."}), 403

    selected_date = request.args.get("date", datetime.date.today().isoformat())

    requested_doctor_id = request.args.get("doctor_id", type=int)

    conn = get_db_connection()

    allowed_doctor_ids = get_dashboard_doctor_ids(current_user, conn)

    if current_user["role"] == "doctor":
        doctor_id = current_user["doctor_id"]

    else:
        doctor_id = requested_doctor_id

        if not doctor_id:
            doctor_id = allowed_doctor_ids[0]

    if doctor_id not in allowed_doctor_ids:
        conn.close()

        return (
            jsonify(
                {
                    "success": False,
                    "message": "You are not allowed to access this doctor.",
                }
            ),
            403,
        )

    doctor = conn.execute(
        """
        SELECT id, name, specialty
        FROM doctors
        WHERE id = ?
        """,
        (doctor_id,),
    ).fetchone()

    if not doctor:
        conn.close()

        return jsonify({"success": False, "message": "Doctor not found."}), 404

    slots = get_dashboard_slot_status(conn, doctor_id, selected_date)

    conn.close()

    return jsonify(
        {"success": True, "date": selected_date, "doctor": dict(doctor), "slots": slots}
    )


@app.route("/api/dashboard/patients", methods=["GET"])
@token_required
def dashboard_patients(current_user):

    if current_user["role"] not in ["doctor", "manager"]:
        return jsonify({"success": False, "message": "Access denied."}), 403

    selected_date = request.args.get("date", datetime.date.today().isoformat())

    requested_doctor_id = request.args.get("doctor_id", type=int)

    conn = get_db_connection()

    allowed_doctor_ids = get_dashboard_doctor_ids(current_user, conn)

    query = """
        SELECT
            appointments.*,
            doctors.name AS doctor_name,
            doctors.specialty AS doctor_specialty
        FROM appointments
        JOIN doctors
            ON appointments.doctor_id = doctors.id
        WHERE appointments.appointment_date = ?
          AND appointments.status IN ('confirmed', 'completed')
    """

    params = [selected_date]

    if current_user["role"] == "doctor":

        query += """
            AND appointments.doctor_id = ?
        """

        params.append(current_user["doctor_id"])

    elif requested_doctor_id:

        if requested_doctor_id not in allowed_doctor_ids:
            conn.close()

            return jsonify({"success": False, "message": "Doctor access denied."}), 403

        query += """
            AND appointments.doctor_id = ?
        """

        params.append(requested_doctor_id)

    query += """
        ORDER BY
            appointments.id DESC
    """

    patients = conn.execute(query, params).fetchall()

    conn.close()

    return jsonify(
        {
            "success": True,
            "date": selected_date,
            "patients": [dict(patient) for patient in patients],
        }
    )


def _mark_appointment_completed(conn, appointment, changed_by_user_id):
    """
    Shared completion logic used by BOTH the Queue 'Completed' button and
    the Action 'Mark OPD Done' button, so clicking either one always
    produces the exact same result and the two stay in sync on refresh.
    """
    old_status = appointment["queue_status"] or "waiting"

    conn.execute(
        """
        UPDATE appointments
        SET
            status = 'completed',
            queue_status = 'completed',
            completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
        WHERE id = ?
        """,
        (appointment["id"],),
    )

    conn.execute(
        "INSERT INTO queue_events (appointment_id,old_status,new_status,changed_by) VALUES (?,?,?,?)",
        (appointment["id"], old_status, "completed", changed_by_user_id),
    )

    doctor_row = conn.execute(
        "SELECT name FROM doctors WHERE id=?", (appointment["doctor_id"],)
    ).fetchone()
    doctor_name = doctor_row["name"] if doctor_row else "your doctor"

    conn.execute(
        """
        INSERT OR IGNORE INTO feedback_notifications
            (appointment_id,patient_id,phone,doctor_name,message)
        VALUES (?,?,?,?,?)
        """,
        (
            appointment["id"],
            appointment["patient_id"],
            appointment["patient_phone"],
            doctor_name,
            f"🏥 Thank you for visiting Bharat Care. How was your consultation with {doctor_name}? Reply with a rating from 1 to 5 stars.",
        ),
    )


@app.route("/api/dashboard/appointment/<int:appointment_id>/complete", methods=["POST"])
@token_required
def mark_opd_completed(current_user, appointment_id):

    # Only the treating doctor can complete a consultation. The Manager
    # view is read-only (no queue/completion actions).
    if current_user["role"] != "doctor":
        return jsonify({"success": False, "message": "Access denied."}), 403

    conn = get_db_connection()

    appointment = conn.execute(
        """
        SELECT *
        FROM appointments
        WHERE id = ?
        """,
        (appointment_id,),
    ).fetchone()

    if not appointment:
        conn.close()

        return jsonify({"success": False, "message": "Appointment not found."}), 404

    if appointment["doctor_id"] != current_user["doctor_id"]:
        conn.close()

        return (
            jsonify(
                {
                    "success": False,
                    "message": ("You can only update your own patients."),
                }
            ),
            403,
        )

    if appointment["status"] == "completed":
        conn.close()

        return jsonify({"success": True, "message": "OPD already marked as completed."})

    _mark_appointment_completed(conn, appointment, current_user["id"])

    conn.commit()
    conn.close()

    return jsonify({"success": True, "message": "OPD marked as completed."})

    # =========================================================



# =========================================================
# QUEUE / FOLLOW-UP / PATIENT COMMUNICATION
# =========================================================

@app.route("/api/follow-up/options", methods=["GET"])
def follow_up_options():
    department = request.args.get("department", "").strip()
    if not department:
        return jsonify({"success": False, "message": "Department is required."}), 400
    conn = get_db_connection()
    options = get_follow_up_options(conn, department)
    conn.close()
    return jsonify({"success": True, "department": department, "options": options})


@app.route("/api/dashboard/queue", methods=["GET"])
@token_required
def dashboard_queue(current_user):
    if current_user["role"] not in ["doctor", "manager", "cashier", "lab_cashier"]:
        return jsonify({"success": False, "message": "Access denied."}), 403
    date_value = request.args.get("date", datetime.date.today().isoformat())
    doctor_id = request.args.get("doctor_id", type=int) or current_user.get("doctor_id")
    conn = get_db_connection()
    if current_user["role"] in ("manager", "cashier", "lab_cashier") and not doctor_id:
        row = conn.execute("SELECT id FROM doctors ORDER BY id LIMIT 1").fetchone()
        doctor_id = row["id"] if row else None
    if not doctor_id or (current_user["role"] == "doctor" and doctor_id != current_user.get("doctor_id")):
        conn.close()
        return jsonify({"success": False, "message": "Doctor access denied."}), 403
    rows = conn.execute("""
        SELECT a.id,a.patient_name,a.patient_phone,a.time_slot,a.token_number,a.queue_status,
               a.reason,a.status,a.fee,a.payment_status,a.is_free_followup,a.follow_up_category,a.follow_up_date,
               d.name doctor_name,d.specialty,
               lb.total AS lab_total, lb.payment_status AS lab_payment_status
        FROM appointments a JOIN doctors d ON d.id=a.doctor_id
        LEFT JOIN lab_bills lb ON lb.id = (
            SELECT id FROM lab_bills WHERE appointment_id = a.id ORDER BY id DESC LIMIT 1
        )
        WHERE a.doctor_id=? AND a.appointment_date=?
          AND a.status IN ('confirmed','completed')
        ORDER BY a.id
    """, (doctor_id, date_value)).fetchall()
    conn.close()

    total_consultation_fee_paid = sum(
        float(r["fee"] or 0) for r in rows if r["payment_status"] == "paid"
    )
    total_test_fee_paid = sum(
        float(r["lab_total"] or 0) for r in rows if r["lab_payment_status"] == "paid"
    )

    return jsonify({
        "success": True,
        "date": date_value,
        "queue": [dict(r) for r in rows],
        "totals": {
            "total_consultation_fee_paid": total_consultation_fee_paid,
            "total_test_fee_paid": total_test_fee_paid,
        },
    })


@app.route("/api/dashboard/queue/<int:appointment_id>/status", methods=["POST"])
@token_required
def update_queue_status(current_user, appointment_id):
    # Only the treating doctor can change queue status. Manager view is
    # read-only (no queue actions).
    if current_user["role"] != "doctor":
        return jsonify({"success": False, "message": "Access denied."}), 403
    new_status = (request.get_json() or {}).get("status")
    allowed = {"waiting", "completed", "no_show"}
    if new_status not in allowed:
        return jsonify({"success": False, "message": "Invalid queue status."}), 400
    conn = get_db_connection()
    appt = conn.execute("SELECT * FROM appointments WHERE id=?", (appointment_id,)).fetchone()
    if not appt or appt["doctor_id"] != current_user["doctor_id"]:
        conn.close()
        return jsonify({"success": False, "message": "Appointment access denied."}), 403

    if new_status == "completed":
        # Same shared logic as the Action "Mark OPD Done" button, so
        # both stay in sync no matter which one is clicked.
        if appt["status"] != "completed":
            _mark_appointment_completed(conn, appt, current_user["id"])
    else:
        old = appt["queue_status"] or "waiting"
        conn.execute("UPDATE appointments SET queue_status=? WHERE id=?", (new_status, appointment_id))
        conn.execute("INSERT INTO queue_events (appointment_id,old_status,new_status,changed_by) VALUES (?,?,?,?)", (appointment_id, old, new_status, current_user["id"]))

    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "Queue updated."})


@app.route("/api/dashboard/appointment/<int:appointment_id>/follow-up", methods=["POST"])
@token_required
def set_follow_up(current_user, appointment_id):
    # Follow-up reminder scheduling is a doctor-only action; Manager has
    # no access to this (not shown on their dashboard either).
    if current_user["role"] != "doctor":
        return jsonify({"success": False, "message": "Access denied."}), 403
    data = request.get_json() or {}
    category = str(data.get("category", "")).strip()[:100]
    no_follow = bool(data.get("no_follow_up"))
    dnd = bool(data.get("do_not_disturb"))
    custom_note = str(data.get("note", "")).strip()[:500]
    try:
        interval = int(data.get("interval_days")) if data.get("interval_days") is not None else None
    except (TypeError, ValueError):
        interval = None
    conn = get_db_connection()
    appt = conn.execute("SELECT * FROM appointments WHERE id=?", (appointment_id,)).fetchone()
    if not appt or (current_user["role"] == "doctor" and appt["doctor_id"] != current_user["doctor_id"]):
        conn.close(); return jsonify({"success": False, "message": "Appointment access denied."}), 403
    if appt["status"] != "completed":
        conn.close(); return jsonify({"success": False, "message": "Complete the consultation first."}), 400
    if not no_follow and (not interval or interval < 1 or interval > 365):
        conn.close(); return jsonify({"success": False, "message": "Choose a valid follow-up interval."}), 400
    follow_date = None if no_follow else (datetime.date.today() + datetime.timedelta(days=interval)).isoformat()
    # The reminder itself goes out ONE DAY BEFORE the follow-up date
    # (e.g. a 7-day plan reminds the patient on day 6), so it lands the
    # day before they're due to come back.
    reminder_date = None if no_follow else (datetime.date.today() + datetime.timedelta(days=max(interval - 1, 0))).isoformat()
    conn.execute("UPDATE appointments SET follow_up_category=?, follow_up_date=?, follow_up_enabled=?, do_not_disturb=? WHERE id=?", (category or ("No Follow-up" if no_follow else "Follow-up"), follow_date, int(not no_follow), int(dnd), appointment_id))
    if appt["patient_id"]:
        conn.execute("INSERT OR IGNORE INTO patient_preferences(patient_id) VALUES (?)", (appt["patient_id"],))
        conn.execute("UPDATE patient_preferences SET follow_up_enabled=?, do_not_disturb=?, updated_at=CURRENT_TIMESTAMP WHERE patient_id=?", (int(not no_follow), int(dnd), appt["patient_id"]))
    conn.execute("DELETE FROM follow_up_plans WHERE appointment_id=?", (appointment_id,))
    conn.execute("DELETE FROM follow_up_notifications WHERE follow_up_plan_id NOT IN (SELECT id FROM follow_up_plans)")
    if not no_follow:
        cur = conn.execute("INSERT INTO follow_up_plans(appointment_id,patient_id,doctor_id,category,interval_days,follow_up_date,enabled,do_not_disturb,custom_note) VALUES (?,?,?,?,?,?,?,?,?)", (appointment_id,appt["patient_id"],appt["doctor_id"],category or "Follow-up",interval,follow_date,1,int(dnd),custom_note))
        doctor = conn.execute("SELECT name FROM doctors WHERE id=?", (appt["doctor_id"],)).fetchone()
        message = f"🏥 Bharat Care reminder\\n\\nHello {appt['patient_name']}, your follow-up with {doctor['name']} is due on {follow_date}.\\nReply BOOK to request an appointment or STOP to disable routine reminders."
        conn.execute("INSERT INTO follow_up_notifications(follow_up_plan_id,patient_id,phone,message,scheduled_for) VALUES (?,?,?,?,?)", (cur.lastrowid,appt["patient_id"],appt["patient_phone"],message,reminder_date))
    conn.commit(); conn.close()
    return jsonify({"success": True, "message": "Follow-up plan saved.", "follow_up_date": follow_date, "no_follow_up": no_follow, "do_not_disturb": dnd})


@app.route("/api/patient/follow-up/stop", methods=["POST"])
@token_required
def stop_follow_up(current_user):
    if current_user["role"] != "patient":
        return jsonify({"success": False, "message": "Patient access required."}), 403
    conn=get_db_connection()
    conn.execute("INSERT OR IGNORE INTO patient_preferences(patient_id) VALUES (?)", (current_user["id"],))
    conn.execute("UPDATE patient_preferences SET follow_up_enabled=0, do_not_disturb=1, updated_at=CURRENT_TIMESTAMP WHERE patient_id=?", (current_user["id"],))
    conn.execute("UPDATE follow_up_plans SET enabled=0, do_not_disturb=1 WHERE patient_id=?", (current_user["id"],))
    conn.commit(); conn.close()
    return jsonify({"success": True, "message": "Routine follow-up reminders disabled."})


# PATIENT REVIEWS
# =========================================================


@app.route("/api/reviews", methods=["GET"])
def get_public_reviews():
    conn = get_db_connection()

    reviews = conn.execute("""
        SELECT
            id,
            patient_name,
            doctor_name,
            rating,
            review_text,
            created_at
        FROM patient_reviews
        WHERE status = 'approved'
        ORDER BY created_at DESC
    """).fetchall()

    conn.close()

    return jsonify({"success": True, "reviews": [dict(review) for review in reviews]})


@app.route("/api/reviews", methods=["POST"])
def submit_patient_review():

    data = request.get_json() or {}

    appointment_id = data.get("appointment_id")

    # Accept both #12345 and 12345
    if appointment_id is not None:
        appointment_id = str(appointment_id).strip()

        if appointment_id.startswith("#"):
            appointment_id = appointment_id[1:].strip()

    # Appointment ID must contain numbers only
    if not appointment_id or not appointment_id.isdigit():
        return (
            jsonify(
                {
                    "success": False,
                    "message": "Please enter a valid Appointment ID, for example #12345 or 12345.",
                }
            ),
            400,
        )

    appointment_id = int(appointment_id)

    rating = data.get("rating")

    review_text = str(data.get("review_text", "")).strip()

    try:
        rating = int(rating)
    except (TypeError, ValueError):
        rating = 0

    if rating < 1 or rating > 5:
        return (
            jsonify(
                {"success": False, "message": "Please select a rating from 1 to 5."}
            ),
            400,
        )

    if not review_text:
        return (
            jsonify({"success": False, "message": "Please write your experience."}),
            400,
        )

    if len(review_text) > 1000:
        return jsonify({"success": False, "message": "Review is too long."}), 400

    conn = get_db_connection()

    appointment = conn.execute(
        """
        SELECT
            appointments.id,
            appointments.patient_id,
            appointments.patient_name,
            appointments.patient_phone,
            appointments.doctor_id,
            appointments.status,
            doctors.name AS doctor_name
        FROM appointments
        JOIN doctors
            ON appointments.doctor_id = doctors.id
        WHERE appointments.id = ?
    """,
        (appointment_id,),
    ).fetchone()

    if not appointment:
        conn.close()

        return jsonify({"success": False, "message": "Appointment not found."}), 404

    if appointment["status"] != "completed":
        conn.close()

        return (
            jsonify(
                {
                    "success": False,
                    "message": "Review can be submitted only after OPD is completed.",
                }
            ),
            403,
        )

    existing = conn.execute(
        """
        SELECT id
        FROM patient_reviews
        WHERE appointment_id = ?
    """,
        (appointment_id,),
    ).fetchone()

    if existing:
        conn.close()

        return (
            jsonify(
                {
                    "success": False,
                    "message": "You have already submitted a review for this appointment.",
                }
            ),
            409,
        )

    conn.execute(
        """
        INSERT INTO patient_reviews (
            appointment_id,
            patient_id,
            doctor_id,
            patient_name,
            patient_phone,
            doctor_name,
            rating,
            review_text,
            status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (
            appointment["id"],
            appointment["patient_id"],
            appointment["doctor_id"],
            appointment["patient_name"],
            appointment["patient_phone"],
            appointment["doctor_name"],
            rating,
            review_text,
            "pending",
        ),
    )

    conn.commit()
    conn.close()

    return jsonify(
        {
            "success": True,
            "message": "Thank you! Your review has been submitted for verification.",
        }
    )


# =========================================================

@app.route("/api/dashboard/feedback/stats", methods=["GET"])
@token_required
def feedback_stats(current_user):
    if current_user["role"] not in ["doctor", "manager"]:
        return jsonify({"success": False, "message": "Access denied."}), 403
    conn=get_db_connection()
    if current_user["role"] == "doctor":
        row=conn.execute("SELECT COUNT(*) total, COALESCE(AVG(rating),0) average FROM patient_reviews WHERE doctor_id=? AND status='approved'",(current_user["doctor_id"],)).fetchone()
        dist=conn.execute("SELECT rating,COUNT(*) count FROM patient_reviews WHERE doctor_id=? AND status='approved' GROUP BY rating ORDER BY rating DESC",(current_user["doctor_id"],)).fetchall()
        pending=conn.execute("SELECT COUNT(*) count FROM patient_reviews WHERE status='pending' AND doctor_id=?",(current_user["doctor_id"],)).fetchone()["count"]
    else:
        row=conn.execute("SELECT COUNT(*) total, COALESCE(AVG(rating),0) average FROM patient_reviews WHERE status='approved'").fetchone()
        dist=conn.execute("SELECT rating,COUNT(*) count FROM patient_reviews WHERE status='approved' GROUP BY rating ORDER BY rating DESC").fetchall()
        pending=conn.execute("SELECT COUNT(*) count FROM patient_reviews WHERE status='pending'").fetchone()["count"]
    conn.close()
    return jsonify({"success":True,"total_reviews":row["total"],"average_rating":round(row["average"],2),"pending_reviews":pending,"distribution":[dict(x) for x in dist]})

# DASHBOARD - PATIENT REVIEWS
# =========================================================


@app.route("/api/dashboard/reviews", methods=["GET"])
@token_required
def dashboard_reviews(current_user):

    if current_user["role"] not in ["doctor", "manager"]:
        return jsonify({"success": False, "message": "Access denied."}), 403

    conn = get_db_connection()

    if current_user["role"] == "doctor":

        reviews = conn.execute(
            """
            SELECT *
            FROM patient_reviews
            WHERE doctor_id = ?
            ORDER BY
                CASE
                    WHEN status = 'pending' THEN 0
                    WHEN status = 'approved' THEN 1
                    ELSE 2
                END,
                created_at DESC
        """,
            (current_user["doctor_id"],),
        ).fetchall()

    else:

        reviews = conn.execute("""
            SELECT *
            FROM patient_reviews
            ORDER BY
                CASE
                    WHEN status = 'pending' THEN 0
                    WHEN status = 'approved' THEN 1
                    ELSE 2
                END,
                created_at DESC
        """).fetchall()

    conn.close()

    return jsonify({"success": True, "reviews": [dict(review) for review in reviews]})


@app.route("/api/dashboard/reviews/<int:review_id>/approve", methods=["POST"])
@token_required
def approve_patient_review(current_user, review_id):

    if current_user["role"] not in ["doctor", "manager"]:
        return jsonify({"success": False, "message": "Access denied."}), 403

    conn = get_db_connection()

    review = conn.execute(
        """
        SELECT *
        FROM patient_reviews
        WHERE id = ?
    """,
        (review_id,),
    ).fetchone()

    if not review:
        conn.close()

        return jsonify({"success": False, "message": "Review not found."}), 404

    if (
        current_user["role"] == "doctor"
        and review["doctor_id"] != current_user["doctor_id"]
    ):
        conn.close()

        return (
            jsonify(
                {
                    "success": False,
                    "message": "You can only manage reviews for your own patients.",
                }
            ),
            403,
        )

    conn.execute(
        """
        UPDATE patient_reviews
        SET
            status = 'approved',
            approved_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """,
        (review_id,),
    )

    conn.commit()
    conn.close()

    return jsonify({"success": True, "message": "Review approved successfully."})


@app.route("/api/dashboard/reviews/<int:review_id>/reject", methods=["POST"])
@token_required
def reject_patient_review(current_user, review_id):

    if current_user["role"] not in ["doctor", "manager"]:
        return jsonify({"success": False, "message": "Access denied."}), 403

    conn = get_db_connection()

    review = conn.execute(
        """
        SELECT *
        FROM patient_reviews
        WHERE id = ?
    """,
        (review_id,),
    ).fetchone()

    if not review:
        conn.close()

        return jsonify({"success": False, "message": "Review not found."}), 404

    if (
        current_user["role"] == "doctor"
        and review["doctor_id"] != current_user["doctor_id"]
    ):
        conn.close()

        return (
            jsonify(
                {
                    "success": False,
                    "message": "You can only manage reviews for your own patients.",
                }
            ),
            403,
        )

    conn.execute(
        """
        UPDATE patient_reviews
        SET status = 'rejected'
        WHERE id = ?
    """,
        (review_id,),
    )

    conn.commit()
    conn.close()

    return jsonify({"success": True, "message": "Review rejected."})


# =========================================================
# INTERACTIVE WHATSAPP BOT / SIMULATOR ENDPOINT
# =========================================================


@app.route("/api/whatsapp/webhook", methods=["POST"])
def whatsapp_webhook():
    data = request.get_json() or {}

    phone = data.get("phone", "+919472396918").strip()

    msg = data.get("message", "").strip()
    msg_lower = msg.lower()

    conn = get_db_connection()

    session = conn.execute(
        "SELECT * FROM whatsapp_sessions WHERE phone = ?", (phone,)
    ).fetchone()

    # Start/reset session
    if not session or msg_lower in [
        "hi",
        "hello",
        "namaste",
        "menu",
        "reset",
        "start",
        "0",
    ]:
        conn.execute(
            """
            INSERT OR REPLACE INTO whatsapp_sessions
            (phone, step, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            """,
            (phone, "MAIN_MENU"),
        )

        conn.commit()
        conn.close()

        return jsonify(
            {
                "success": True,
                "phone": phone,
                "reply": (
                    "🏥 *BHARAT CARE NURSING HOME WhatsApp Bot*\n\n"
                    "Namaste! Swagat hai Bharat Care Nursing Home "
                    "(Purabpali, Kishanganj) me.\n"
                    "Main aapka Doctor Appointment Assistant hoon.\n\n"
                    "Aap niche option number type karke reply karein:\n"
                    "1️⃣ *Book Doctor Appointment*\n"
                    "2️⃣ *View Specialist Doctors & Fees*\n"
                    "3️⃣ *Check My Booking Status*\n"
                    "4️⃣ *Emergency Helpline & Location*\n\n"
                    "_(Type 0 or Reset anytime for main menu)_"
                ),
            }
        )

    current_step = session["step"]

    # -----------------------------------------------------
    # MAIN MENU
    # -----------------------------------------------------

    if current_step == "MAIN_MENU":

        if msg == "1" or "book" in msg_lower:
            conn.execute(
                """
                UPDATE whatsapp_sessions
                SET step = ?
                WHERE phone = ?
                """,
                ("SELECT_SPECIALTY", phone),
            )

            conn.commit()
            conn.close()

            return jsonify(
                {
                    "success": True,
                    "phone": phone,
                    "reply": (
                        "🩺 *Select Department:*\n\n"
                        "1. Urology (Dr. Bharat Prasad)\n"
                        "2. Gynecologist & Obstetrician "
                        "(Dr. Nidhi Kumari)\n"
                        "3. Gynecologist & Fertility IVF "
                        "(Dr. Shalini Prasad)\n"
                        "4. ENT Specialist (Dr. Sachin Prasad)\n\n"
                        "Reply with number *1 to 4*:"
                    ),
                }
            )

        elif msg == "2" or "doctor" in msg_lower:
            conn.close()

            return jsonify(
                {
                    "success": True,
                    "phone": phone,
                    "reply": (
                        "📋 *BHARAT CARE NURSING HOME Doctors List:*\n\n"
                        "• *Dr. Bharat Prasad* (Urology) - Fee: ₹500\n"
                        "• *Dr. Nidhi Kumari* "
                        "(Gynecology & OBS) - Fee: ₹500\n"
                        "• *Dr. Shalini Prasad* "
                        "(Fertility & IVF) - Fee: ₹500\n"
                        "• *Dr. Sachin Prasad* "
                        "(ENT Specialist) - Fee: ₹500\n\n"
                        "⏰ *OPD Timings:* 10:00 AM to 5:00 PM "
                        "(Sun: 10:00 AM to 1:00 PM)\n\n"
                        "Type *1* to book an appointment!"
                    ),
                }
            )

        elif msg == "3" or "status" in msg_lower:
            appts = conn.execute(
                """
                SELECT a.*, d.name AS doctor_name
                FROM appointments a
                JOIN doctors d ON a.doctor_id = d.id
                WHERE a.patient_phone LIKE ?
                ORDER BY a.id DESC
                LIMIT 3
                """,
                (f"%{phone[-10:]}%",),
            ).fetchall()

            conn.close()

            if appts:
                status_text = "📋 *Your Recent Appointments at Bharat Care:*\n\n"

                for a in appts:
                    status_text += (
                        f"🆔 *#APPT-{a['id']}*\n"
                        f"👨‍⚕️ {a['doctor_name']}\n"
                        f"📅 Date: {a['appointment_date']} "
                        f"at {a['time_slot']}\n"
                        f"📌 Status: *{a['status'].upper()}*\n"
                        "---\n"
                    )

                status_text += "\nType *1* to book a new appointment!"

                return jsonify({"success": True, "phone": phone, "reply": status_text})

            return jsonify(
                {
                    "success": True,
                    "phone": phone,
                    "reply": (
                        f"🔍 Phone number {phone} par "
                        "koi active booking nahi mili.\n\n"
                        "Type *1* to book a new appointment!"
                    ),
                }
            )

        elif msg == "4" or "emergency" in msg_lower:
            conn.close()

            return jsonify(
                {
                    "success": True,
                    "phone": phone,
                    "reply": (
                        "🚨 *BHARAT CARE NURSING HOME "
                        "Emergency & Contact*\n\n"
                        "📞 Emergency Mobile: +91 9472396918\n"
                        "💬 WhatsApp Booking: +91 9472396918\n"
                        "📍 Address: Purabpali in premises of "
                        "Bharat Care Centre, Dharamganj, "
                        "Kishanganj, Bihar (855107)\n\n"
                        "Type *1* to book an OPD appointment."
                    ),
                }
            )

        conn.close()

        return jsonify(
            {
                "success": True,
                "phone": phone,
                "reply": (
                    "Kripya 1, 2, 3 ya 4 reply karein.\n"
                    "1. Book Appointment\n"
                    "2. View Doctors\n"
                    "3. Check Status\n"
                    "4. Emergency"
                ),
            }
        )

    # -----------------------------------------------------
    # SELECT SPECIALTY
    # -----------------------------------------------------

    elif current_step == "SELECT_SPECIALTY":

        specialty_map = {
            "1": "Urology",
            "2": "Gynecologist & Obstetrician",
            "3": "Gynecologist & Fertility Specialist",
            "4": "ENT Specialist",
        }

        specialty = specialty_map.get(msg)

        if not specialty:
            conn.close()

            return jsonify(
                {
                    "success": True,
                    "phone": phone,
                    "reply": (
                        "Invalid selection. "
                        "Please reply with a number between 1 and 4."
                    ),
                }
            )

        doctors = conn.execute(
            "SELECT * FROM doctors WHERE specialty = ?", (specialty,)
        ).fetchall()

        if not doctors:
            conn.close()

            return jsonify(
                {
                    "success": True,
                    "phone": phone,
                    "reply": (
                        f"No doctors found for {specialty}. "
                        "Please select another option."
                    ),
                }
            )

        first_doc = doctors[0]

        conn.execute(
            """
            UPDATE whatsapp_sessions
            SET
                step = ?,
                selected_specialty = ?,
                selected_doctor_id = ?
            WHERE phone = ?
            """,
            ("SELECT_DATE", specialty, first_doc["id"], phone),
        )

        conn.commit()
        conn.close()

        today = datetime.date.today()
        tomorrow = today + datetime.timedelta(days=1)
        day_after = today + datetime.timedelta(days=2)

        return jsonify(
            {
                "success": True,
                "phone": phone,
                "reply": (
                    f"👨‍⚕️ Selected Doctor: *{first_doc['name']}*\n"
                    f"🩺 Qualification: "
                    f"{first_doc['qualification']}\n"
                    f"💳 Consulting Fee: ₹{first_doc['fee']}\n\n"
                    "📅 *Select Appointment Date:*\n\n"
                    f"1. Today ({today.strftime('%Y-%m-%d')})\n"
                    f"2. Tomorrow "
                    f"({tomorrow.strftime('%Y-%m-%d')})\n"
                    f"3. Day After Tomorrow "
                    f"({day_after.strftime('%Y-%m-%d')})\n\n"
                    "Reply with *1, 2 or 3*:"
                ),
            }
        )

    # -----------------------------------------------------
    # SELECT DATE
    # -----------------------------------------------------

    elif current_step == "SELECT_DATE":

        today = datetime.date.today()

        date_map = {
            "1": today,
            "2": today + datetime.timedelta(days=1),
            "3": today + datetime.timedelta(days=2),
        }

        chosen_date_obj = date_map.get(msg)

        if not chosen_date_obj:
            conn.close()

            return jsonify(
                {
                    "success": True,
                    "phone": phone,
                    "reply": (
                        "Invalid date selection. " "Please reply with 1, 2 or 3."
                    ),
                }
            )

        chosen_date = chosen_date_obj.strftime("%Y-%m-%d")
        doctor_id = session["selected_doctor_id"]

        slots = get_slot_status(conn, doctor_id, chosen_date)

        conn.execute(
            """
            UPDATE whatsapp_sessions
            SET
                step = ?,
                selected_date = ?,
                selected_slot = NULL
            WHERE phone = ?
            """,
            ("SELECT_SLOT", chosen_date, phone),
        )

        conn.commit()

        slot_message = f"⏰ *OPD Slots for {chosen_date}:*\n\n"

        available_slot_numbers = []

        for index, slot_data in enumerate(slots, start=1):

            if slot_data["is_past"]:
                slot_message += f"{index}. {slot_data['slot']} " "— Past/Started ❌\n"

            elif slot_data["is_full"]:
                slot_message += f"{index}. {slot_data['slot']} " "— FULL ❌ (15/15)\n"

            elif slot_data["is_locked"]:
                slot_message += (
                    f"{index}. {slot_data['slot']} "
                    "— 🔒 Locked (opens once earlier slot is full)\n"
                )

            else:
                available_slot_numbers.append(str(index))

                slot_message += (
                    f"{index}. {slot_data['slot']} "
                    f"— {slot_data['seats_left']} seat(s) left ✅\n"
                )

        if not available_slot_numbers:
            conn.close()

            return jsonify(
                {
                    "success": True,
                    "phone": phone,
                    "reply": (
                        slot_message + "\n❌ Is date par koi slot available nahi hai.\n"
                        "Type *0* or *Hi* to start again."
                    ),
                }
            )

        slot_message += "\nReply with an *available slot number*."

        conn.close()

        return jsonify({"success": True, "phone": phone, "reply": slot_message})

    # -----------------------------------------------------
    # SELECT SLOT
    # -----------------------------------------------------

    elif current_step == "SELECT_SLOT":

        slot_map = {
            "1": "10:00 AM - 11:15 AM",
            "2": "11:15 AM - 12:30 PM",
            "3": "12:45 PM - 02:00 PM",
            "4": "02:00 PM - 03:15 PM",
        }

        chosen_slot = slot_map.get(msg)

        if not chosen_slot:
            conn.close()

            return jsonify(
                {
                    "success": True,
                    "phone": phone,
                    "reply": (
                        "Invalid slot number. " "Please reply with 1, 2, 3 or 4."
                    ),
                }
            )

        chosen_date = session["selected_date"]
        doctor_id = session["selected_doctor_id"]

        valid, date_result = validate_booking_date(chosen_date)

        if not valid:
            conn.close()

            return jsonify(
                {
                    "success": True,
                    "phone": phone,
                    "reply": (
                        f"❌ {date_result}\n\n" "Type *0* or *Hi* to start again."
                    ),
                }
            )

        if is_past_slot(chosen_date, chosen_slot):
            conn.close()

            return jsonify(
                {
                    "success": True,
                    "phone": phone,
                    "reply": (
                        f"❌ {chosen_slot} ka time "
                        "already start/pass ho chuka hai. "
                        "Please select another slot number."
                    ),
                }
            )

        booked_count = get_slot_count(conn, doctor_id, chosen_date, chosen_slot)

        slot_lock_status = get_slot_status(conn, doctor_id, chosen_date)
        chosen_slot_info = next(
            (s for s in slot_lock_status if s["slot"] == chosen_slot), None
        )

        if chosen_slot_info and chosen_slot_info["is_locked"]:
            conn.close()

            next_open = next(
                (s["slot"] for s in slot_lock_status if not s["is_full"] and not s["is_past"]),
                None,
            )

            return jsonify(
                {
                    "success": True,
                    "phone": phone,
                    "reply": (
                        f"🔒 {chosen_slot} abhi open nahi hua hai.\n"
                        + (
                            f"Pehle {next_open} slot book karein — wo full hote hi ye khulega.\n"
                            if next_open
                            else ""
                        )
                        + "Please select another slot number."
                    ),
                }
            )

        if booked_count >= MAX_PATIENTS_PER_SLOT:
            conn.close()

            return jsonify(
                {
                    "success": True,
                    "phone": phone,
                    "reply": (
                        f"❌ {chosen_slot} is fully booked "
                        "(15/15 patients).\n"
                        "Please select another slot number."
                    ),
                }
            )

        conn.execute(
            """
            UPDATE whatsapp_sessions
            SET
                step = ?,
                selected_slot = ?
            WHERE phone = ?
            """,
            ("ENTER_NAME", chosen_slot, phone),
        )

        conn.commit()
        conn.close()

        return jsonify(
            {
                "success": True,
                "phone": phone,
                "reply": (
                    f"✅ {chosen_slot} selected.\n\n"
                    "👤 Kripya Patient ka *Full Name* reply karein:"
                ),
            }
        )

    # -----------------------------------------------------
    # ENTER NAME + FINAL SLOT CHECK + BOOK
    # -----------------------------------------------------

    elif current_step == "ENTER_NAME":

        patient_name = msg.strip()

        if not patient_name:
            conn.close()

            return jsonify(
                {
                    "success": True,
                    "phone": phone,
                    "reply": "Please enter the patient's full name.",
                }
            )

        doc_id = session["selected_doctor_id"]
        chosen_date = session["selected_date"]
        chosen_slot = session["selected_slot"]

        valid, date_result = validate_booking_date(chosen_date)

        if not valid:
            conn.close()

            return jsonify(
                {
                    "success": True,
                    "phone": phone,
                    "reply": (
                        f"❌ {date_result}\n\n" "Type *0* or *Hi* to start again."
                    ),
                }
            )

        if is_past_slot(chosen_date, chosen_slot):
            conn.close()

            return jsonify(
                {
                    "success": True,
                    "phone": phone,
                    "reply": (
                        f"❌ {chosen_slot} ka time "
                        "ab start/pass ho chuka hai.\n\n"
                        "Type *0* or *Hi* to book another slot."
                    ),
                }
            )

        try:
            # Final atomic check before inserting the appointment.
            conn.execute("BEGIN IMMEDIATE")

            doctor = conn.execute(
                "SELECT * FROM doctors WHERE id = ?", (doc_id,)
            ).fetchone()

            if not doctor:
                conn.rollback()
                conn.close()

                return jsonify(
                    {
                        "success": True,
                        "phone": phone,
                        "reply": (
                            "Doctor not found. " "Type *0* or *Hi* to start again."
                        ),
                    }
                )

            current_count = get_slot_count(conn, doc_id, chosen_date, chosen_slot)

            if current_count >= MAX_PATIENTS_PER_SLOT:
                conn.rollback()
                conn.close()

                return jsonify(
                    {
                        "success": True,
                        "phone": phone,
                        "reply": (
                            f"❌ Sorry! While you were completing "
                            f"the booking, {chosen_slot} became FULL "
                            "(15/15 patients).\n\n"
                            "Type *0* or *Hi* to book another slot."
                        ),
                    }
                )

            cursor = conn.cursor()

            token_number = next_token(conn, doc_id, chosen_date, doctor["specialty"])
            doctor_fee = float(doctor["fee"] or 0)
            cursor.execute(
                """
                INSERT INTO appointments
                (
                    doctor_id, patient_name, patient_phone, appointment_date, time_slot,
                    reason, status, booking_source, token_number, queue_status, fee
                )
                VALUES (?, ?, ?, ?, ?, ?, 'confirmed', 'whatsapp', ?, 'waiting', ?)
                """,
                (doc_id, patient_name, phone, chosen_date, chosen_slot,
                 "Bharat Care WhatsApp OPD", token_number, doctor_fee),
            )

            appt_id = cursor.lastrowid

            conn.execute(
                """
                UPDATE whatsapp_sessions
                SET step = ?
                WHERE phone = ?
                """,
                ("MAIN_MENU", phone),
            )

            conn.commit()

        except Exception as e:
            conn.rollback()
            conn.close()

            return jsonify(
                {
                    "success": True,
                    "phone": phone,
                    "reply": ("❌ Booking failed due to a server error: " f"{str(e)}"),
                }
            )

        conn.close()

        reply_msg = (
            "🎉 *APPOINTMENT CONFIRMED AT "
            "BHARAT CARE NURSING HOME!*\n\n"
            f"🆔 *Booking Ref:* #APPT-{appt_id}\n"
            f"👨‍⚕️ *Doctor:* {doctor['name']}\n"
            f"🩺 *Department:* {doctor['specialty']}\n"
            f"📅 *Date:* {chosen_date}\n"
            f"⏰ *Time Slot:* {chosen_slot}\n"
            f"🎟️ *Queue Token:* {token_number}\n"
            f"👤 *Patient:* {patient_name}\n"
            f"📞 *Phone:* {phone}\n"
            f"💳 *Consultation Fee:* ₹{doctor_fee:.0f} "
            "(Pay at Hospital Counter)\n\n"
            "📍 *Address:* Purabpali in premises of "
            "Bharat Care Centre, Dharamganj, "
            "Kishanganj, Bihar (855107).\n"
            "⚠️ Kripya appointment time se 10 min "
            "pehle hospital counter par reporting karein.\n\n"
            "Type *0* or *Hi* for main menu."
        )

        return jsonify(
            {
                "success": True,
                "phone": phone,
                "reply": reply_msg,
                "appointment_id": appt_id,
            }
        )

    conn.close()

    return jsonify(
        {"success": True, "phone": phone, "reply": "Type *Hi* to see the main menu."}
    )


# =========================================================
# COLLECTION & LAB CASHIER DASHBOARDS
# =========================================================

@app.route('/api/collections/doctors/list')
@token_required
def collection_doctors(current_user):
    if current_user['role'] not in {'manager','cashier','lab_cashier'}:
        return jsonify(success=False, message='Collection access denied.'), 403
    conn=get_db_connection(); rows=conn.execute('SELECT id,name,specialty FROM doctors ORDER BY name').fetchall(); conn.close()
    return jsonify(success=True, doctors=[dict(r) for r in rows])

@app.route('/api/collections/doctors')
@token_required
def collection_dashboard(current_user):
    if current_user['role'] not in {'manager','cashier'}:
        return jsonify(success=False, message='Collection access denied.'), 403
    date_value=request.args.get('date', datetime.date.today().isoformat()); doctor_id=request.args.get('doctor_id',type=int)
    conn=get_db_connection()
    where="WHERE a.appointment_date=? AND a.status IN ('confirmed','completed','no_show')"; params=[date_value]
    if doctor_id: where+=' AND a.doctor_id=?'; params.append(doctor_id)
    rows=conn.execute(f'''SELECT a.id,a.token_number,a.patient_name,a.patient_id,a.fee,a.is_free_followup,a.payment_status,d.name doctor_name FROM appointments a JOIN doctors d ON d.id=a.doctor_id {where} ORDER BY d.name,a.time_slot,a.id''',params).fetchall()
    ds=conn.execute(f'''SELECT d.id,d.name doctor_name,COUNT(a.id) patients,COALESCE(SUM(CASE WHEN a.payment_status='paid' THEN a.fee ELSE 0 END),0) paid,COALESCE(SUM(CASE WHEN a.payment_status!='paid' THEN a.fee ELSE 0 END),0) pending,COALESCE(SUM(a.fee),0) billing FROM appointments a JOIN doctors d ON d.id=a.doctor_id {where} GROUP BY d.id,d.name ORDER BY d.name''',params).fetchall()
    total=sum(float(r['fee'] or 0) for r in rows); paid=sum(float(r['fee'] or 0) for r in rows if r['payment_status']=='paid');
    conn.close(); return jsonify(success=True,summary={'total_patients':len(rows),'total_billing':total,'paid':paid,'pending':total-paid},appointments=[dict(r) for r in rows],doctor_summary=[dict(r) for r in ds])

@app.route('/api/collections/lab')
@token_required
def lab_collection_dashboard(current_user):
    if current_user['role'] not in {'manager','lab_cashier'}:
        return jsonify(success=False, message='Lab collection access denied.'), 403
    date_value=request.args.get('date', datetime.date.today().isoformat()); doctor_id=request.args.get('doctor_id',type=int)
    conn=get_db_connection()
    where="WHERE DATE(b.created_at)=?"; params=[date_value]
    if doctor_id: where+=' AND b.doctor_id=?'; params.append(doctor_id)
    rows=conn.execute(f'''SELECT b.id,b.token_number,b.patient_name,b.doctor_id,b.doctor_name,b.total,b.payment_status,
        COALESCE(GROUP_CONCAT(i.test_name,', '),'') AS tests
        FROM lab_bills b LEFT JOIN lab_bill_items i ON i.bill_id=b.id {where}
        GROUP BY b.id ORDER BY b.doctor_name,b.id''',params).fetchall()
    ds=conn.execute(f'''SELECT b.doctor_id,b.doctor_name,COUNT(b.id) bills,
        COALESCE(SUM(CASE WHEN b.payment_status='paid' THEN b.total ELSE 0 END),0) paid,
        COALESCE(SUM(CASE WHEN b.payment_status!='paid' THEN b.total ELSE 0 END),0) pending,
        COALESCE(SUM(b.total),0) billing
        FROM lab_bills b {where} GROUP BY b.doctor_id,b.doctor_name ORDER BY b.doctor_name''',params).fetchall()
    total=sum(float(r['total'] or 0) for r in rows); paid=sum(float(r['total'] or 0) for r in rows if r['payment_status']=='paid')
    conn.close(); return jsonify(success=True,summary={'total_bills':len(rows),'total_billing':total,'paid':paid,'pending':total-paid},bills=[dict(r) for r in rows],doctor_summary=[dict(r) for r in ds])

@app.route('/api/collections/appointment/<int:appointment_id>/payment',methods=['POST'])
@token_required
def collection_payment(current_user,appointment_id):
    if current_user['role'] != 'cashier':
        return jsonify(success=False,message='Only the front-desk Cashier can change consultation payment status.'),403
    conn=get_db_connection()
    appt = conn.execute('SELECT appointment_date FROM appointments WHERE id=?', (appointment_id,)).fetchone()
    if not appt:
        conn.close()
        return jsonify(success=False, message='Appointment not found.'), 404
    if appt['appointment_date'] != datetime.date.today().isoformat():
        conn.close()
        return jsonify(success=False, message="Payment status can only be changed for today's date."), 403
    status=(request.get_json() or {}).get('status');
    if status not in {'pending','paid'}:
        conn.close()
        return jsonify(success=False,message='Invalid payment status.'),400
    conn.execute('UPDATE appointments SET payment_status=? WHERE id=?',(status,appointment_id)); conn.commit(); conn.close(); return jsonify(success=True,status=status)

@app.route('/api/collections/appointment/<int:appointment_id>/free-followup', methods=['POST'])
@token_required
def set_free_followup(current_user, appointment_id):
    """Cashier-only: mark/unmark today's visit as a Free Follow-up after
    physically checking the doctor's (paper) prescription. A quiet
    background check looks for a completed visit with the same doctor in
    the last 15 days; if none is found the Cashier gets a warning and must
    explicitly confirm before it is applied — the final call is always
    the Cashier's."""

    if current_user['role'] != 'cashier':
        return jsonify(success=False, message='Only the front-desk Cashier can set Free Follow-up.'), 403

    conn = get_db_connection()

    appt = conn.execute(
        "SELECT id, patient_phone, doctor_id, appointment_date, fee, "
        "is_free_followup, payment_status, original_fee "
        "FROM appointments WHERE id=?",
        (appointment_id,),
    ).fetchone()

    if not appt:
        conn.close()
        return jsonify(success=False, message='Appointment not found.'), 404

    if appt['appointment_date'] != datetime.date.today().isoformat():
        conn.close()
        return jsonify(success=False, message="Free Follow-up can only be changed for today's date."), 403

    if appt['payment_status'] == 'paid':
        conn.close()
        return jsonify(success=False, message='Payment is already marked Paid — Free Follow-up is locked.'), 403

    data = request.get_json() or {}
    make_free = bool(data.get('free'))
    confirm_no_match = bool(data.get('confirm_no_match'))

    if not make_free:
        restored_fee = appt['original_fee'] if appt['original_fee'] is not None else appt['fee']
        conn.execute(
            'UPDATE appointments SET is_free_followup=0, fee=? WHERE id=?',
            (restored_fee, appointment_id),
        )
        conn.commit()
        conn.close()
        return jsonify(success=True, is_free_followup=False, fee=restored_fee)

    candidates = conn.execute(
        "SELECT id, appointment_date FROM appointments "
        "WHERE patient_phone=? AND doctor_id=? AND status='completed' AND id != ? "
        "ORDER BY appointment_date DESC",
        (appt['patient_phone'], appt['doctor_id'], appointment_id),
    ).fetchall()

    match_found = False
    for c in candidates:
        try:
            days = (
                datetime.date.fromisoformat(appt['appointment_date'])
                - datetime.date.fromisoformat(c['appointment_date'])
            ).days
        except ValueError:
            continue
        if 0 < days <= 15:
            match_found = True
            break

    if not match_found and not confirm_no_match:
        conn.close()
        return jsonify(
            success=False,
            needs_confirmation=True,
            message=(
                'No completed visit with this doctor was found in the last 15 days. '
                'Mark as Free Follow-up anyway?'
            ),
        )

    original_fee = appt['original_fee'] if appt['original_fee'] is not None else appt['fee']
    conn.execute(
        'UPDATE appointments SET is_free_followup=1, fee=0, original_fee=? WHERE id=?',
        (original_fee, appointment_id),
    )
    conn.commit()
    conn.close()

    return jsonify(success=True, is_free_followup=True, fee=0)


@token_required
def lab_tests(current_user):
    if current_user['role'] != 'lab_cashier': return jsonify(success=False,message='Lab access denied.'),403
    conn=get_db_connection(); rows=conn.execute('SELECT id,name,fee FROM lab_tests WHERE active=1 ORDER BY name').fetchall(); conn.close(); return jsonify(success=True,tests=[dict(r) for r in rows])
    
@app.route('/api/lab/patient-by-token', methods=['GET'])
@token_required
def lab_patient_by_token(current_user):

    if current_user['role'] != 'lab_cashier':
        return jsonify(
            success=False,
            message='Lab access denied.'
        ), 403


    token_number = (
        request.args.get(
            'token',
            ''
        )
        .strip()
        .upper()
    )
    appointment_date = (
        request.args.get(
            'date',
            ''
        )
        .strip()
    )


    if not appointment_date:
        return jsonify(
            success=False,
            message='Date is required.'
        ), 400


    if not token_number:

        return jsonify(
            success=False,
            message='Token Number is required.'
        ), 400


    conn = get_db_connection()


    appointment = conn.execute("""
        SELECT
            a.id,
            a.token_number,
            a.patient_id,
            a.patient_name,
            a.patient_phone,
            a.patient_age,
            a.patient_gender,
            a.appointment_date,
            a.time_slot,
            a.status,
            a.doctor_id,
            d.name AS doctor_name,
            d.specialty AS doctor_specialty
        FROM appointments a
        JOIN doctors d
            ON d.id = a.doctor_id
        WHERE a.appointment_date = ?
          AND UPPER(a.token_number) = ?
        ORDER BY a.id DESC
        LIMIT 1
    """, (
        appointment_date,
        token_number,
    )).fetchone()


    conn.close()


    if not appointment:

        return jsonify(
            success=False,
            message='Token Number not found.'
        ), 404


    return jsonify(
        success=True,
        appointment=dict(
            appointment
        )
    )

@app.route('/api/lab/bills', methods=['GET', 'POST'])
@token_required
def lab_bills(current_user):

    if request.method == 'POST':
        if current_user['role'] != 'lab_cashier':
            return jsonify(
                success=False,
                message='Only Lab Cashier can create a lab bill.'
            ), 403
    else:
        if current_user['role'] not in {'doctor', 'manager', 'lab_cashier'}:
            return jsonify(
                success=False,
                message='Lab access denied.'
            ), 403

    conn = get_db_connection()

    # =====================================================
    # CREATE LAB BILL
    # =====================================================

    if request.method == 'POST':

        data = request.get_json() or {}

        appointment_id = data.get('appointment_id')
        token_number = (
            data.get('token_number') or ''
        ).strip().upper()

        test_ids = data.get('test_ids') or []

        if not appointment_id:
            conn.close()
            return jsonify(
                success=False,
                message='Appointment information is missing.'
            ), 400

        if not token_number:
            conn.close()
            return jsonify(
                success=False,
                message='Token Number is required.'
            ), 400

        if not test_ids:
            conn.close()
            return jsonify(
                success=False,
                message='Select at least one test.'
            ), 400

        # -------------------------------------------------
        # FIND APPOINTMENT
        # -------------------------------------------------

        appointment = conn.execute(
            """
            SELECT
                a.id,
                a.token_number,
                a.patient_id,
                a.patient_name,
                a.doctor_id,
                d.name AS doctor_name

            FROM appointments a

            JOIN doctors d
                ON d.id = a.doctor_id

            WHERE a.id = ?
              AND UPPER(a.token_number) = ?

            LIMIT 1
            """,
            (
                appointment_id,
                token_number
            )
        ).fetchone()

        if not appointment:
            conn.close()
            return jsonify(
                success=False,
                message='Invalid Token Number or appointment.'
            ), 404

        # -------------------------------------------------
        # FIND SELECTED TESTS
        # -------------------------------------------------

        marks = ','.join(
            '?' * len(test_ids)
        )

        tests = conn.execute(
            f"""
            SELECT
                id,
                name,
                fee

            FROM lab_tests

            WHERE active = 1
              AND id IN ({marks})

            ORDER BY name
            """,
            test_ids
        ).fetchall()

        if not tests:
            conn.close()
            return jsonify(
                success=False,
                message='Selected tests not found.'
            ), 400

        # -------------------------------------------------
        # CALCULATE TOTAL
        # -------------------------------------------------

        total = sum(
            float(test['fee'])
            for test in tests
        )

        # -------------------------------------------------
        # CREATE LAB BILL
        # -------------------------------------------------

        cur = conn.execute(
            """
            INSERT INTO lab_bills
            (
                appointment_id,
                token_number,
                patient_id,
                patient_name,
                doctor_id,
                doctor_name,
                created_by,
                total,
                payment_status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
            """,
            (
                appointment['id'],
                appointment['token_number'],
                appointment['patient_id'],
                appointment['patient_name'],
                appointment['doctor_id'],
                appointment['doctor_name'],
                current_user['id'],
                total
            )
        )

        bill_id = cur.lastrowid

        # -------------------------------------------------
        # SAVE BILL ITEMS
        # -------------------------------------------------

        for test in tests:

            conn.execute(
                """
                INSERT INTO lab_bill_items
                (
                    bill_id,
                    test_id,
                    test_name,
                    fee
                )
                VALUES (?, ?, ?, ?)
                """,
                (
                    bill_id,
                    test['id'],
                    test['name'],
                    test['fee']
                )
            )

        conn.commit()
        conn.close()

        return jsonify(
            success=True,
            bill_id=bill_id,
            total=total,
            token_number=appointment['token_number'],
            patient_name=appointment['patient_name'],
            doctor_name=appointment['doctor_name']
        )

    # =====================================================
    # GET RECENT LAB BILLS
    # =====================================================

    rows = conn.execute(
        """
        SELECT
            b.id,
            b.token_number,
            b.patient_name,
            b.doctor_name,
            b.total,
            b.payment_status,

            COALESCE(
                GROUP_CONCAT(
                    i.test_name,
                    ', '
                ),
                ''
            ) AS tests

        FROM lab_bills b

        LEFT JOIN lab_bill_items i
            ON i.bill_id = b.id

        GROUP BY b.id

        ORDER BY b.id DESC

        LIMIT 100
        """
    ).fetchall()

    conn.close()

    return jsonify(
        success=True,
        bills=[
            dict(row)
            for row in rows
        ]
    )

@app.route('/api/lab/bills/<int:bill_id>/payment',methods=['POST'])
@token_required
def lab_payment(current_user,bill_id):
    if current_user['role'] != 'lab_cashier': return jsonify(success=False,message='Only Lab Cashier can change lab payment status.'),403
    conn=get_db_connection()
    bill = conn.execute('SELECT created_at FROM lab_bills WHERE id=?', (bill_id,)).fetchone()
    if not bill:
        conn.close()
        return jsonify(success=False, message='Lab bill not found.'), 404
    bill_date = str(bill['created_at'])[:10]
    if bill_date != datetime.date.today().isoformat():
        conn.close()
        return jsonify(success=False, message="Payment status can only be changed for today's lab bills."), 403
    status=(request.get_json() or {}).get('status');
    if status not in {'pending','paid'}:
        conn.close()
        return jsonify(success=False,message='Invalid payment status.'),400
    conn.execute('UPDATE lab_bills SET payment_status=? WHERE id=?',(status,bill_id)); conn.commit(); conn.close(); return jsonify(success=True,status=status)


if __name__ == "__main__":
    print("Starting BHARAT CARE NURSING HOME App on http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)