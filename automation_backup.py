"""Follow-up notification worker.
Run: python automation.py --run-once
This creates/marks due notifications. Connect the pending outbox to the hospital's
approved WhatsApp Business provider for real delivery.
"""
import argparse, datetime
from database import get_db_connection

def run_once():
    today=datetime.date.today().isoformat()
    conn=get_db_connection()
    rows=conn.execute("""
        SELECT n.id,n.phone,n.message,p.do_not_disturb,p.enabled
        FROM follow_up_notifications n
        JOIN follow_up_plans p ON p.id=n.follow_up_plan_id
        WHERE n.status='pending' AND n.scheduled_for<=?
    """,(today,)).fetchall()
    ready=[]
    for r in rows:
        if r['enabled'] and not r['do_not_disturb'] and r['phone']:
            ready.append(dict(r))
    # Mark skipped notifications so the worker is idempotent.
    for r in rows:
        status='ready' if r['id'] in {x['id'] for x in ready} else 'skipped'
        conn.execute("UPDATE follow_up_notifications SET status=? WHERE id=?",(status,r['id']))
    conn.commit(); conn.close()
    print(f"Due follow-ups: {len(rows)} | Ready for WhatsApp delivery: {len(ready)}")
    for r in ready:
        print(f"TO {r['phone']}: {r['message']}")
    return ready

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--run-once',action='store_true'); args=parser.parse_args()
    if args.run_once: run_once()
    else: print('Use: python automation.py --run-once')
