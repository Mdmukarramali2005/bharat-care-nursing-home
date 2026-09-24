import unittest
import json
import os
import sqlite3
from app import app
from database import init_db, get_db_connection

class BharatCareHospitalTestSuite(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        print("\n==================================================")
        print("  BHARAT CARE NURSING HOME - INTEGRATION TESTS   ")
        print("==================================================")
        init_db(reset=True)
        cls.client = app.test_client()
        cls.client.testing = True

    def test_01_database_seed(self):
        """Test 1: Verify database tables & 4 doctor seed data"""
        conn = get_db_connection()
        doctors = conn.execute("SELECT * FROM doctors").fetchall()
        conn.close()
        self.assertEqual(len(doctors), 4, "Database should contain exactly 4 doctors")
        print("  [OK] Test 01: Database initialized and seeded with 4 Bharat Care doctors.")

    def test_02_get_doctors_api(self):
        """Test 2: Fetch doctor catalog and filter by Urology specialty"""
        res = self.client.get('/api/doctors')
        self.assertEqual(res.status_code, 200)
        data = json.loads(res.data)
        self.assertTrue(data['success'])
        self.assertEqual(len(data['doctors']), 4)

        # Urology Specialty Filter
        res_uro = self.client.get('/api/doctors?specialty=Urology')
        data_uro = json.loads(res_uro.data)
        self.assertEqual(data_uro['doctors'][0]['name'], 'Dr. Bharat Prasad')
        print("  [OK] Test 02: Doctor listing & specialty filtering APIs working.")

    def test_03_auth_register_and_login(self):
        """Test 3: User signup and login authentication"""
        test_email = "patient_kishanganj@example.com"
        
        # Signup
        signup_payload = {
            "name": "Ramesh Kumar",
            "email": test_email,
            "password": "securepassword123",
            "phone": "+919472396956"
        }
        res_signup = self.client.post('/api/auth/register', json=signup_payload)
        self.assertIn(res_signup.status_code, [200, 400])

        # Login
        login_payload = {
            "email": test_email,
            "password": "securepassword123"
        }
        res_login = self.client.post('/api/auth/login', json=login_payload)
        self.assertEqual(res_login.status_code, 200)
        data_login = json.loads(res_login.data)
        self.assertTrue(data_login['success'])
        self.assertIn('token', data_login)
        print("  [OK] Test 03: User registration and JWT authentication working.")

    def test_04_create_web_appointment(self):
        """Test 4: Book an appointment via Web interface API for Dr. Bharat Prasad"""
        payload = {
            "doctor_id": 1,
            "patient_name": "Ramesh Kumar",
            "patient_phone": "+919472396956",
            "patient_email": "patient_kishanganj@example.com",
            "patient_age": 35,
            "patient_gender": "Male",
            "appointment_date": "2026-08-15",
            "time_slot": "10:30 AM",
            "reason": "Urology Consultation",
            "booking_source": "web"
        }
        res = self.client.post('/api/appointments', json=payload)
        self.assertEqual(res.status_code, 200)
        data = json.loads(res.data)
        self.assertTrue(data['success'])
        self.assertIn('appointment_id', data)
        print(f"  [OK] Test 04: Web Appointment created successfully! ID: #{data['appointment_id']}")

    def test_05_whatsapp_webhook_bot_flow(self):
        """Test 5: Full conversational WhatsApp appointment booking bot state machine for ENT Doctor"""
        test_phone = "+919472396956"

        # Step A: User sends "Hi"
        r1 = self.client.post('/api/whatsapp/webhook', json={"phone": test_phone, "message": "Hi"})
        d1 = json.loads(r1.data)
        self.assertIn("BHARAT CARE NURSING HOME WhatsApp Bot", d1['reply'])

        # Step B: User selects option "1" (Book Appointment)
        r2 = self.client.post('/api/whatsapp/webhook', json={"phone": test_phone, "message": "1"})
        d2 = json.loads(r2.data)
        self.assertIn("Select Department", d2['reply'])

        # Step C: User selects specialty "4" (ENT Specialist)
        r3 = self.client.post('/api/whatsapp/webhook', json={"phone": test_phone, "message": "4"})
        d3 = json.loads(r3.data)
        self.assertIn("Dr. Sachin Prasad", d3['reply'])

        # Step D: User selects date option "1" (Tomorrow)
        r4 = self.client.post('/api/whatsapp/webhook', json={"phone": test_phone, "message": "1"})
        d4 = json.loads(r4.data)
        self.assertIn("Select Available OPD Time Slot", d4['reply'])

        # Step E: User selects time slot "2" (12:00 PM)
        r5 = self.client.post('/api/whatsapp/webhook', json={"phone": test_phone, "message": "2"})
        d5 = json.loads(r5.data)
        self.assertIn("Full Name", d5['reply'])

        # Step F: User inputs patient name "Anil Prasad"
        r6 = self.client.post('/api/whatsapp/webhook', json={"phone": test_phone, "message": "Anil Prasad"})
        d6 = json.loads(r6.data)
        self.assertIn("APPOINTMENT CONFIRMED AT BHARAT CARE NURSING HOME", d6['reply'])
        self.assertIn("appointment_id", d6)

        # Verify DB record
        conn = get_db_connection()
        appt = conn.execute("SELECT * FROM appointments WHERE id = ?", (d6['appointment_id'],)).fetchone()
        conn.close()
        self.assertIsNotNone(appt)
        self.assertEqual(appt['patient_name'], "Anil Prasad")
        self.assertEqual(appt['booking_source'], "whatsapp")
        print(f"  [OK] Test 05: WhatsApp Bot conversation flow passed! Appointment #{d6['appointment_id']} created via WhatsApp.")

if __name__ == '__main__':
    unittest.main()
