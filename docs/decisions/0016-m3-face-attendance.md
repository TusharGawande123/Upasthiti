# 0016 – M3 decisions: face enrolment and face punch

Date: 2026-10-24 · Decided by: Tushar Gawande (project lead), in chat while the M3 spec was written ·
Status: Accepted (the spec itself is still a draft)
Details: [docs/specs/M3-face-attendance.md](../specs/M3-face-attendance.md).

## Decisions

1. **Face model: measure first, then pick.** Slice 1 runs both InsightFace `buffalo_l` (SCRFD det_10g +
   ArcFace w600k_r50) and `buffalo_s` (det_500m + w600k_mbf) in a Docker container limited to 512 MB
   (Render Free's hard limit; more RAM is a paid plan, so it is not an option). `buffalo_l` is kept only
   if it leaves enough free memory and the server's face decision stays under 2 s (NFR-01); otherwise
   `buffalo_s` is used, if it meets NFR-05. If neither fits, Plan B of decision 0002 (a free host with
   more RAM) is discussed with the lead first.
2. **Liveness: server-chosen head turn + passive anti-spoof.** The server picks "turn left" or "turn
   right" at random and checks the head turn itself in the frames; an anti-spoof model (MiniFASNet or a
   CelebA-Spoof model, compared in M3) checks the frontal frame. No blink check: a blink can only be
   seen by the browser, and the browser is not trusted.
3. **Only the Super Admin enrols faces** (like QR cards, decision 0005).
4. **Enrolment happens in the admin website**, with the camera of any admin laptop or phone. The gate
   attendance device gets no admin login.
5. **Face does not match → employee code + 1:1 match.** When the server is unsure, the attendance
   device asks for the employee code and the server compares the face with that one person only. If
   that fails too: "Please visit the plant office." A face employee's QR card stays refused
   (`EMPLOYEE_NOT_QR`, as in M2).
6. **Consent on screen.** The employee reads the consent text and taps "I agree" (text version,
   language, time and the Super Admin are saved). Without consent the camera stays off. The employee
   may choose a QR card instead.
7. **Photo at a face punch only when it is rejected or needed the employee code** (320 px, encrypted,
   same retention as QR photos, Super Admin only). An accepted face punch keeps no photo; face frames are
   never stored.
8. **Template deleted at once** when the employee is marked as left or withdraws consent (the row keeps
   only the deletion date). After a withdrawal the punch method becomes QR (SRS FR-13).
9. **Gate screen: a "Punch with face" button.** Card reading stays zero-tap as today; a face punch
   starts with one tap. This changes SRS FR-16 ("zero taps") for face punches.
10. **8 guided enrolment shots** (SRS FR-12), each checked by the server.
11. **Accuracy test data:** the team's own faces (with consent, kept on their laptops, never committed)
    plus a public face dataset downloaded at test time. Only the numbers go into the repository.
12. **A new, separate key `FACE_TEMPLATE_KEY`** encrypts the templates (not the snapshot key). If it is
    lost, every face must be enrolled again: keep it in the password manager.

13. **Punch method changed from face to QR (normal edit or approved request): the template is deleted
    at once**, as for a withdrawal.
14. **Privacy contact = the Super Admin** by default (name and email), editable in Settings.
15. **Python 3.13 is allowed** for the backend image if onnxruntime or opencv has no 3.14 wheel
    (then a new decision changes 0001).
16. **Slice 1 runs once on a temporary second Render Free service** (deleted the same day) to measure
    Render's real 0.1 CPU. Other free hosts were checked: none without a card gives more than 512 MB;
    Oracle Cloud Always Free needs an international credit card. Render stays; if the face models do
    not fit even as `buffalo_s` / INT8, the lead chooses between Oracle and the client's own server.

## Extras (accepted-extras.md)
Approved for M3: duplicate face check at enrolment, enrolment progress, F-30 face-in-photo check on QR
photos, re-enrol hint, 512 MB memory test in CI, face model state on the health check (+ warm-up), face
accuracy report tool. Not chosen (Later): DPDP consent register export.
