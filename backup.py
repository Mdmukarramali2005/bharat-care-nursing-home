"""SQLite backup utility. Run: python backup.py"""
from pathlib import Path
import sqlite3, shutil, datetime
from database import DB_FILE
ROOT=Path(__file__).resolve().parent
BACKUP_DIR=ROOT/'backups'
KEEP=30

def backup():
    BACKUP_DIR.mkdir(exist_ok=True)
    stamp=datetime.datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
    target=BACKUP_DIR/f'carepulse_{stamp}.db'
    src=sqlite3.connect(DB_FILE)
    dst=sqlite3.connect(target)
    with dst: src.backup(dst)
    src.close(); dst.close()
    check=sqlite3.connect(target)
    result=check.execute('PRAGMA integrity_check').fetchone()[0]; check.close()
    if result!='ok':
        target.unlink(missing_ok=True); raise RuntimeError(f'Backup integrity check failed: {result}')
    files=sorted(BACKUP_DIR.glob('carepulse_*.db'), key=lambda p:p.stat().st_mtime, reverse=True)
    for old in files[KEEP:]: old.unlink(missing_ok=True)
    print(f'Backup created: {target} | integrity: {result}')

if __name__=='__main__': backup()
