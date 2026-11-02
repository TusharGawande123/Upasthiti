"""Phone punching (M4b): which file does what.

Pages and routes
- router.py: the endpoints the employee's phone calls (sign-in, notice, proofs, passkeys, punches).
- admin_router.py: the "Phone attendance" card on the employee page (Super Admin).
- schemas.py: request and response shapes of both routers.
- dependencies.py: who is calling (the `ups_phone` cookie) and the shared errors.

Signing in
- sign_in_service.py: code + password sign-in. passkey_service.py: passkeys (F-80).
- proof_service.py: "prove it is you" (face or card) and setting a password.
- passwords.py: password rules. sessions.py: phone sign-ins. user_agent.py: browser name.
- notice.py: the notice the employee accepts before the first punch.

Punching
- punch_service.py: the face challenge, the face punch and the gate-code punch.
- gate_code.py, gate_code_service.py: the changing phone code the gate screen shows.
- selfie_alert.py: bell notice when a gate-code selfie has no face.

Switches, views, upkeep
- access.py (read) and access_service.py (change): the two switches per employee.
- views.py, history.py: what the phone and the admin card show; the employee's own days.
- many_phones.py: bell notice for many phones. rate_limits.py: in-memory limits.
- cleanup.py: removes old proofs and scrubs old sign-ins. models.py: the tables.
"""
