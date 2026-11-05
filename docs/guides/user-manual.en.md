# Upasthiti user manual (English)

For the people who use the Upasthiti admin website: the **Super Admin**, the **Corporate Head** and the **Plant Head**.
Other languages: `user-manual.mr.md` (Marathi), `user-manual.hi.md` (Hindi).

Screenshots are shown as `[Screenshot: ...]`. They are added later from demo data (no real names).

Draft note: parts that belong to the M6 milestone and may not be built yet are marked **(M6, planned)**.

---

## 1. Before you start (everyone)

### 1.1 What Upasthiti does
- Workers punch IN and OUT at the **attendance device** at the plant gate. Permanent employees use their face.
  Temporary workers show a QR ID card.
- This website is where you set things up, see who is inside, fix mistakes and download reports.
- The server checks every punch. You cannot change a punch time. A mistake is fixed with a **correction**, and
  the old record stays.

### 1.2 What each role can do
| | Super Admin | Corporate Head | Plant Head |
|---|---|---|---|
| Plants, geofence, shifts, settings | Edit | Read | Read own plant |
| Employees | Add, edit, transfer, mark as left | Add, edit, transfer: **waits for the Super Admin** | Read own plant |
| QR cards, face enrolment | Yes | No | No |
| Attendance devices | All plants | Read | Own plant: add, pair, switch off |
| Corrections | Decides | Asks | Asks (own plant) |
| Dashboard and reports | All plants | All plants | Own plant |
| Data requests, data export **(M6, planned)** | Yes | No | No |

If a button is missing, your role may not allow it. The screen then says "You can view this but not change it."

### 1.3 Sign in and out
1. Open the website address and add `/admin`.
2. Type your **username or email** and your **password**. Press **Sign in**.
3. A first-time password is temporary. The website asks you for a new one (at least 10 characters).
4. To leave, open your name at the top and press **Sign out**.

[Screenshot: sign-in page]

After 5 wrong passwords the account is locked for 15 minutes. After 60 minutes without use you are signed out.

### 1.4 Find your way
- On a computer the menu is on the left. On a phone, press the menu button at the top.
- Press **Ctrl + K** to search for any page.
- The bell shows notices. The red numbers on menu items show work waiting.

[Screenshot: dashboard with the menu]

---

## 2. Super Admin

### 2.1 Task 1: Log in
Follow section 1.3.

### 2.2 Task 2: Add an employee
1. Open the menu **Employees**. Press **Add employee**.
2. Choose the **plant**. Choose **Permanent** or **Temporary**. The type cannot be changed later except by a
   conversion (task 9).
