"""
Follow-up notification worker.
Run: python automation.py --run-once

WHAT THIS DOES
--------------
Doctor clicks a follow-up button (e.g. "7 days") on a completed OPD visit.
That is the ONLY manual step. From there on this worker handles everything
by itself:

  1. It's scheduled to run automatically once a day (see "Scheduling"
     below) — nobody has to run it by hand.
  2. Each run checks the database for reminders whose date has arrived.
     A reminder is scheduled for ONE DAY BEFORE the chosen follow-up
     date (e.g. the "7 days" option reminds the patient on day 6), so
     the app.py side already worked that out when the doctor clicked
     the button.
  3. For every reminder that is due today, it sends the WhatsApp
     message automatically — no one types or clicks anything.

Until real WhatsApp credentials are configured (see below), it runs in
DRY-RUN mode: due messages are logged to the console/log file instead
of being sent, so the scheduling logic can be tested safely before you
go live.

WHATSAPP SETUP (do this once, before going live)
--------------------------------------------------
This uses the official Meta WhatsApp Cloud API. Set these as
environment variables on the server (never hardcode them in code):

    WHATSAPP_PHONE_NUMBER_ID   Meta Business Manager -> WhatsApp ->
                               API Setup -> Phone number ID
    WHATSAPP_ACCESS_TOKEN      A permanent access token for your WABA
                               (System User token, not the 24-hour one)
    WHATSAPP_TEMPLATE_NAME     Name of your APPROVED message template
                               (default: follow_up_reminder)
    WHATSAPP_TEMPLATE_LANG     Template language code (default: en)

IMPORTANT: WhatsApp does not allow a business to freely message a
patient days after the last conversation — only a pre-approved
"template" message is allowed outside the 24-hour chat window. You
must create and get this template approved in Meta Business Manager
BEFORE going live. It needs exactly 3 body placeholders in this order:

    {{1}} = patient name
    {{2}} = doctor name
    {{3}} = follow-up date

Example template body to submit for approval:
    "Hello {{1}}, this is a reminder from Bharat Care Nursing Home.
    Your follow-up with {{2}} is due on {{3}}. Reply BOOK to request
    an appointment or STOP to opt out of reminders."

Template approval usually takes a day or two. Swapping to a different
provider (Gupshup / AiSensy / Twilio / WATI etc.) later only means
rewriting the send_whatsapp_template() function below — nothing else
in this file or in app.py needs to change.

SCHEDULING (make it run daily by itself)
-----------------------------------------
Linux/macOS server — add a crontab entry (runs daily at 8:00 AM):
    0 8 * * *  cd /path/to/project && /path/to/venv/bin/python automation.py --run-once >> logs/automation.log 2>&1

Windows server — use Task Scheduler with a daily trigger running:
    python automation.py --run-once
(same idea as the existing run_backup.bat + Task Scheduler setup for backups)

Either way, the server must simply be ON and reachable by its own
scheduler at that time — nobody needs to be logged in or click anything.
"""
import argparse
import datetime
import json
import os
import urllib.error
import urllib.request

from database import get_db_connection

WHATSAPP_PHONE_NUMBER_ID = os.environ.get("WHATSAPP_PHONE_NUMBER_ID")
WHATSAPP_ACCESS_TOKEN = os.environ.get("WHATSAPP_ACCESS_TOKEN")
WHATSAPP_TEMPLATE_NAME = os.environ.get("WHATSAPP_TEMPLATE_NAME", "follow_up_reminder")
WHATSAPP_TEMPLATE_LANG = os.environ.get("WHATSAPP_TEMPLATE_LANG", "en")
WHATSAPP_API_VERSION = os.environ.get("WHATSAPP_API_VERSION", "v20.0")


def is_whatsapp_configured():
    return bool(WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN)


def send_whatsapp_template(phone, patient_name, doctor_name, follow_up_date):
    """
    Sends the approved follow-up reminder template via the Meta
    WhatsApp Cloud API. Returns (True, None) on success, or
    (False, error_message) on failure.
    """
    url = f"https://graph.facebook.com/{WHATSAPP_API_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages"

    payload = {
        "messaging_product": "whatsapp",
        "to": (phone or "").replace(" ", "").replace("-", ""),
        "type": "template",
        "template": {
            "name": WHATSAPP_TEMPLATE_NAME,
            "language": {"code": WHATSAPP_TEMPLATE_LANG},
            "components": [
                {
                    "type": "body",
                    "parameters": [
                        {"type": "text", "text": patient_name or "Patient"},
                        {"type": "text", "text": doctor_name or "your doctor"},
                        {"type": "text", "text": follow_up_date or ""},
                    ],
                }
            ],
        },
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {WHATSAPP_ACCESS_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
        return True, None
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}: {e.read().decode(errors='ignore')[:300]}"
    except Exception as e:
        return False, str(e)


def run_once():
    today = datetime.date.today().isoformat()
    conn = get_db_connection()

    rows = conn.execute(
        """
        SELECT n.id, n.phone, n.message,
               p.do_not_disturb, p.enabled, p.follow_up_date,
               a.patient_name,
               d.name AS doctor_name
        FROM follow_up_notifications n
        JOIN follow_up_plans p ON p.id = n.follow_up_plan_id
        JOIN appointments a ON a.id = p.appointment_id
        JOIN doctors d ON d.id = p.doctor_id
        WHERE n.status = 'pending' AND n.scheduled_for <= ?
        """,
        (today,),
    ).fetchall()

    dry_run = not is_whatsapp_configured()
    sent = failed = skipped = 0

    for r in rows:
        # Doctor-controlled do-not-disturb, or reminders turned off, or
        # no phone number on file — never send in these cases.
        if not r["enabled"] or r["do_not_disturb"] or not r["phone"]:
            conn.execute(
                "UPDATE follow_up_notifications SET status='skipped' WHERE id=?",
                (r["id"],),
            )
            skipped += 1
            continue

        if dry_run:
            conn.execute(
                "UPDATE follow_up_notifications SET status='ready' WHERE id=?",
                (r["id"],),
            )
            print(f"[DRY RUN] TO {r['phone']}: {r['message']}")
            continue

        ok, error = send_whatsapp_template(
            r["phone"], r["patient_name"], r["doctor_name"], r["follow_up_date"]
        )

        if ok:
            conn.execute(
                "UPDATE follow_up_notifications SET status='sent', sent_at=CURRENT_TIMESTAMP WHERE id=?",
                (r["id"],),
            )
            sent += 1
        else:
            conn.execute(
                "UPDATE follow_up_notifications SET status='failed' WHERE id=?",
                (r["id"],),
            )
            failed += 1
            print(f"[FAILED] TO {r['phone']}: {error}")

    conn.commit()
    conn.close()

    if dry_run:
        print(
            f"Due follow-ups: {len(rows)} | Prepared (DRY RUN — set the "
            f"WHATSAPP_* environment variables to actually send): "
            f"{len(rows) - skipped} | Skipped: {skipped}"
        )
    else:
        print(
            f"Due follow-ups: {len(rows)} | Sent: {sent} | Failed: {failed} | Skipped: {skipped}"
        )

    return {"due": len(rows), "sent": sent, "failed": failed, "skipped": skipped, "dry_run": dry_run}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-once", action="store_true")
    args = parser.parse_args()
    if args.run_once:
        run_once()
    else:
        print("Use: python automation.py --run-once")
