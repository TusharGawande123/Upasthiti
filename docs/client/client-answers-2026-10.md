# Client answers to the proposal questions (Sheet Shapers, October 2026)

Received by Tushar Gawande from Sheet Shapers on 2026-10-12, answering Q1–Q10 of proposal
v1.1, plus follow-up answers from the client and the lead. The team's decisions on these
answers are in [docs/decisions/0004-client-answers.md](../decisions/0004-client-answers.md).
The contact person's phone number is kept by the lead and is deliberately **not** stored in
this public repository.

## Answers

| # | Question (short) | Answer |
|---|---|---|
| Q1 | How should temporary workers scan QR? (A: show ID card to gate camera; B: scan a changing QR on a gate screen with own phone) | **Both** |
| Q2 | Permanent employees: phone + gate, or gate only? | **Phone + gate** (phone is optional per employee, switched on by an admin) |
| Q3 | Plants, addresses, gates per plant | 7 plants (list below). Gates: assume **one gate per plant** for now |
| Q4 | Permanent and temporary workers | **300 permanent, 350 temporary**, total for all plants |
| Q5 | Shift timings, overtime rules, temporary workers' hours | **07:00 AM to 07:00 PM.** Shift timings can change, and new shifts can be added; each shift sets when overtime starts and its rate. How temporary workers' hours are counted: not answered yet |
| Q6 | Devices for gates and testing | **Phone / PC** |
| Q7 | Hosting: own server or outside service | **Own server** in the form; follow-up: **use the free tiers for now**, move to the own server only if the free tiers cannot handle the data |
| Q8 | Contact person and dummy employee data | Contact: **Sachin K.** Dummy data: not given yet |
| Q9 | Salary components and rules | **Staff: fixed salary (CTC). Workers, operators and helpers: different hourly rates / wages.** Parts (b)–(f) not answered yet |
| Q10 | Sample salary structure | **Sachin will share a salary slip** (real slips are never committed; we make dummy figures from it) |

## Plants (Q3)

All seven plants belong to **one company, Sheet Shapers**, although some carry other names.
All are in MIDC Waluj, Aurangabad (Chhatrapati Sambhajinagar) 431136.

| # | Plant name | Address |
|---|---|---|
| 1 | Sheet Shapers India Pvt Ltd (K-134) | K-134, MIDC, Waluj, Aurangabad 431136 |
| 2 | Sheet Shapers India Pvt Ltd (X-280) | 72, X-280, MIDC, Waluj, Aurangabad 431136 |
| 3 | Precise Cuts India Pvt Ltd, Unit 1 | E-70/22, MIDC, Waluj, Aurangabad 431136 |
| 4 | Precise Cuts India Pvt Ltd, Unit 2 | E-70/20, MIDC, Waluj, Aurangabad 431136 |
| 5 | Siddharth Pressings India Pvt Ltd | C-97, MIDC, Waluj, Aurangabad 431136 |
| 6 | Tirupati Pressco, Unit 1 | 9, S.L.U.Y., MIDC, Waluj, Aurangabad 431136 |
| 7 | Tirupati Pressco, Unit 2 | 9/1, S.L.U.Y., MIDC, Waluj, Aurangabad 431136 |

Map positions and geofences are drawn by an admin on the map during setup (M1) and checked
on site; they are not guessed here. (Plant 2's exact plot can be looked up on a map then.)

## Follow-up answers already received

- Gates: assume one gate per plant.
- Shifts: the client must be able to add shifts when needed and set, per shift, after how
  many hours overtime starts and at what rate.
- Hosting: free tiers first; own server only if they are not enough.
- Roles: Super Admin, Corporate Head, Plant Head. No HR or supervisor users.
- Company: all plants are under Sheet Shapers.

## Still to ask the client (Sachin K.)

1. How are temporary workers' hours counted: first IN to last OUT, minus breaks (Q5)?
2. Salary rules (Q9 b–f): per-day basis (/26, /30 or actual days); are weekly offs, holidays
   and paid leave payable; hourly rates per category (worker, operator, helper); is the
   structure per employee or per grade?
3. Roles: what exactly the Corporate Head and Plant Head may see and change (asked again in
   the M1 spec).
4. Phone punching: do temporary workers have smartphones (Q1 option B)? Who may switch
   phone punching on for an employee?
5. Dummy employee data for testing (Q8).