3. Type the **employee code** (use the company's code), the name, the department, the shift and the **category**.
4. For a temporary worker choose the **contractor** and type the overtime rate per hour (Rs).
5. Choose how the person punches: **Face** for permanent, **QR card** for temporary.
6. Press **Save**. The employee appears in the list.

[Screenshot: Add employee form]

To add many people use **Import**: download the template, fill it, upload it. The website shows every wrong
row before anything is saved.

To mark a person as **left**: open the employee, press **Mark as left**, give the date and the reason. History
stays. Only the Super Admin can do this. If the person has a face record, it is deleted in the same step.

### 2.3 Task 3: Issue and print a QR card
1. Open the employee. Press **Issue card**. (Or open **QR cards** to issue many.)
2. Press **Print card** for a card-size print, or **Print cards (A4)** for many on one sheet.
3. Check the card by showing it to the attendance device. A **TEST card** (menu **QR cards**, Test cards) does not
   record attendance.
4. A lost card: open the card and press **Revoke**, then issue a new one. A card works only at the person's own
   plant and ends after 2 months by default.

[Screenshot: QR card print preview]

### 2.4 Task 4: Enrol a face
Only the Super Admin enrols faces, and only after the person agrees.
1. Open the employee. In the **Face** panel press **Enrol face**.
2. Read the **consent text** to the person in their language. Let them agree. The Super Admin records the
   consent. (The company address and the privacy contact must be filled in Settings first.)
3. Ask the person to face the camera. The website takes five poses. Follow the on-screen hints.
4. When it says **Face enrolled**, the person can punch by face tomorrow.
5. The website does not keep the pictures. It keeps an encrypted record of numbers.

A person who says no is not punished. Give them a QR card instead (change the punch method to **QR card**).
To remove a face record, use **Delete face data** (a reason is needed) or **Withdraw consent**.

[Screenshot: Face panel with consent]

### 2.5 Task 5: Read the dashboard
1. Open **Dashboard**. Pick a plant or **All plants**.
2. You see who is **inside now**, who is **expected**, **late**, **not arrived** and **on leave**. The numbers refresh
   every 30 seconds.
3. Open **Emergency muster** for the list of everyone inside. Print it for an emergency.
4. Open **Needs review** for punches that need your check. Open **Notifications** (the bell) for alerts, for example
   an attendance device that is offline.

[Screenshot: dashboard]

### 2.6 Task 6: Approve a request
The Corporate Head's employee changes wait here.
1. Open **Approvals**.
2. Open a request. You see **before** and **after**.
3. Press **Approve**. Or press **Reject** and write a reason. The person who asked sees the result.
4. Nothing changes until you approve.

[Screenshot: Approvals inbox]

### 2.7 Task 7: Fix a missed punch
1. Open **Attendance**. Find the day. A missing OUT shows as **Incomplete**.
2. Press **Correct this day**. Choose what to add, the time and a **reason**.
3. Look at the **before and after** preview. Press **Save**.
4. After a long outage, use **Correct many people** to fix up to 200 people at once.
5. Requests from the Corporate Head and Plant Heads wait in **Corrections**. Open one and approve or reject.
6. The old punch is never deleted. A corrected day shows a star mark.

[Screenshot: correction preview]

### 2.8 Task 8: Download a report
1. Open **Reports**. Choose the report, the plant and the dates.
2. Press **Download Excel** or **Download PDF**.
3. Wait for the file. If it says it is preparing, the page asks again by itself.
4. The limit is 20 files in 10 minutes. A PDF holds up to 3,000 rows: use Excel for more.
5. For one plant over many months use **Register for a period** (up to one year). For one person use **One
   employee for a period**.

[Screenshot: Reports page]

### 2.9 Task 9: Convert a temporary worker to permanent
1. Open the employee. Press **Convert to permanent**.
2. Choose the day it starts. It can be from the 1st of last month up to 60 days ahead.
3. Read the preview. The contractor and hourly rate stop. The QR card is cancelled. Old days stay temporary.
4. Press **Convert**. The dialog offers **Enrol face now**. Do it the same day (section 2.4).
5. Until the face is enrolled, the person **cannot punch**. The employee page shows **Face enrolment pending** and you get an urgent notice. Fill the
   gap with corrections (task 7).
6. If the person refuses a face scan, change the punch method back to QR card and issue a new card.
7. Convert only on a day when you can enrol the person the same day.

[Screenshot: conversion dialog]

### 2.10 Task 10: Answer a data request **(M6, planned)**
An employee can ask what data you hold, ask for a correction, for deletion, or take back consent. You must
answer within **30 days**.
1. Open **Data requests**. Press **Add request**. Choose the kind, the person (employee code), how it came and the
   date received. Do not write health details in the note.
2. Open the request. Add the steps in order: **Identity checked** (ID card seen, or the person signed in on the
   phone), **Action taken**, **Answer sent**, **Closed**.
3. For a face deletion use the **Face** panel (**Delete face data** or **Withdraw consent**).
4. A deletion request is closed as **Partly done** with the reason "Attendance and audit records are kept as the
   Labour Codes require."
5. Watch the due date. The bell warns you 5 days before.

[Screenshot: Data requests]

### 2.11 Other Super Admin work
- **Users:** add Corporate Heads and Plant Heads (give a Plant Head one plant).
- **Plants and geofence:** draw the area on the map. Use **Show my location** and satellite view.
- **Attendance devices:** add, pair, switch off (section 3.5).
- **Settings:** rules such as grace time, retention, phone attendance. Change only when you understand the effect.
- **Phone attendance:** on the employee page, switch phone attendance on for a person who asks, with a reason.
  You can also allow **Outside work**.
- **Leave and Holidays:** add leave and plant holidays.
- **Audit log:** see who did what.
- **Data export (M6, planned):** download all data to your own computer. It holds personal data. Keep it on an
  encrypted drive. Never send it by chat or email.

> **Rule for the Super Admin: do not write medical details.** In a leave reason never write an illness, a diagnosis,
> a doctor or a medicine. Write "Personal reason" instead. The reason is optional.

---

## 3. Plant Head

You see and work with **your own plant** only.

### 3.1 Sign in
Follow section 1.3.

### 3.2 See who is inside
1. Open **Dashboard**. It shows your plant: inside now, late, not arrived.
2. Open **Emergency muster** and press **Print** in an emergency.

### 3.3 Look at attendance
1. Open **Attendance** for a day, or **Monthly register** for a month.
2. Open **Punch log** to see every punch and why a punch was refused.

### 3.4 Ask for a correction
1. Open **Attendance**, find the day, press **Request correction**.
2. Choose what to add, the time, and write a reason. Press **Send**.
3. The Super Admin decides. See the answer in **Corrections**.

### 3.5 Look after your attendance devices
1. Open **Attendance devices**. Press **Add device**. Give it a name. Press **Make pairing code**.
2. On the device follow the attendance device setup guide (for the person who mounts the device).
3. To switch a lost or stolen device off, press **Revoke**. If it says punches are still waiting, cancel and
   wait until it shows 0, unless the device was stolen.
4. A red badge in the top bar means a device is offline. Check its Wi-Fi and power.

[Screenshot: Attendance devices page]

### 3.6 Gate notices and reports
- **Gate notices:** you can write a short notice that shows on the gate screen.
- **Reports:** download reports for your plant (section 2.8).

---

## 4. Corporate Head

You see all plants. You can ask for changes, but **the Super Admin must approve** employee changes.

### 4.1 Sign in and look
Follow section 1.3. **Dashboard**, **Attendance**, **Monthly register**, **Punctuality** and **Reports** show all plants.

### 4.2 Add or change an employee (a request)
1. Open **Employees**. Press **Add employee**, or open an employee and press **Edit**.
2. Fill the form as in section 2.2 and press **Send for approval**.
3. Nothing changes yet. The request goes to the Super Admin.
4. Open **My requests** to see the status. You can withdraw a request before it is decided. A rejected request shows the reason.

The same waiting applies to **transfer**, **bulk change** and **Import**.

### 4.3 Ask for a conversion
1. Open the temporary employee. Press **Ask for conversion**. Choose the day.
2. The request goes to the Super Admin. He enrols the face and decides.

### 4.4 Ask for a correction
Same as the Plant Head (section 3.4), for any plant.

### 4.5 Reports
Download reports for all plants (section 2.8). The corrections report shows the action but not the Super Admin's private reasons.

---

## 5. When something is wrong

| Problem | What to do |
|---|---|
| A button is missing | Your role may not allow it |
| "Try again in a few minutes" for a file | You asked for too many files. Wait 10 minutes |
| The website is slow after a quiet time | The server is waking up. Wait one minute |
| A worker is refused at the gate | The refusal says "Please visit the plant office." Open **Punch log** and read the reason |
| An attendance device is offline | Check power, Wi-Fi and the location setting on the device |
| You forgot your password | Ask the Super Admin to reset it |

## 6. Words used in this manual
- **Attendance device:** the phone, tablet or PC with a camera at the gate.
- **Geofence:** the area of the plant drawn on a map.
- **Correction:** a new record that fixes a day. The old record stays.
- **Needs review:** punches that the Super Admin should check.
- Upasthiti does not calculate salary.
