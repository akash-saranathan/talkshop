"""Run from the project root to reset a user's password.
   Usage: python reset_password.py
"""
from backend.auth.security import hash_password
from backend.db.schema import User
from backend.db.session_utils import get_session

email = input("Email: ").strip()
new_pw = input("New password (min 8 chars): ").strip()

if len(new_pw) < 8:
    print("Password too short — must be at least 8 characters.")
    raise SystemExit(1)

with get_session() as db:
    user = db.query(User).filter(User.email == email).first()
    if not user:
        print(f"No account found for {email}")
        raise SystemExit(1)
    user.password_hash = hash_password(new_pw)
    db.commit()
    print(f"Password reset for {user.name} ({email}). You can now log in.")
