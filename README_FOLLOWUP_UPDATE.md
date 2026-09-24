# Bharat Care Hospital Appointment System – Queue & Follow-up Update

## What was added
- Doctor-wise daily queue/token numbers (URO-01, GYN-01, ENT-01, etc.)
- Queue states: waiting, called, in_consultation, completed, no_show
- Department-wise follow-up presets
- Doctor-controlled No Follow-up / Do Not Disturb
- 30-day same-doctor follow-up fee waiver support (₹0)
- Patient/doctor follow-up plan and notification outbox
- Automated feedback-ready review workflow remains compatible with existing reviews
- Login attempt protection (5 failures -> 15 minute lock)
- SQLite backup utility with integrity check and 30-backup retention

## Run
1. Keep the existing `carepulse.db` in the project folder. Do NOT delete it.
2. Install Python dependencies:
   `python -m pip install -r requirements.txt`
3. Start the app:
   `python app.py`
4. Open:
   `http://localhost:5000`

`database.py` performs safe schema migration when the app starts.

## Backup
Run `run_backup.bat` or `python backup.py`. For daily automation, schedule `run_backup.bat` in Windows Task Scheduler.

## Follow-up worker
Run `python automation.py --run-once` to process due follow-up notification records. The worker prepares due messages in the notification outbox; a real WhatsApp Business provider must be connected for actual delivery.

## Important
Follow-up intervals are workflow presets, not medical advice. Doctors/hospital policy should determine the appropriate interval. The 30-day fee waiver is a billing rule configured in this project and should be confirmed against the hospital's actual policy before production use.


## Dashboard v2
- Queue status is now direct-click: Waiting, Called, Completed, No Show.
- Follow-up is now direct-click: the four department-wise options appear as buttons; no popup/prompt.


## Latest UI update
- Today's Patients is now the single combined workspace for Token, Queue status, Fee and Department-wise Follow-up.
- The separate Live Queue & Follow-up table was removed from the dashboard UI.
- Queue actions are direct buttons: Waiting, Called, Completed, No Show.
- Follow-up actions are direct department-specific buttons.
- Today's collection is calculated from appointment fees; free follow-ups show ₹0.
