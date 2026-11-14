# nclex-qbank

A small, private web app. Each user account holds its own practice questions and its own answers, synced across that person's iPhone, iPad, and Mac. It started as NCLEX-style questions for a nursing student in an accelerated BSN (ABSN) program. A study topic is the same kind of place for any subject.

This document is the product spec (PRD). Every worker reads it before building anything, and it is the source Claude Design uses to generate the app's design system. The app is built one milestone at a time (see [Milestones](#milestones)).

For study use only; not clinical advice.

## Contents

- [What the app is](#what-the-app-is)
- [What the app is not](#what-the-app-is-not)
- [Users](#users)
- [How questions get into the app](#how-questions-get-into-the-app)
- [Screens and flows](#screens-and-flows)
- [Platforms and layouts](#platforms-and-layouts)
- [Design direction](#design-direction)
- [Question formats and scoring](#question-formats-and-scoring)
- [Data the app stores](#data-the-app-stores)
- [Stack and hosting](#stack-and-hosting)
- [Privacy and security](#privacy-and-security)
- [Milestones](#milestones)
- [Settled decisions](#settled-decisions)
- [Open questions](#open-questions)

## What the app is

- **A question bank and runner, nothing more.** Her courses and study topics, the practice sets in their folders, a timed exam over the folders she picks, a Review list of what she missed or guessed, and a Terms list per course or topic.
- **Organized the way her program is, and the way she likes:** Semester (1, 2, 3) > Course (for example "NURS 101") > Folder (Week 1, First Pass, ABG Practice, ... named by her) > Practice set > Questions. Her folders can sit on an exam page (Exam 1, Exam 2), one page at most each, so each exam gathers the folders it covers. A study topic is not inside a semester: Topic > Folder > Practice set > Questions, and its folders sit on a study page the same way (see [Study topics](#study-topics)).
- **The same everywhere.** Every answer is saved on the server, so her progress, Review list, and exam history are identical on her iPhone, iPad, and Mac. Sync is the reason the app exists; without it, the existing offline practice pages would be enough.
- **Installable.** A web app (PWA) with a manifest and icons: on iPhone and iPad it is added from Share > Add to Home Screen, on the Mac from Safari > File > Add to Dock, and it opens full-screen without browser chrome, like a native app.
- **The existing runner, kept.** The question screens, the question formats, the scoring with partial credit, "I'm guessing", and the per-option rationale all come from the offline practice pages she already uses (see [Question formats and scoring](#question-formats-and-scoring)).

## What the app is not

Each of these was cut on purpose. Anything a user asks for later is a new decision, not a planned phase.

| Not in the app | Why |
|---|---|
| Syncing or storing her course folders | Slides, transcripts, and notes stay in her iCloud course folder. The app holds questions, not a copy of the folder. Make questions reads only the material she hands it for one job (notes she pastes, photos, or a file). A study page may link to a primer; the primer stays where it was written. |
| Study plans, high-yield sheets, flashcards, day-by-day exam plans | Study-planning territory, deliberately out of scope. Anki cards are not imported. |
| Spaced repetition, streaks, reminders, a weakness dashboard | Same reason. Review is only "what I missed or guessed". A review schedule stays outside the app. |
| Analytics beyond per-set and per-exam scores | Not needed. Each account already sees its own scores. |
| Offline answering (cached sets, queued answers) | Deferred. The app is online-only; the home-screen icon still works. |
| Open sign-up, classmates, sharing | Only emails the owner adds can sign up, and one account cannot see another's questions (see [Users](#users) and [Study topics](#study-topics)). |
| Email of any kind (reset links, notices) | No email service. The owner resets her password from his admin account. |
| Native iOS or macOS apps | The installable web app covers all three devices. A SwiftUI iOS app may come later as a second client of the same API (see [Settled decisions](#settled-decisions)). It has no Admin screen and no sign-up list; those stay on the web (decision 22). |
| A theme picker | Only Look (light or dark) and a choice of two color schemes, Dusk and Slate. |

## Users

| User | Can do | Cannot do |
|---|---|---|
| **A user** | Everything in her own account: import question files, make and edit semesters, courses, and study topics, practice, take exams, use Review and Terms, manage her password, and connect her agent. | See or change another account's questions, or let anyone else sign up. |
| **The owner** (who set the app up) | Sign in with his own **admin** login to look after the user accounts: keep the sign-up list of emails that may make an account, reset a password, and repair an account's data if something breaks. See **any user account** as its user does, frozen: every screen and control is there, and nothing can be changed. | Change anything in a user account from that view: answer, take an exam, import, edit, delete, or bring back. The server refuses every such write. In his words: "this is for her, I'm just creating the app for her to help her study in her program." |

- **Sign-up only for emails the owner adds (2026-10-01).** A user makes her own account from the Sign up screen, but only with an email on the owner's sign-up list. The admin account is never made there; a setup command run by the owner creates it, and can also create a user account and put emails on the sign-up list.
- **Each account's material is its own (2026-10-21).** Semesters, courses, topics, exam pages, study pages, folders, sets, questions, and terms belong to one account. Every list, detail, and edit is limited to that account, and another account's id is answered as if it were not there. Answers, progress, the Review list, and exams were already per account. The owner picks which user account he is looking at in Admin. There is no shared question bank.
- Every login uses a password. The browser or the iPhone saves it and fills it in (with Face ID on the iPhone). There are no passkeys.

## How questions get into the app

There are two doors. Both end in the same place: a set filed in a folder of her course or topic.

**Door 1: an agent makes the questions outside the app, and she imports them.** The agent is any AI agent she brings.

1. **Her agent makes a set outside the app** by running the weekly `nclex-questions` skill. The skill reads the week's slides and transcripts from her iCloud folder, writes 12 to 15 hard questions per batch, runs a blind accuracy check, and returns one JSON question file.
2. **She imports that file in the app** from any device: Import, paste the JSON or choose the file, pick the course and a folder (Unsorted unless she picks one), confirm the set name, Check file, Import.
3. **The app checks the file's shape** with the same rules the existing runner's importer uses. Errors block the import and are listed in words she can paste back to her agent; warnings import anyway.

Her agent can also hand a set to QBank itself, with an agent key of its own instead of her pasting the file. Nobody copies a key: the agent asks to pair and shows her a short code, she enters or confirms it in **Settings › Account › Connect an agent**, sees the agent's name and what it asks to do, and approves or denies it; the agent then picks its key up. A key does only what she approved: **import** sets (and read what importing needs, never replacing, moving, renaming, or deleting anything), **read** her progress without changing anything, or **manage** her content: add, change, and delete her sets, questions, folders, courses, and topics as she can in QBank, with everything it deletes going to Recently deleted, where Undo brings it back for 30 days. Manage is marked "Most access" when she approves it and in her keys. No key answers questions for her, and she can revoke one there at any time. Sets it imports say "Imported by your agent".

**Door 2: Make questions, inside QBank.** An account that may make questions now (`GET /api/question-maker` answers `available: true`; today only hers) asks QBank to write a set from material she hands it for that job (notes or slides she pastes, photos, or a file), or to copy in practice questions she already has on paper. QBank's server runs a copy of her agent's recipe, and files the set in the course or topic and folder she names (Unsorted if none). The same recipe writes exam twins (see [Exam setup](#exam-setup)). It is on the iPhone app's Add tab and on the web, under Import (a **Make questions from your material** row, shown only to an account that may make questions now) and in a course's **+** menu; exam twins are in the web app's Exam setup. The web uses the same `/api/question-jobs` routes, allowlist, and daily limit as the iPhone.

The recipe is her agent's `nclex-questions` skill; QBank runs a copy of it.

The app checks shape, not clinical accuracy. A wrong question is fixed in the JSON and re-imported, which replaces the set (see [Import](#import)).

### The import file

The recipe's JSON, the format the runner's importer accepts, plus an optional table and images per question (see [Tables and images](#tables-and-images)):

```json
{
  "title": "Week 4 - Set 1: <topic>",
  "desc": "One sentence about what this set covers.",
  "terms": { "orthopnea": ["Orthopnea", "Trouble breathing when lying flat that improves when sitting up."] },
  "questions": [
    { "id": "Q1", "type": "single", "topic": "...", "cj": "Analyze cues", "need": "Physiological Adaptation", "diff": 5,
      "stem": "...", "ask": "...",
      "options": [ { "t": "...", "ok": true, "why": "..." }, { "t": "...", "why": "..." } ],
      "rationale": "...", "takeaway": "...", "terms": ["orthopnea"], "src": "Ch 26 slide 22; transcript lines 796-798" }
  ]
}
```

- A question may carry its own `wk` (week label); otherwise it takes the week of its set. This is how a mixed set such as "Weeks 1-3" still counts each question toward its own week.
- `cj` is the NCLEX clinical judgment step, `need` the NCLEX client need, `diff` a difficulty of 3 to 5, `src` the citation to the week's slides or transcript.
- **Exam sets:** a file with `"kind": "exam"` next to its `title` is an exam set, its folder's exam bank: questions she has not seen in practice, on the same topics in a different format and wording. They are asked only on exams; they are never listed for practice, never enter Review, and do not count toward the course's progress. Each exam question may name the practice question it is the exam twin of in `"twinOf": "Q3"`: the `id` of a practice question in the same folder. A name that matches no practice question of that folder, or more than one, links to no twin. Without `kind`, a file is a practice set, as before.

#### Tables and images

Any question may also carry a table of readings under its stem and up to 4 images, for vital signs, labs, a rhythm strip, or a diagram. Both are optional. Every screen that shows the question draws them: practice, exam, Review, the set and exam results, and the owner's frozen view.

```json
{ "id": "Q7", "type": "priority", "stem": "...", "ask": "...",
  "table": {
    "caption": "PACU readings",
    "head": ["Time", "SpO₂", "RR", "HR"],
    "rows": [["0900", "97%", "16", "82"], ["0915", "93%", "22", "94"], ["0930", "89%", "26", "108"]]
  },
  "images": [
    { "src": "data:image/png;base64,iVBORw0KGgo...", "alt": "Chest tube drainage system with three chambers", "caption": "Water seal chamber" },
    { "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 200 80\">...</svg>", "alt": "Oxygen before reassessment", "at": "rationale" }
  ],
  "options": [ ... ], "rationale": "...", "takeaway": "..." }
```

- `table`: `rows` is a list of rows, each a list of cell texts (numbers are fine). `head` (the header row) and `caption` are optional. A short row is padded with empty cells. On a phone, a wide table scrolls sideways inside its box.
- `images`: each image needs `alt`, a short description of what it shows, and exactly one of `src` or `svg`:
  - `src` is the image itself as a base64 data URL: PNG, JPEG, WebP, or SVG (`data:image/png;base64,...`). Links to images elsewhere are not accepted; the image travels inside the file.
  - `svg` is SVG markup as text, for a diagram an AI chat draws. It may not contain scripts, event handlers, `<foreignObject>`, or links to other files.
  - Each image is at most 300 KB.
  - `at` is where it shows: `"stem"` (the default, under the stem and any table) or `"rationale"` (with the rationale, after she checks her answer). `caption` is optional.
- She can tap an image to see it full screen.

### Import rules

**Errors (block the import), same wording as the runner:**

- Not valid JSON (a fenced code block around it is tolerated). A bare list of questions is accepted as a set titled "Imported questions".
- No non-empty `questions` list.
- A question that is not an object, or has an unknown `type`.
- Missing `stem`, `ask`, `rationale`, or `takeaway`.
- `single` and `priority`: at least 3 options, every option has text `t`, exactly one option with `"ok": true`.
- `sata` (select all): at least 3 options with text, at least one option with `"ok": true`. Every option may be correct.
- `order`: 3 or more items with text, listed in the correct order.
- `match`: 2 or more pairs, each with `l` and `r`.
- `matrix`: 2 or more columns, at least one row, and every row's `ans` names a column.
- `matrixmulti`: 2 or more columns with different names, at least one row, every row's `ans` a list of those column names (each once, and at least one), and not every box right. A warning, not a refusal, when the ask does not say a row can fit more than one column.
- `highlight`: 3 or more segments, some `ok` and some not.
- `cloze` (drop-down): one `{0}`, `{1}`, ... placeholder per blank, and every blank has 2 or more `opts` and a valid `ans` index.
- `table`, when present: a `rows` list of rows, each a list of cell texts; `head`, when present, a list of cell texts; `caption`, when present, text.
- `images`, when present: a list of at most 4, each with `alt` and one of `src` (a base64 PNG, JPEG, WebP, or SVG data URL of at most 300 KB whose bytes match its type) or `svg` (SVG markup of at most 300 KB with no scripts, event handlers, or links to other files), and an `at` of `"stem"` or `"rationale"` if set.
- `kind`, when present: `"practice"` or `"exam"`. `twinOf`, when present: the id of a practice question.

Each error names the question by position and id, for example `Question 4 (X04): missing takeaway` or `Question 7 (Q7): image 1 needs "alt": a short description of what it shows`.

**Warnings (import anyway):** a term used by a question but not defined in `terms` (it is skipped); a missing `cj`, `need`, `diff`, or `src`; a `twinOf` in a practice set (only exam sets read it).

The whole question body is stored as JSON, so a format the runner gains later needs no schema change. Tables and images are stored in that body too, images included as their data URLs, so they are in every backup and come back with a restored set.

### The two existing banks

The two banks built before the app (NURS 402 Fundamentals, 146 questions, and NURS 406 Mental Health, 86 questions, from her first semester) are exported once from their build kits into this JSON, one file per practice set, and imported all at once by the owner's `import-sets` command into her user account. The command runs each file through the same importer as the Import screen, so the importer has exactly one input format.

## Screens and flows

The clickable wireframes from the planning phase are the reference for every state below, especially Import, replace and restore, and the exam draw by folder. For the course, exam page, and folder screens, the reference is the "C, files style" board from the folders design. Screens are listed in the order she meets them.

### Sign in

- Email and password, "Forgot password?", and "Sign up".
- **Forgot password?** explains that the owner resets it from his admin account. The app sends no email.
- **Staying signed in:** the app stays signed in on each device until she signs out.
- **Where she lands:** the course she used last. Home is one tap back.

### Sign up

- Email and password. She lands on Home, signed in.
- **Only emails on the owner's sign-up list** can sign up, one account per email. Any other email, or one that already has an account, gets the same plain message: "This email can't sign up here. If you already have an account, sign in. Otherwise, ask the owner to add your email." The message does not tell a stranger which emails are on the list.
- Five refused tries for one email lock that email's sign-up for 15 minutes, like sign-in.
- Every account made here is a user account. The stored role value is still `student`. The app sends no email, so there is no verification email.

### Home

- Semesters as groups; each lists its courses. The numbers are 1, 2, and 3, and they belong to her account. Once the server has answered, an account with no semesters sees none. Until the list loads, Home says "Loading your courses." and lists nothing. When the list cannot be loaded, Home says so, in the server's sentence or "Could not load your courses.", with **Try again**, and tries again by itself when the device is back online; it never shows empty semesters in place of courses it could not read, and the sidebar lists none. Once the courses are on screen, a later read that fails leaves them there.
- **Study topics**, after the semesters: the same cards, called by the topic's name (see [Study topics](#study-topics)).
- **+**, at the right of the title, is the one place Home adds anything. Its menu, **Add**: **New course in Semester N** for each semester she is in (not archived), which asks for a course code and name and then opens the course, empty; **New study topic**, which asks for a name and then opens the topic; and **Add Semester N** for the lowest of 1, 2 and 3 she does not have yet, shown only while one is missing. No group header has a New.
- A course card shows its question count, folder count, "N to review", and a progress bar. A topic card is the same, without a code.
- **A card's menu:** each course and topic card has a **…** at its top right (always shown on a touch screen; on a Mac when the pointer is on the card or it has focus), and a right-click on the card opens the same menu: **Open**; **Rename** (a course's code and name, or a topic's name; its folders, sets, and progress stay); **Move to Semester N** for each other semester she is in (a course); **Move up** and **Move down** among her topics in use (a topic); and **Archive**, which asks nothing. An archived card goes to Archived, and a card at the bottom of the screen says so ("Archived NURS 220. It is in Archived at the bottom of Home.") with **Undo**; a move says so with Undo too. In Archived, a course or topic she archived has **Unarchive** in place of Archive; a course in an archived semester has neither, and moving it to a semester she is in brings it back. **Delete**, last and in red, is on every card, archived ones included: it asks once, in the server's words ("Delete NURS 220 and its 146 questions?", then "You can bring it back for 30 days."), with **Delete** and **Cancel**, and takes the course or topic with everything in it off Home and the sidebar (see [Delete and Undo](#delete-and-undo)).
- An empty semester says: "No courses yet. Tap + to add one, or import its first question file." An empty Study topics group says: "A topic is a place for questions that are not a course: a certification, a language, your own notes."
- **Archived**, after the groups and closed until she opens it, only when a semester, course, or topic is archived. The sidebar does not list archived items.
- **Recently deleted**, last on the page: once she has deleted a course or topic, a row ("2 items · Undo for 30 days") opens Home's Recently deleted (see [Delete and Undo](#delete-and-undo)).
- Navigation: Home, Import, Settings (bottom tabs on iPhone, sidebar on iPad and Mac; see [Platforms and layouts](#platforms-and-layouts)). The owner also reaches Admin (see [The owner's admin account](#the-owners-admin-account)).

### Course

Laid out like the iPhone's Files app: two inset lists, one row per item, each opening its own screen. A topic uses this same screen; the words that differ are in [Study topics](#study-topics). A course's screen is unchanged.

- Three tiles: **Exam**, **N to review**, **N terms**.
- **+**, at the right of the title, adds into the course. Its menu, **Add to NURS 310**: **Import a question file** opens Import with the course picked and Unsorted picked; **Make questions** (only for an account that may make questions now) opens Make questions with the course picked; **New folder** asks for a name and puts the folder at the end of the Folders list; **New page** opens the page editor and then the new page. A course with nothing in it yet says: "This course has no question sets yet. Tap + to import a question file."
- **Pages:** one row per page (for example "Exam 2", "5 folders · 217 questions") with how far she is over its folders, and its badge as a small tag beside its name ("Exam"), or no tag when it has none. With none: "No pages yet. Tap + to make Page 1."
- **Folders:** the course's folders that are on no exam page, in her order; a deleted exam page's folders come last, in its order, until Undo puts them back on it. A row shows the folder, its set count, and how far she is ("2 sets · 22 of 27 answered", "Done", or "Not started"); a folder with only an exam bank says "Exam twins only · 14 questions".
- **Edit** (with two or more folders) puts up and down buttons and a grip on each row; she drags a folder by its grip, or moves it a row at a time, and the order is saved at once and kept on every device. Up and down are there because dragging alone is unreliable on touch screens and with VoiceOver.
- **Day one** looks like before: every week she had is a folder with the same name, sets, and progress, in the same order, and no folder is on an exam page. The change itself never moves, renames, or deletes anything; only she does.
- A set imported without a folder goes to **Unsorted**, made at the top of the Folders list the first time it is needed.
- **Recently deleted**, in the **…** after Rename, whether or not anything is deleted: opens it (see [Delete and Undo](#delete-and-undo)).

### Study topics

A study topic is a course with no semester, for questions that are not one of her program's courses. Home calls the group **Study topics**. Home's + names it **New study topic**, and the back link from the topic is **Topics**. The topic itself is called by its name. Courses and topics stay in separate groups. The screens inside are the course's screens, with the topic's own words, and a course's screen is unchanged.

- **On Home and in the sidebar:** after the semesters, the same cards. **New study topic** in Home's + asks for a name and then opens the topic. An empty name is refused ("Give the topic a name."). A name she already has, in any case, is refused, and her typing stays. The sidebar lists the same group and leaves archived topics out.
- **The topic** opens at `/course/{id}`, like a course. The title is the name. The note line has no code. The first list is **Pages**, as in a course. The topic's + has **New page**, which makes "Page 1". With none: "No pages yet. Tap + to make Page 1." The second list is **Folders**. The Exam, Review, and Terms tiles stay. Pages are one level; they do not nest.
- **A topic's page** is the course's page screen. **Start exam**, the timer, twins, badges, and past exams are the same button and the same path, and **Delete page** in its **…** deletes it as a course's page is deleted, into the topic's Recently deleted under **Pages**. The header reads the page's name. Under the note, a page with a primer shows one row, **Open the primer**, with the link's host, and the row opens the link in a new tab. The editor's **Primer link** field takes an http or https address of at most 2,000 characters. Anything else stays in the sheet with the server's sentence ("A link has to be a web address, such as https://example.com/primer."). Clearing the field takes the row off. A course's page has no primer field. The primer is not stored in the app.
- **Folders** follow the course's rules. A set imported with no folder goes to **Unsorted**, made the first time it is needed.
- **Import** can file into a topic, or into a new one: **New topic** asks only for a name. The done line and the replace warning name the topic by its name.
- **Make questions** files a job into a topic the same way it files one into a course, by that topic's id, into a folder she names or into Unsorted. The job does not create the topic; Import's **New topic** does.
- **Her topics are arranged on Home:** a topic card's menu renames it, moves it up or down among the ones in use, archives or unarchives it, and deletes it, with 30 days to bring it back from Home's Recently deleted (see [Home](#home)). The order sent to the server names every topic, archived ones after the others. A semester is archived by hand from **Settings › Semesters**. Nothing is archived because a date passed.
- **Archived** on Home is a closed group near the bottom, above Recently deleted. Opening it shows archived semesters, with their courses, and archived topics under Study topics.
- **Who sees it:** the account that owns it, and the admin, frozen, while he is looking at that account. There is no sharing. A shared bank of general questions is a possible later choice, not built. Anki cards are not imported. Review stays the missed-and-guessed list; there is no review schedule.
- **What already existed** kept its id, its name, and its place. Giving each semester and course an owner did not delete, move, or rename a course, folder, set, question, attempt, or progress row. A second account sees none of that material.

### Exam page

- A course's and a topic's pages are one kind of page, listed under **Pages**; a topic's page also has a primer link (see [Study topics](#study-topics)). A page can carry one badge, Exam, Concept, or Study, that says what it is for, or none. Her course pages from before badges have Exam, and a topic's have none. The exam itself is the same whatever the badge.
- The course code goes back to the course. Under the title: "5 folders · 16 practice sets · 217 questions".
- **Start exam** opens Exam setup with the page's folders ticked and the page named ("Exam 2 · 5 folders ticked for you"); she can still change them. Under it, what the exam would draw ("40 questions from the 217 in these 5 folders, or wrong questions only."). When a folder on the page has exam twins, one line under that names them ("Exam twins: 14 in Week 5. Exams draw from these first.", or "Exam twins: 41 in Week 4, Week 5 and Week 6. Exams draw from these first." when several do). It is absent when none do.
- **+**, at the right of the title, adds into the page. Its menu, **Add to Exam 2**: **Import a question file here** opens Import with the course picked and this page's folders listed first (Unsorted stays picked until she picks a folder); **New folder on this page** asks for a name and makes the folder on the page in one step; **Add existing folders** opens the exam page editor.
- **…** (More), just left of +, has **Edit page**, which opens the exam page editor in one step.
- **Delete page**, red and last in the page's **…**, after a line: deletes the page alone after the server's warning, with 30 days of Undo (see [Delete and Undo](#delete-and-undo)): its folders stay in the course, at the end of its Folders list, with their sets and her progress, and her past exams over it stay in Exam setup.
- **Study material:** the page's folders, in her order, as rows that open the folder. **Edit** reorders them as on the course page and shows **Name and folders**, the exam page editor.
- **Past exams:** every finished exam whose folders are all on this page, with its score, including ones taken before the page existed. **Edit** puts **Delete** on each (see [Delete and Undo](#delete-and-undo)).
- An empty page says so, with **Add folders**.
- **Page editor** (a sheet, a centred dialog on iPad and Mac), titled **New page** or **Edit page**: the page's name, the course's folders as chips she taps to put a folder on the page or take it off, and a live line ("3 folders · 83 questions"). A folder is on one page at most: a chip another page holds is greyed and names that page. A page already made has **Badge**: Exam, Concept, Study, or None, with one hint line, "Says what the page is for". Making a page asks for no badge, and a new page has none. **Done** saves; when the server refuses (for example "Week 6 is in Exam 2." after a change on another device), the sheet stays open with the message and her edits. **Cancel** changes nothing.
- Two folders may have the same name on different exam pages, never in the same list. Where a folder's name shows outside its list and another folder shares it (Review, Terms), it reads "First Pass · Exam 3".

### Folder

- Goes back to its exam page, or to the course. Under the title: "On Exam 2 · 3 sets · 36 of 45 fully right".
- **Rename**, in the **…** (More) at the right of the title: only the name changes; its sets, their progress, its exam page, and her past exams stay with it. A name another folder of the same list has is refused.
- **Change page**, in the **…**, its second line saying where the folder is ("On Exam 2"): a sheet to put the folder on a page, on none, or on a new one ("New page", named "Page 2").
- **Delete folder**, red and last in the **…**, after a line: deletes the folder and every set in it, after a warning that names them (see [Delete and Undo](#delete-and-undo)).
- **+**, right of the **…**: opens Import with this course and folder picked. No menu, while there is one way to add.
- A folder with no sets says "No sets yet. Import a question file here, or move sets here from another folder." and has an **Import here** button under it, which opens the same place as +.
- **Sets:** each set row shows its status: "7 of 12 answered · Continue" for a set she left midway, "Done Sep 24 · 13 of 17 fully right", "7 of 12 answered" after she chose Start over, or "Imported today", and "Imported by your agent" under it when her agent imported it with its key. Tapping a set opens it in the practice runner, which goes back to the folder.
- **Select** puts a check circle on each set; a bar at the bottom then offers **Delete** and **Move N sets**, which opens **Move to**: the course's folders grouped by exam page, the current one marked "Here now", or a **New folder**. A set moves with every older version of it, and her answers and progress move with it.
- A set that was replaced by a re-import shows a **Restore** button; Restore asks before bringing the previous version back.
- A folder with an exam bank says so in one line under its sets: "Exam twins: 14 questions, exams only". Exam sets are not listed.

### Delete and Undo

Courses, study topics, exam and study pages, sets, folders, and past exams can be deleted, and each comes back with Undo for 30 days. Nothing is ever deleted except by her confirmed Delete. Deleting her whole user account, in [Settings](#settings), is the one delete with no Undo.

- **What she can delete:** a course or study topic with everything in it (**Delete** in its card's menu on Home), a practice set (Select on its folder, then **Delete**; several at once), a folder with every set in it (**Delete folder**, last in its **…**), a page alone, with nothing in it deleted (**Delete page**, last in its **…**), and a past exam (**Edit** on Exam setup's Past exams or an exam page's Past exams, then **Delete** on its row).
- **The warning** comes from the server, in its words: the question is the title ("Delete Week 4?", or for a course "Delete NURS 220 and its 146 questions?" with "You can bring it back for 30 days." under it), and the rest says everything that goes with it: a folder's sets by name and their questions ("Its 3 sets go with it: Anxiety disorders, Anxiolytics and Panic and phobias, 15 questions in all."), her answers that stop counting and the questions that leave her Review list, the exam page the folder comes off, her past exams that stay, and "You can undo this for 30 days." A past exam's warning says how her answers, Review list, and Wrong questions change. An exam page's warning says what stays: "Delete Exam 2?" with "Its 2 folders stay, with their sets and your progress, under Folders: Week 3 and Week 4. Your 1 past exam over it stays. You can undo this for 30 days." Several sets show each set's warning under "Delete 2 sets?". **Delete** and **Cancel**; Cancel changes nothing.
- **Exactly what she read goes.** The delete sends back the warning's confirmation; if what goes changed since (another device filed a set into the folder), it is refused with the server's sentence ("Week 4 changed since you were warned. Look again before deleting it."), the new warning shows, and she confirms again.
- **A refusal** shows its sentence in place of Delete, with **OK**: "An exam in progress asks questions from Week 5. Finish or leave that exam first.", "An exam in NURS 220 is still going. Finish or leave that exam first.", a QBank job still using a set or working in the course, or, for an exam page, a folder in the Folders list with the name of one of its folders, which would show beside it there ("NURS 310 already has a folder named Week 3 in its Folders list. Rename one of them before deleting Exam 2.").
- **Undo, right away:** after a delete, a card at the bottom of the screen says what went ("Deleted Week 4 and its 3 sets.") with **Undo**, for a few seconds and while she points at it; then "Brought back Week 4 and its 3 sets.", or the server's sentence when Undo is refused. A deleted folder's screen goes back to its exam page or the course, and a deleted exam page's screen goes back to the course ("Deleted Exam 2.", then "Brought back Exam 2.").
- **Recently deleted** (one per course, from the **…** on the course page): the pages she deleted, with the folders Undo puts back on them ("Week 3, Week 4 · Deleted today", or "No folders"); the folders she deleted, with the sets that went with them; the sets she deleted on their own; and her deleted past exams, newest first, each with **Undo** until its 30 days run out. When Undo would be refused now, the row says why ("Its folder Week 4 is deleted. Bring the folder back first.", or for an exam page whose name another page has now, "This course already has a page named Exam 2. Rename one of them, then bring this one back.") and Undo is off. After 30 days an item stays deleted and is no longer listed.
- **Home's Recently deleted** (from its last row on Home): the courses and study topics she deleted, under Courses and Study topics, newest first, each with its semester, its questions, when it was deleted, and **Undo** until its 30 days run out. Undo brings it back whole, in its semester or her topics: its folders, exam or study pages, sets, past exams, and her answers counting again. When a course of its code is in its semester now, or a topic of its name, the row says so ("Semester 1 already has a course with the code NURS 220. Rename one of them, then bring this one back.") and Undo is off.
- **What a delete changes:** a deleted course or topic leaves Home, the sidebar, Import, and what an agent reads, with everything in it, and its code or name is free for a new one meanwhile. A deleted set or folder is hidden everywhere (its folder, Review, exams, the course's counts); her answers to it stay saved and stop counting until Undo. A deleted past exam stops counting: her progress, Review list, and Wrong questions are as if she had not taken it. A deleted page leaves the course's Pages and Exam setup, and its name is free for a new page; nothing else is deleted or moved: its folders show on no page, at the end of the Folders list, with their sets and her answers counting, and she can study, rename, move, or delete them meanwhile, and her past exams over it stay in Exam setup. Undo brings each back exactly as it was: a folder onto its exam page if that page is still there, and an exam page in its place with the folders still on no other page back on it, in its order, and her past exams on it again.

### Practice (the runner)

- One question at a time: stem, ask, the answer area for its format, and an "I'm guessing (flag for review)" checkbox.
- Options, order items, match choices, and drop-down choices are shuffled on every attempt; the layout she saw is saved with the attempt.
- **Strike out.** On a single answer, priority, or select-all question, each choice shows a letter, A, B, C in the order she sees them, and a strike-out control ("Strike out B"; a right-click on the web does the same). A struck choice shows its letter and text crossed out and dimmed, is unpicked if she had picked it, and cannot be picked until she restores it with the same control ("Restore B"). Strikes stay with each question while she moves through the set and are gone when it ends. They stay on her device: never sent, saved, or scored, and never part of Review or progress. Once she checks the answer, the marks show as without strikes.
- **Highlight.** The user can mark any words of the question: the stem, the table's caption and cells, the ask, and the text of the answers in every format (choices, ordering items, matching and matrix rows, the drop-down sentence). Pictures, the passage of a Highlight question (tapping its phrases is the answer), the rationale, and the takeaway cannot be marked. With a mouse she presses, drags across the words, and lets go; on a touch screen she touches and holds a word first, then drags and lifts, so a quick swipe still scrolls. A tap or click on a mark erases it. On an answer, a drag marks and does not pick, and a plain tap or click still picks; touch and hold on an answer belongs to highlighting, and the X still strikes. Marks come in three colors, yellow, blue and pink. A pen button at the end of the format line shows the current color and opens the colors beside it, with **Clear** ("Clear highlights") when the question has a mark; the pen keeps its last color on the device, and on the web keys 1, 2 and 3 switch it too. Dragging over a mark with another color repaints what it covers. A struck-out answer's marks dim with it. Until she first highlights on a device, a line under the format line says how. Marks are per question for the sitting only, as strikes are: they stay on her device, are never sent, saved, or scored, and are gone when the set ends, when she starts over, or when the page reloads. Unlike strikes, they stay after Check answer until the set ends. Results show each question clean.
- **Color in questions.** Color shows a question's structure and answer states, never a reading's meaning: a table's header band and caption are teal and its first column is semibold, a matrix grid's header band takes the accent, and an open choice's letter sits on a pale accent disc. Once checked, the choice she picked shows a filled check or cross. The progress strip has a step per question: in practice each checked question leaves its result (fully right, partly right, missed) in the chart colors, and an exam shows only answered and skipped. Results open with a bar split into fully right, partly right, and missed (and not answered, for an exam), a tile per count with a dot in its color, and a meter on each breakdown row. Color never marks a table reading as abnormal: spotting that is often the question.
- "Check answer" shows feedback at once: Correct / Partly correct / Not correct with points for multi-part formats, the reason for every option, the rationale, the key takeaway, and "Terms in this question" with plain definitions. While the answer is on its way to the server, on a slow connection or under "No connection. Your answer is saved as soon as you are back online.", it stays as it was sent: the picks, the strikes, and the guess box do not change, and Start over waits. The score is always shown over the answer the server saved.
- A set ends on a results screen: points, fully-right count, time used, a breakdown by clinical judgment step, and each question with its mark.
- **Picking up where she left off.** A set remembers her sitting on the server, so the web and the iPhone agree. Opened again from anywhere (a reload, a new tab, the row, her other device), a set she left midway opens at the first question she has not answered, with "Picked up at 8 · 7 answered earlier" and **Start over** under the title, or "Picked up at 8 · last answered Oct 20" if she last answered on another day. The bar counts the earlier answers. A question she already answered out of order is skipped. The results count the whole sitting and leave out the time used, since one opening's clock says nothing about a sitting that took several. A Done set opens fresh at question 1, and answering it again is a retake with its own sitting. Review and exams have no sitting: Review's answers say they came from Review, so they do not read as beginning a set again.
- **Start over** asks once: "Start over Shock and perfusion? Your 7 answers stay saved and still count. The set begins again at question 1." No answer, score, or Review row changes. The row goes back to "7 of 12 answered" until she answers question 1 again, which begins a new sitting.
- **A finished set opened again** starts at question 1 with a plain notice above it: "You've answered this set before. Answering now starts a new practice run." It is information only, has nothing to tap, and does not block answering. It shows on the web only at question 1 of a set whose row says Done, never in Review, on results, or for a new or half-done set. The iPhone gets the same notice in separate work.

### Terms

- One list per course: every term defined in the course's practice sets, with its plain meaning. Exam sets' terms show only with their questions.
- **Same term, two definitions:** when two sets in the course define a term differently, the list shows the definition from the most recently imported set.
- Each question's feedback shows the definitions from its own set.

### Review

- Per course only (no cross-course Review).
- Filter chips with counts: **All / Missed / Partly right / Guessed**.
- "Practice these N (shuffled)" runs the filtered list in the runner.
- One row per question: topic, folder, format, status, and where it happened (which set or which exam, with the date). Tapping a row practices that one question.
- A question enters Review when her latest answer is not fully right, or is flagged "I'm guessing".
- A question leaves Review the next time she answers it fully right without "I'm guessing", or when she clears the list.
- Exam-bank questions never enter Review; the ones she gets wrong come back in a wrong-questions exam instead.
- **Clear the review list:** one button per course empties that course's Review list. It asks first, "Clear all N questions from this course's Review list?", with **Clear** and **Cancel**; Cancel changes nothing. Her answers and scores are kept; only the list is emptied.

### Exam setup

- **Folders this exam covers:** a checkbox per folder with a question, grouped by exam page and then the folders on no exam page, each with its question count. From the Exam tile nothing is ticked; from an exam page's Start exam that page's folders arrive ticked, with a line naming it ("Exam 2 · 5 folders ticked for you"), and she can still change them.
- A live summary: how many questions, how many from each ticked folder, and the time.
- **Length:** 40 questions in 60 minutes. When the ticked folders hold fewer than 40, the exam is all of them at 1.5 minutes each (for example 22 questions in 33 minutes).
- **Draw:** only from the sets in the ticked folders, in proportion to each folder's size, so every folder stays represented (for example Weeks 1 to 3 holding 22, 27, and 37 questions give 10 + 13 + 17 = 40).
- **Exam bank first:** a folder with an exam bank draws only its exam questions. A folder without one draws its practice questions; once the course has an exam bank, the exam says so ("Week 3 has no exam bank yet, so it uses its practice questions").
- **Wrong questions only:** a switch above the folders. With it on, each folder shows how many of its questions she got wrong ("7 wrong of 20") and the exam draws only those, with the same length rule and proportions. Wrong means her last answer was not fully right; a question leaves the pool as soon as she answers it fully right. In a folder with an exam bank, the pool is the exam twins of her wrong practice questions plus the exam questions she got wrong, until she answers that exam question fully right. A folder with no wrong questions cannot be ticked, and the server refuses it by name.
- **Twin (exam twins):** shown only to an account that may make questions now (`GET /api/question-maker` answers `available: true`; today only hers). Under Start exam, **Write exam twins** sends the same course, ticked folders, and pool to QBank, which writes a new exam twin of each of those practice questions (one already twinned keeps its twin), files them as exam sets beside their practice sets, and never changes her questions, sets, folder names, or answers. A refusal shows as the server's sentence ("Week 5 has no wrong questions, so there is nothing to twin.") until she changes the folders or pool. Its page, **Exam twins**, shows the job's note, its three steps (Read your questions, Exam twins, File the twins) with how far each is, **Stop** (it asks first), a failure's reason, and the sets it filed; once done, **Start exam on the twins** starts the exam the job names. A twin job counts once against her daily limit.
- **Exam twins:** her twin jobs over the course, newest first, with their folders, date, count, pool, and state (Writing, Ready, Failed, Cancelled); each opens its page.
- **Start exam never ends a running exam unasked.** Start stays off until the app has read whether an exam of hers is running; on the twin page a read that fails says "Could not check for an exam in progress. Trying again." With one running, Start asks "Start a new exam?" first. The request names the exam she agreed to end (`replaces`), or none, so when an exam was started on another device since the screen last looked, the server refuses and the same question comes up for that exam instead of an error.
- A list of past exams with their scores, marked "Wrong questions only" when they were. **Edit** puts **Delete** on each (see [Delete and Undo](#delete-and-undo)).

### Exam

- The runner's timed mode: a countdown, "Submit and continue", "Skip for now", and feedback only at the end.
- Strike out works as in practice. A skipped question keeps its strikes when she comes back to it, and they are gone when the exam ends.
- Highlighting works as in practice. A skipped question keeps its marks when she comes back to it, and they are gone when the exam ends; the exam result shows each question clean.
- At the last question with skipped ones left, she is taken back to the first skipped one and told how many remain; "Finish exam" again ends it.
- When time runs out, the exam ends automatically.
- **Ending is confirmed by the server.** Once the last answer is in, or she taps Finish exam or End exam, or time runs out, the question gives way to "Every question is answered." (or how many are), and the exam ends when the server says so. When it cannot be reached, it says "No connection. The exam ends as soon as you are back online." and tries again by itself, waiting longer each time; a refusal shows the server's sentence. Either way one button, **Finish exam** (or **End exam** when she was leaving), asks again. Nothing else can change her answers meanwhile. Opened again with every question answered (a reload, her other device), the exam asks to finish at once instead of opening on question 1.
- **Leaving midway ends the exam** (after a confirming second tap, as the runner does): what she answered is scored, the exam goes into her history, and the misses and guesses among what she answered go to Review.
- **Unanswered questions stay out of Review:** when an exam ends early (left or timed out), the questions she skipped or never reached score 0 and are listed on the exam result, but they do not go to Review.

### Exam result

- Fully right, points, minutes used, partly right, missed, guessed.
- A by-folder breakdown (for example 7 of 10, 11 of 13, 13 of 17) and a by-clinical-judgment-step breakdown.
- Each question with its mark ("Not answered" for ones she skipped or never reached) and an expandable answer and explanation.
- "Open Review · N from this exam" for the practice questions she missed or guessed. Exam-bank questions she got wrong are counted on their own line: they stay out of Review and come back with Wrong questions only.

### Import

- Paste the JSON or choose the file.
- Course: an existing course, an existing study topic (under **Study topics**, once she has one), **New course** (code, name, semester), or **New topic** (a name only: no code, no semester). With no topics yet, the menu is her courses, as before, plus those two new choices. Until her courses are loaded, the Course field says "Loading your courses" in place of the menu, and when they cannot be loaded it says so with **Try again**; Import waits for the menu, so a course that is not known yet is never offered as a new one. Make questions' Course field does the same. A set with no folder goes to **Unsorted** in a topic the same way it does in a course. The done line and the replace warning name a topic by its name.
- Folder: **Unsorted**, picked every time unless she picks another; her folders, grouped by exam page; or **New folder** with a name. **Import here** on a folder arrives with that folder picked. A course's or exam page's + arrives with the course picked, and from an exam page that page's folders are listed first.
- Set name: filled from the file's `title`, editable.
- **Check file:** shows "Ready: N questions, M terms" with the format breakdown, or the errors with a **"Copy these for your agent"** button, plus any warnings. An exam set says so: its questions are asked only on exams over its folder.
- **Replace warning:** if the set name matches an existing set of the same kind (practice or exam), it asks first, naming the course, the folder the set is in (a replaced set stays in its folder, whatever folder she picked), and how many questions would be replaced. Choices: **Replace**, **Import as a separate set**, **Cancel**. Cancel changes nothing.
- **Replace keeps what it can:** answers on questions that did not change are kept, and the replaced version is kept and restorable from its folder with one tap.
- **Done:** "Imported" or "Replaced", naming the folder and its exam page, with **Open** the folder and **Import another file**, which keeps the course and goes back to Unsorted.

### Settings

- Account; change password. A new password signs out every other device; this one stays signed in.
- **Connect an agent**, under Change password: opens a screen where she enters the short code her agent shows (or confirms one her agent sent in the link), sees the agent's name and what it asks to do in plain words (manage marked "Most access"), and taps **Approve** or **Deny**. A code that is mistyped, answered already, or past its 10 minutes says so. **Your keys** lists each key's name, when it was made, when it was last used, and what it can do, with **Revoke**, which asks first. A revoked key stays listed and never works again; what it imported or changed stays, and what it deleted stays in Recently deleted. No key is ever shown or copied.
- **Semesters:** each semester's name, start and end dates, and archive or unarchive it by hand. Nothing archives a semester because its end date has passed. Settings adds nothing: a semester, course, or topic is added with Home's + (or Import), and renamed, moved, or archived from its card's menu on Home.
- **Look:** Match device / Light / Dark, per device.
- **Color:** Dusk / Slate, saved to the account so it follows it to every device. Every account starts on Dusk.
- Sign out. The next account to sign in on that device sees nothing of hers, not even for a moment. The sign-in screen shows only once the server has ended the session. If the request fails (no connection, or the server refuses), nothing ends: the account stays signed in, and a sentence under the button says so ("Signing out did not work. Try again.", or the server's words), so the screen never says signed out while the session is still good.
- **Sign out everywhere**, under Sign out: it asks "Sign out of QBank on every device, including this one?", and **Sign out everywhere** ends every session of the account at once, this one included, so every browser and the iPhone app are at sign-in the next time they open QBank. This device is on the sign-in screen and keeps nothing of the account, as after Sign out. Cancel changes nothing. Agent keys are not sessions, so they keep working; Revoke in Connect an agent stops one. A refusal ends nothing and keeps her signed in, in the server's words, shown under the button as for Sign out. The iPhone app's Settings > Sign out everywhere works the same way.
- **Delete account**, in red under Sign out, for a user account only (the admin account has none, and the server refuses it): a sheet asks "Delete your user account?" and says in plain words that the account, by its email, and everything in it are deleted for good: her courses and study topics, their sets, her answers, progress and past exams, and her passkeys and agent keys. She is signed out on every device, nothing goes to Recently deleted, and there is no Undo. She enters her current password and taps **Delete account**; Cancel changes nothing. It always deletes the account signed in: nothing she sends names another. Once deleted, she is on the sign-in screen and the device keeps nothing of the account, as after Sign out. A refusal deletes nothing and keeps her signed in, in the server's words: a wrong password ("That password is not right."), a Make questions or twin job still running in one of her courses, or after five wrong passwords here or at sign-in, which lock both for 15 minutes, a lock that keeps Delete account off until it ends. A temporary password leads to choosing a new one first. If her session had already ended (the account deleted or its password reset on another device), she is signed out. The iPhone app's Settings > Delete account works the same way.

### The owner's admin account

He signs in the same way, with his own login, and lands on the Home of the user account he is looking at. On the frozen screens his navigation is the user's: Home, Import, and Settings. On Admin and Settings, which are his own, and when there is no account to view, it adds Admin. He sees that account only.

- **The frozen view:** Home, a course or topic, its pages and folders, Review, Exam setup, Terms, Recently deleted, Import, and the practice and exam runners look as they do for that user, in that user's words. Rows that open for the user open here too, reading only: a set opens in the practice runner, a past exam its result, a running exam its runner. Each control that would change something, such as +, Rename, Edit, Select, Delete, Undo, Restore, Check answer, Start exam, End exam, and Import, answers with one short note and sends nothing: "This is a frozen view of sam@example.com. Nothing here can be changed." The iPhone says the same. If a refusal still comes back from the server (403 `admin_read_only`), it says the same note.
- **What stays local in that view:** picking a choice, ticking folders on Exam setup with its plan, Skip for now, and Check file on Import write nothing, so they work. Time running out on an exam does not end it: only that user's app does.
- **Whose account is on screen:** one thin line at the very top names the account, in a band of its own, so the screens under it lay out as the user's do, and its **Accounts** is how he gets to Admin. Home in the navigation goes back to the frozen Home. Admin and Settings are his own and have no line, and neither does a session with no account to view.
- **Admin > User accounts:** the home control page: each user account he may view, with its email, name, and when it was made, and a **Viewing** mark on the one he is looking at. Opening one shows its frozen Home. The temporary password and Repair act on the one marked Viewing. Until he picks, it is the oldest user account. Nobody else has this page.
- **Admin > temporary password:** reset that account's password by setting a temporary password he gives its user, who chooses their own at their next sign-in. There is no reset email.
- **Admin > Sign-up list:** add or remove the emails that may sign up, each with "Has an account" or "not signed up yet". Removing an email does not remove an account made with it.
- **Admin > Repair:** for when something breaks, not for normal use. It rebuilds that account's progress and Review list from its saved answers. Each repair says what it will change and asks first.
- **His Settings:** account, change password, Connect an agent (a key he approves reaches nothing, since an agent key reaches only its own account's content and the admin account has none), Look, Color, sign out, sign out everywhere. No Delete account: the admin account can't be deleted.

## Platforms and layouts

- **One installable web app** on iPhone, iPad, and Mac, running full-screen from the home screen or Dock, so it should feel native: no browser chrome, safe areas respected, touch targets sized for a thumb on iPhone and iPad, keyboard and pointer friendly on the Mac.
- **iPhone (the web app):** a single column with bottom tabs (Home, Import, Settings, plus Admin for the owner). The question runner fills the screen. The native iPhone app has no Admin screen and no sign-up list; those stay on this web Admin page (decision 22).
- **iPad and Mac:** their own layout with a **sidebar** (navigation and the semester, course, and study topic tree), fitted to their screens rather than a stretched iPhone layout. Archived semesters, courses, and topics are left out of the sidebar. The exact shape comes from the Claude Design system.
- **Light and dark mode:** both first-class. Settings offers Match device / Light / Dark, and Color picks Dusk or Slate, each with a light and a dark half; there is no other theme or palette choice. Correct, partly correct, and wrong states, and the timer's low-time state, read clearly in both modes and do not rely on color alone.

## Design direction

The look is generated in Claude Design from this PRD before the build's first screens; until then no colors or fonts are fixed. The app's display name and home-screen icon are chosen there too.

- **Tone: calm and focused.** A place to practice hard questions, not a game: no streaks, confetti, or badges.
- **Clear and clinical.** Long stems and rationales are comfortable to read on a phone; the hierarchy keeps the ask, the answer area, and the feedback easy to tell apart.
- **Encouraging but honest.** Scores and misses are stated plainly; Review feels like a to-do list, not a penalty.
- **Personal and private.** One account's own study tool, not a school portal or a product with marketing. Other accounts do not see it.
- **Plain language** in all copy.
- **Shared building blocks** the screens reuse: course card with progress bar, set row with status, tile, filter chip with count, folder checkbox row, inset list row with its progress word and chevron, answer option (unselected, selected, correct, wrong, missed), ordering row, matching and matrix controls, highlightable passage segments, drop-down blank, feedback banner (correct, partly correct, not correct), rationale and takeaway blocks, term definition, countdown timer with a low-time state, confirmation sheet, error and warning lists, empty states.

## Question formats and scoring

The app ports the existing runner's formats and scoring unchanged into the server's question package (`packages/questions` in D-E-A-G/qbank-server). The server scores every answer and returns the status and points it saved with the feedback text to show ("Partly correct", "2 of 3 points", and the format's scoring rule); no client scores an answer, so the web screens and a native app both show the server's result instead of re-implementing the rules.

| Type | Name in the app | She does | Points | Fully right when |
|---|---|---|---|---|
| `single` | Single answer | Picks one option | 1 | She picks the one correct option |
| `priority` | Priority / first action | Picks one option | 1 | She picks the one correct option |
| `sata` | Select all that apply | Ticks several options | +1 per correct pick, -1 per wrong pick, never below 0; max = number of correct options | Every correct option and no wrong one |
| `highlight` | Highlight | Taps segments of a passage | Same +1 / -1 rule as select-all | Every correct segment and no wrong one |
| `order` | Ordering | Puts items in order | 1 per item in the right position | Every item in the right position |
| `match` | Matching | Pairs each left item with a right item (with optional extra distractors) | 1 per correct pair | Every pair right |
| `matrix` | Matrix | Picks a column for each row | 1 per correct row | Every row right |
| `matrixmulti` | Matrix, check all that fit | Checks every column that fits each row; a row can fit more than one | +1 per correct box, -1 per wrong box, never below 0; max = number of right boxes | Every right box and no wrong one |
| `cloze` | Drop-down | Picks a choice in each blank | 1 per correct blank | Every blank right |

- **Status:** `correct` when points equal the maximum, `partial` when above 0 but below the maximum, `incorrect` at 0.
- **Guessing:** "I'm guessing" is saved with the attempt. A guessed answer stays in Review even when it was right.
- **Exam scoring:** points and fully-right counts over every question in the exam; an unanswered question earns 0.
- **Feedback text:** the multi-part banner explains the rule, for example "+1 for each correct choice, -1 for each wrong one" for select-all and highlight, "+1 for each correct box, -1 for each wrong one" for a matrix where a row can fit more than one column, and "items in the right position; full credit needs all of them" for ordering. Its points line is the same shape for every multi-part format, for example "5 of 8 points".

## Data the app stores

Postgres. Question bodies stay JSON because the nine formats have different shapes. Questions and answers both belong to one account. She imports the questions; the answers are hers. Ownership of the questions lives on the semester and the course. Folders, pages, sets, questions, and terms are that account's because their course is.

| Table | Holds |
|---|---|
| `user`, `session`, `account`, `verification` | Better Auth's tables. Each account has a role. A user account's role value is **student** (full access to her own studying). **admin** is the owner: he sees user accounts frozen, and keeps the sign-up list, password resets, and repairs; he changes nothing in an account from that view. The product calls the first a user account. The stored role value stays `student`. |
| `sign_up_email` | The emails the owner allows to sign up, with the date each was added. |
| `admin_student` | The user account the admin is looking at, when he has picked one. |
| `semester` | The owning account, number (1, 2, or 3, unique for that account), name, start and end dates, and the date she archived it by hand. The program is the app's name, not a table. |
| `course` | The owning account, kind (`course` or `topic`), semester (none for a topic), code ("NURS 101", empty for a topic), title, sort order, archived date. A topic is this row with no semester. Its name is unique among that account's topics, ignoring case. |
| `folder` | Course, her name for it, the exam page it is on (one at most), and its place in its list (an exam page's folders, or the course's Folders list). A name is unique within its list. |
| `practice_set` | Course, folder (every version of a set is in the same one), title, description, the week label it was imported with, sort order, imported at and by, a hash of the imported file, stats (counts by type, step, need, difficulty), and its kind: practice, or exam for its folder's exam bank. Replaced versions are kept so they can be restored. |
| `question` | Set, public id ("Q1"), position, type, topic, clinical judgment step, client need, difficulty, week, stem, ask, body (JSON: the type-specific fields with each option's reason, and any table and images), rationale, takeaway, term keys, source citation, and for an exam question the public id of its practice twin. |
| `term` | Set, key, term, plain meaning. The course's Terms list is built from these. |
| `course_exam` | A course's or a topic's pages ("Exam 1", "Page 1"): name, order, an optional primer link, and an optional badge (`exam`, `concept`, or `study`; none is null). The link is an http or https address, or empty. A course's exam page leaves it empty. Its folders are the ones that name it; a deleted page's folders keep naming it and read as on no page until Undo. A past exam belongs to the page holding every folder it was over. The older `course_exam_week` (an exam's weeks by label) was read once to put folders on their pages and is no longer written. |
| `study_session` | User, course, mode (practice, exam, or review), set (practice only), the question ids in the order served, the chosen folders, pool (all or wrong questions), the folders drawn from practice questions for lack of an exam bank, and the time limit (exam only), start and finish times, score. |
| `attempt` | A client-generated id (so a retry never double-counts), session, user, question, her response, the shuffle she saw, status, points, max points, guessed, answered at. |
| `question_progress` | Per user and question: attempts, correct attempts, last status, last guessed, last answered at, and whether it is in Review. Written in the same transaction as each attempt; Review is read from here. "Clear the review list" takes the course's questions out of Review without touching her attempts. |

- Her attempts are the only irreplaceable data. The question banks are files she already keeps (the skill's output).
- A delete hides rows and never removes one: a deleted course or topic, exam page, folder, set, or past exam keeps its rows, stamped with when it was deleted and which delete it was, and Undo clears that delete's stamps. Delete account is the exception: it removes every row of the account, for good.
- An agent key she approved to read can download her progress as JSON (`GET /api/me/export`). Settings has no export control.

## Stack and hosting

| Piece | Choice |
|---|---|
| Screens | React + TypeScript (Vite), installable web app (manifest and icons, no service worker in the first release); one client of the API, with types generated from its OpenAPI description. In D-E-A-G/qbank-web |
| API | Hono + TypeScript on Node, zod validation on every request; an OpenAPI description generated from the typed routes and published with the API. In D-E-A-G/qbank-server |
| Question package | Question types, scoring, exam planning, and import validation, used by the API. In D-E-A-G/qbank-server |
| Database | Postgres 16 in a Docker container on the app's own server, through Drizzle |
| Login | Better Auth: email + password; works for a native client as well as the browser. No email is sent. |
| Hosting | One self-managed DigitalOcean droplet declared in OpenTofu, running Caddy, the built screens, the API, and Postgres in Docker Compose (see [The server](#the-server)) |
| Deploy | Merging to `main` builds the web image and deploys it to the droplet; the API is deployed the same way from D-E-A-G/qbank-server (see [Deploy path](#deploy-path)) |
| Backups | DigitalOcean's weekly droplet backups, plus a nightly `pg_dump` off the box to a private Cloudflare R2 bucket, with a tested restore (see [Backups](#backups)) |
| Address | A subdomain of one root domain (one subdomain per app), DNS on Cloudflare, HTTPS through Caddy |
| Tests | Vitest for scoring, validation, and the screens; Playwright for flows, against the web image and the API image; GitHub Actions CI |
| Cost | About $14.40 a month: the $12 droplet plus $2.40 for weekly backups. R2 stays on its free tier. The domain, when bought, is about $10-15 a year. |

**API-first.** The API is the product boundary; the web app is one client of it, and a SwiftUI iOS app may be added later as a second client of the same API, accounts, and data.

- **Every rule lives behind the API:** scoring, question formats, import validation, Review behavior, and the admin's powers and limits are enforced by the server, never only inside the web screens.
- **A language-neutral contract:** Swift cannot share the TypeScript types, so the API's contract is also published as an OpenAPI description generated from the typed routes and their zod schemas. CI fails when it is out of date, so a Swift client can be generated from it or checked against it. The web screens use it the same way: they pin a copy, generate their types from it, and run their end-to-end tests against the API image built from the same commit (see "The API" in the README).
- **Sign-in for any client:** password sign-in, sessions, and sign-out work over the API for a native client as well as the browser, and a native client can hold its session as a token rather than a browser cookie. The web domain is associated with the iPhone app, so the iPhone fills in the password saved for the site.

### The server

One machine the owner rents and runs himself, in the shape of Kun's Eddie's Wallet server ([kunchenguid/eddies-wallet PR #2](https://github.com/kunchenguid/eddies-wallet/pull/2), MIT-licensed), moved from Hetzner to DigitalOcean. There are no managed app or database services.

- **The droplet:** DigitalOcean Basic Regular, 1 vCPU, 2 GB RAM, 50 GB disk, in New York, Ubuntu 24.04 LTS, weekly backups on.
- **Declared in OpenTofu:** the droplet, its cloud firewall, and its SSH key are files in the `tofu/` folder of the owner's private [D-E-A-G/deag-infra](https://github.com/D-E-A-G/deag-infra) repository, which holds the server's whole setup, so the server can be read, reviewed, and rebuilt from git. The firewall lets in ports 80 and 443 from anyone and SSH (port 22) only from the owner's address; everything else is closed. The owner can also reach SSH from anywhere over his private Tailscale network, which only he uses.
- **Set up on first boot** by a script that mirrors Kun's `deploy/bootstrap.sh`: a non-root deploy user, no root or password SSH login, `ufw` repeating the cloud firewall, `fail2ban`, automatic security updates, and Docker with a log size limit.
- **Four containers in Docker Compose** (`server/` in deag-infra): Caddy, the only one reachable from the internet, which gets and renews the HTTPS certificate from Let's Encrypt and passes `/api/*`, `/health` and `/openapi.json` to the API and everything else to the web container; the web container, which serves the built screens; the API; and Postgres 16 on an internal network with no port outside Docker and its data in a volume.
- **One production environment.** No staging, no preview environment per PR, one region.
- **Address:** until the root domain exists, the droplet answers on its IP address. The domain goes on Cloudflare DNS, with the app on its own subdomain, before login (milestone 2), because sign-in and installing the app need a real HTTPS name.

### Deploy path

1. A pull request runs CI on GitHub Actions: install, lint, typecheck, test, and build, on Linux, then the end-to-end tests against the web image and the pinned API image.
2. Merging to `main` runs CI again, then builds the web image (the built screens, served by Caddy), tags it with the commit, and pushes it to a private container registry.
3. The deploy job connects to the droplet over SSH as the deploy user, switches the web container to the new image, and checks its `/version.txt` from the container and the site through Caddy. If a check fails, it switches back to the previous image.

A manual run of the CI workflow on `main` (Run workflow in the Actions tab) does steps 2 and 3 for `main` as it stands, for when a merge started no run. A manual run on any other branch only checks.

The API is built and deployed from D-E-A-G/qbank-server the same way: its deploy runs the database migrations, switches the API container to the new image, and checks `/health`, switching back if the check fails.

The deploy job reaches the droplet inside the owner's Tailscale network, for the length of the job only, with an SSH key that can run the deploy and nothing else; see [Deploys from GitHub Actions](https://github.com/D-E-A-G/deag-infra/blob/main/server/apps/qbank/README.md#deploys-from-github-actions) in deag-infra.

### Backups

- **Weekly droplet backups** by DigitalOcean: a copy of the whole machine, for rebuilding the server.
- **Nightly dump off the box:** a timer on the droplet runs `pg_dump`, compresses it, and uploads it to a private Cloudflare R2 bucket, keeping 30. The dumps are not encrypted; reading one takes the bucket's key or the owner's Cloudflare login. The job refuses to fall back to saving on the same disk.
- **A tested restore:** a dump is restored into a fresh database in milestone 1, and again with her real data before she depends on the app.

## Privacy and security

- **Private repo.** This repository stays private.
- **No open sign-up.** Only an email on the owner's sign-up list can make an account, and only a user account; the admin account comes from the setup command. A refused sign-up says nothing about which emails are on the list, and repeated tries are rate-limited like sign-in. Each account sees only its own questions (see [Users](#users)).
- **Workers never hold production secrets.** The owner creates the DigitalOcean and Cloudflare accounts and keeps their API tokens, the server's SSH keys, the database password, and the backup bucket's key himself. He runs or approves every OpenTofu change to the real server, and he puts the deploy's secrets into GitHub Actions himself. Workers are told variable names, never values, and deploy by merging, not by holding credentials.
- **Tests never touch her account.** Tests and local development run against seeded fake users and a throwaway database.
- **No real course content in the repo.** Question banks are imported into the running app, not committed. Fixtures use invented questions.
- **Her account is hers to delete:** Delete account in Settings, on the web or in the iPhone app, removes her user account and everything in it for good, after her current password (see [Settings](#settings)).
- **Where her data goes:** the Postgres database on the droplet in DigitalOcean's New York region, DigitalOcean's weekly backups of that droplet, and the nightly dumps in a private R2 bucket. No email, analytics, or other outside service receives her data.
- **The server is locked down:** only ports 80 and 443 answer the internet, and only Caddy listens there; SSH takes keys only, from the owner's address or his Tailscale network only, with no root login; Postgres has no port outside Docker's internal network; security updates install automatically; `fail2ban` blocks repeated failed logins.
- **Login safety:** hashed passwords, secure HttpOnly SameSite cookies over HTTPS in the browser, rate-limited sign-in, and password resets only through the owner's admin account, with a temporary password she replaces at her next sign-in. A new password ends every other session of the account, and Sign out everywhere ends them all.
- **Server authority:** every rule is enforced by the API, so every client gets the same behavior (see [API-first](#stack-and-hosting)); every request is validated; the server scores every answer; the admin's limits are enforced on the server, not only hidden in the screens: the admin cannot record answers as her or edit her scores, progress, or Review list outside a repair.
- **Backups proven:** a restore from a nightly dump is tested when backups start (milestone 1) and again before she depends on the app (see [Backups](#backups)).

## Milestones

Each milestone has an acceptance check a reviewer can run.

**Delivery:** each piece of work is a direct PR. Until the MVP works, a PR is merged once its CI is green; after that, the owner merges.

The design system's tokens come from the owner's Claude Design export and arrive before the first screens (milestone 2).

| # | Milestone | Delivers | Accepted when |
|---|---|---|---|
| 0 | Accounts (owner) | A DigitalOcean account and API token; a Cloudflare account with a private R2 bucket and a token scoped to it; the SSH keys; the `age` key pair for backups; mise on his Mac (it installs the pinned OpenTofu from deag-infra's `mise.toml`); the deploy's secrets set in GitHub Actions. Before milestone 2: the root domain, with its DNS on Cloudflare. | A worker can deploy without holding any credential. |
| 1 | Scaffold, server, CI, first deploy, backups | pnpm workspace with `apps/web`, `apps/api`, `packages/questions`; strict TypeScript, ESLint, Vitest, Playwright; GitHub Actions; a health endpoint serving the built shell; the OpenAPI description generated from the routes, checked in CI; the API's Docker image. The droplet and its firewall in OpenTofu, the first-boot setup, Caddy, the API, and Postgres in Docker Compose, the deploy on merge to `main`, and the nightly encrypted dump to R2. | Merging to `main` deploys, and the droplet's `/health` answers from the merged commit; the published OpenAPI description matches the routes; a nightly dump is restored into a fresh database; CI green. |
| 2 | Login | The app's HTTPS address on its subdomain; password sign-in, sessions that last until sign-out, the user and admin accounts from a setup command, the admin's reset of her password with a temporary password, rate limits. | She signs in on two browsers over HTTPS; wrong passwords lock after N tries; the admin resets her password and she chooses her own at the next sign-in; the admin cannot record an answer as her. |
| 3 | Questions in | Schema and migrations; the Import screen with the runner's rules and messages; courses and semesters made from Import and Settings; replace with a warning, Cancel, and one-tap restore; the Terms list, with the newest set's definition winning; the admin's Import, Restore, Semesters and courses, and Weeks; the one-time import of the two existing banks. | Both banks import with 146 questions (NURS 402) and 86 questions (NURS 406); every malformed shape the runner rejects is rejected with the same message; she imports from a phone browser; a matching name asks first, Cancel changes nothing, and Restore brings the old set back; the admin imports a file, renames a week, and moves a set to another week. |
| 4 | Runner and scoring | The shared scoring package for all eight formats with tests; practice screens with shuffle, "I'm guessing", per-option reasons, rationale, takeaway, and term definitions. | Vitest reproduces every scoring rule above; Playwright answers all 232 questions correctly through the real screens. |
| 5 | Progress sync and Review | Attempts with idempotent ids, server re-scoring, `question_progress`, course completion and scores, Review with its filters, leave rule, and Clear the review list; landing on the last course; the admin's view of her progress and the Repair that rebuilds it from her answers. | Answer on browser A, see the same Review on browser B; drop the network mid-answer and reconnect, exactly one attempt is recorded; Clear asks first and Cancel changes nothing; the admin sees her Review but cannot change it outside a repair. |
| 6 | Exam, installable app, look, backups, launch | Exam over ticked weeks (40 in 60 minutes, or all at 1.5 minutes each) drawn in proportion, leave-ends-exam, unanswered questions kept out of Review, results with by-week breakdown and history; manifest and icons; light/dark mode; progress JSON through GET /api/me/export for an agent key with read; a restore drill with her real data; iPhone layout and iPad/Mac sidebar layout; her three devices set up. | An exam over Weeks 1-3 draws only from those weeks, in proportion, times out, and sends only the misses and guesses among what she answered to Review; it installs on an iPhone and a Mac and opens full-screen; a restore from last night's dump brings back a fresh attempt. |

Nothing else is planned after launch. The questions come from her agent's skill, imported, or from Make questions.

Future work, not scheduled: a SwiftUI iOS app as a second client of the same API. It has no Admin screen and no sign-up list; those stay on the web Admin page, which he can open in Safari on his phone (decision 22).

## Settled decisions

Made by the owner on 2026-09-27, except where a later date is given. Later workers should not re-ask these.

### Plan

1. **Build a small custom app** (not a bought product, not the offline pages plus a sync service, not "no app").
2. **Hosting (2026-09-28, replacing Railway + Neon):** one self-managed DigitalOcean droplet (Basic Regular, 1 vCPU / 2 GB / 50 GB, $12 a month, New York, Ubuntu 24.04 LTS, weekly backups) declared in OpenTofu, running Caddy, the API, and Postgres 16 in Docker Compose, mirroring Kun's Hetzner setup. No Railway, Neon, or Resend. One production environment. Backups are DigitalOcean's weekly backups plus a nightly encrypted `pg_dump` off the box to Cloudflare R2, with a tested restore, starting in milestone 1. Later, one root domain with a subdomain per app, DNS on Cloudflare. (2026-10-01: the nightly dump is no longer encrypted. The owner chose not to keep a separate decryption key; the bucket stays private.)
3. **Questions get in** through an Import screen in the app, where she imports the JSON her agent's weekly question skill makes, or through Make questions (see decision 4).
4. **Questions are made** by her agent running the `nclex-questions` skill outside the app (imported), or by Make questions inside QBank, which runs a copy of the same recipe on the server (this revises the original decision, which had no Make questions).
5. **Login** is a password with an optional passkey (Face ID / Touch ID). (2026-10-29: password only; see decision 26.)
6. **Each week's slides and transcripts stay in her iCloud folder**, not synced to the app. The app holds questions only; Make questions reads only the material she hands it for one job.
7. **Replacing a week's questions warns first** (naming the course, the week, and the number of questions), Cancel does nothing, and the previous version is kept and restorable.
8. **The theme is built fresh in Claude Design** later, from this document.
9. **API-first:** every rule lives on the server behind the API, never only inside the web screens, so a native iOS app built in SwiftUI can be added later as a second client of the same API, accounts, and data. The contract is published as OpenAPI for the Swift side, and sign-in, including passkeys, works for a native client. The iOS app itself is not part of this plan. (2026-10-29: no passkeys; see decision 26.)
10. **Password reset (2026-09-28):** the owner resets her password from his admin account with a temporary password he gives her. There is no email service.
11. **Sign-up (2026-10-01, replacing "no signup screen"):** a Sign up screen like a regular app's, limited to the emails on a sign-up list the owner keeps in Admin; the list starts with the first user's email, set when the app is set up, and he can add more at any time. Strangers cannot get in or see the questions. Each email makes one user account; the admin account is never made by sign-up. (On this date the decision said each email makes one student account and the question bank is shared. 2026-10-21: accounts are user accounts, and nothing is shared; see decision 21.) With more than one user account, the owner picks in Admin whose account he sees, resets, and repairs, starting with the oldest user account.

### Screens and flows

1. **Sets within a week:** a week lists every set imported for it, as long as each week's important parts are covered.
2. **Terms:** keep a Terms list per course.
3. **Exam length:** 40 questions in 60 minutes, or all of them when the chosen weeks hold fewer, at 1.5 minutes each, drawn from the weeks she ticks.
4. **Leaving an exam** ends it, scores what she answered, and sends the misses and guesses among them to Review.
5. **Leaving Review:** a question leaves Review the next time she answers it fully right without "I'm guessing".
6. **Courses and semesters** can be made in both Import and Settings. (2026-10-25: Home's + replaces Settings; see decision 23.)
7. **The owner has an admin account**, not a read-only login. He can import question files; create or fix courses, semesters, and weeks; restore a replaced set; reset her password; and repair her account data if something breaks. He cannot answer questions as her or change her scores, progress, or Review list in normal use. He sees her progress read-only.
8. **Passkey offer:** right after the first password sign-in on each device; the app stays signed in until she signs out. (2026-10-29: no passkey offer; see decision 26.)
9. **Review scope:** missed-and-guessed Review is per course only.
10. **Landing:** she lands on the course she used last.
11. **iPad and Mac** get a sidebar layout fitted to their screens (not the iPhone layout), shaped by the Claude Design system.
12. **Appearance:** the theme control is light/dark mode, not a theme picker. Since 2026-10-19 each account also picks its color scheme, Dusk (the default) or Slate.
13. **Unanswered exam questions:** when an exam ends early (left or timed out), only the questions she answered go to Review; the ones she skipped or never reached score 0 and are listed on the exam result.
14. **Clearing Review by hand:** keep a "Clear the review list" button per course. It asks "Clear all N questions from this course's Review list?" with Clear and Cancel; Cancel changes nothing.
15. **Same term, two definitions:** the course's Terms list shows the definition from the most recently imported set.
16. **Name and icon:** the app's display name and home-screen icon are decided during the Claude Design work.
17. **Wrong-questions exams (2026-10-12):** exam setup can limit an exam to the questions she got wrong, inside the weeks she ticks. Wrong means her last answer was not fully right.
18. **Exam banks (2026-10-12):** exams use their own questions, written as one exam twin per practice question (same topic, different format and wording), imported as exam sets. A week without an exam bank falls back to its practice questions. Exam questions she gets wrong stay exam-only: they do not enter Review.
19. **Folders and exam pages (2026-10-14):** weeks become folders she renames, fills, and orders herself; a folder can hold many sets and is on one exam page at most; each exam gets a page holding its folders. The course page lists Exam pages and Folders, each opening its own screen, as in the Files app; editing is Select, then Move. An exam page lists only its own folders. Import goes to Unsorted unless she picks a folder. The same folder name may be on different exam pages. Day one looks exactly like before, and the change itself never deletes, moves, or renames her sets, folder names, or progress.

20. **Delete and Undo (2026-10-18):** sets, folders, and past exams can be deleted. Deleting a folder deletes its sets, after a warning that names them; every delete warns exactly what else goes. Undo brings anything back for 30 days, and nothing is deleted except by her explicit, confirmed action.

21. **Study topics and private accounts (2026-10-19, ownership 2026-10-20):** a topic is a course with no semester, shown by its name, with study pages one level deep. Courses and topics stay in separate groups and use the same screens inside. A course keeps "Exam pages"; a topic says "Study pages". Folders stay, and the first import that needs a folder makes Unsorted. The timed exam is unchanged. A primer is a link on the study page, not a page stored in the app. Anki cards are not imported, and there is no review schedule. Archive is by hand, into a closed Archived group at the bottom of Home; nothing is archived from a date. Every semester, course, topic, page, folder, set, question, and term belongs to one user account. Every list, detail, and edit is that account's, and another account's id is answered as if it were not there. Sign-up makes a user account. The stored role value stays `student`, and the admin picker's heading is User account. The admin's read-only view of one user account stays, and his existing edits apply only to the account he is looking at. There is no shared question bank, no class, and no invite. A shared bank can be a later choice, and is not built. Rows that already existed kept their ids, names, and places, and were given to the one user account that already held the answers. A second account sees none of them.

22. **Admin stays on the web (2026-10-21):** admin tools stay web-only. There is no Admin screen and no sign-up list in the iPhone app. The web Admin page (Sign-up list) is the place, and he can open it in Safari on his phone. No iPhone admin screen is added for parity.

23. **One + per screen (2026-10-25):** each screen that holds things has one + at the right of its title, and it adds into that screen. Home's + adds a course to a semester, a study topic, or the next missing semester; a course's or topic's + imports a question file into it, makes a folder, or makes an exam or study page; an exam or study page's + imports a file with its folders first, makes a folder on it, or adds folders the course already has. Group headers lose their New (Study topics, Exam pages). A course or topic card on Home has a menu (touch and hold on the iPhone; a "…" and a right-click on the web) to open, rename, move, and archive it, with no confirmation, and Unarchive in Archived; and to delete it (red, last), which asks once ("Delete NURS 220 and its 146 questions? You can bring it back for 30 days.") and keeps it 30 days in Home's Recently deleted, a last row on Home that lists her deleted courses and topics with Undo, as the course page's Recently deleted does for sets, folders, and past exams (2026-10-25). The rule that her data is never deleted is about our changes, not an action she takes herself with an Undo. Settings keeps account things and each semester's name and dates, and loses its add controls and the Study topics card. The middle tab stays (Add on the iPhone, Import on the web), study notes are not added, both apps follow this layout. Nothing about her sets, folders, pages, answers, or progress moves; every add and Archive uses an endpoint that already existed, and Delete uses the server's course delete with its preview and Undo.

24. **Delete account on the web too (2026-10-28):** the web's Settings has Delete account for a user account, as the iPhone app's Settings has had since 2026-10-26, rather than staying iPhone-only. Both use the server's `DELETE /api/me` with her current password, which deletes the account signed in and everything in it for good, with no Recently deleted and no Undo, and signs it out on every device. It is her own confirmed action, like a delete with Undo, so the rule that her data is never deleted still holds for our changes. The admin account has none.

25. **Delete an exam page, with Undo (2026-10-28):** an exam or study page is deleted like a folder or set, rather than removed for good: **Delete this exam page** in its editor replaces **Remove this exam page**, which deleted the page and moved its folders to the Folders list with no Undo. The server's preview names the folders that stay and her past exams, the delete sends its confirmation, and the page waits 30 days in the course's Recently deleted, where Undo puts it back with its folders. Deleting a page deletes the page alone: no folder, set, answer, progress, or past exam is deleted or moved, so her folders and sets are never at risk from it. The web and the iPhone app use the same words.

26. **No passkeys (2026-10-29):** sign-in is a password only. The browser saves it, and on the iPhone Face ID fills it in, so "Sign in with a passkey", the "Save a passkey" sheet after sign-in, and the passkeys in Settings are gone from the web and the iPhone app. The server and what it stores are unchanged: passkeys saved before stay stored, unused, and go with an account when it is deleted. Every account has a password (the setup command and Sign up both set one), so no one loses their way in.

27. **Pages, with a badge (2026-10-30):** a course's and a topic's pages are one kind of page, rather than exam pages in a course and study pages in a topic set by where they live, because a page's name usually says what it is for. Both lists are **Pages**, + has **New page**, and a new page is "Page N" in both, asking for nothing more. A page carries one badge, Exam, Concept, or Study, or none, set later in its editor under **Badge** and shown as a small tag in the lists. A page may have no badge, rather than always one, and Study is a badge alongside Exam and Concept. The server stores the badge; her course pages keep their names, folders, and progress and get Exam, a topic's get none, and nothing is deleted, moved, or renamed. Building an exam from a page works the same whatever its badge. The web and the iPhone app ship together with the same words.

28. **Strike out choices (2026-10-30):** while a choice question (single answer, priority, select all that apply) is unanswered, in practice and in an exam, she can strike out the choices she has ruled out, as the big NCLEX question banks let her, and undo a strike in one tap. Each choice gets a letter and a visible strike-out control, on the web and the iPhone alike. A strike is per question for the sitting only: never sent to the server, saved, scored, or part of Review or progress. The other formats have no strike-out.
29. **Sign out everywhere, the small version (2026-11-03):** a session lasts 400 days in the browser and on the iPhone, and only signing out on that device ended it. Now a new password ends every other session of the account while the device that changed it stays signed in, and Settings on the web and in the iPhone app has one **Sign out everywhere**, which ends every session of the account, this one included. There is no list of signed-in devices, and sessions last as long as before.
30. **Pick up where she left off (2026-11-04):** every answer was saved, and the row counted them, but both apps opened a set at question 1 each time, so she lost her place and a redo could overwrite a right answer. A practice set now keeps a sitting on the server, the way an exam keeps its own, and opens at the first question she has not answered. Asking "Continue or Start over?" on every open was the other way, and was not chosen: she opens sets many times a night, and the row already says Continue. Keeping the place on the device alone was not chosen either, because she moves between the iPhone and the Mac. A set she was already midway through continues from the answers saved before sittings existed, and none is rewritten.
31. **Actions at the top right (2026-11-05):** a folder's three pills under its note (its page, Import here, Delete) made a page for one narrow topic noisy, so they moved to the buttons the other screens have: its + opens Import directly, with no menu while there is one way to add, and its **…** holds Rename, **Change page**, and a red **Delete folder**, last. An empty folder keeps its next step in view with **Import here** in its card. A page's Delete moves the same way, from last in its editor to a red **Delete page**, last in its **…**, and a course's or topic's Recently deleted from a card on the page to its **…**, always there, so restoring stays findable. Home's row stays: Home has no **…**. The web and the iPhone app change together. Only where controls sit changes: nothing stored does.
32. **The owner's frozen view (2026-11-06, replacing the parts of 7 and 21 that let him edit):** the view of a user account hid most of what the user sees, so layout problems did not show until he made his own account. Now he sees each account almost exactly as its user does, "sort of frozen without being able to actually delete edit or make progress or anything". The server refuses every write from his session to an account's content (403 `admin_read_only`, qbank-server #27), the web and the iPhone show the user's controls and answer each with one note, and Admin lists the accounts he may view. Admin's Semesters and courses and Study topics editors are gone. Repair and the temporary password stay.

33. **Highlight any part of a question (2026-11-12):** while reading, the user marks words of a question by pressing and dragging (touching and holding first on a touch screen), and taps a mark to erase it, as the big question banks let her, with no menu and no mode. A highlight lives like a strike (decision 28): per question, for the sitting only, on the device, never sent to the server, saved, or scored. It stays after Check answer until the set ends. The marks come in three colors, yellow, blue and pink, chosen from a pen at the top of the question, which keeps its last color on the device and holds Clear highlights. Only the question can be marked, not the rationale or takeaway. On the iPhone, touch and hold on an answer goes to highlighting, and the X still strikes. Selecting text and then choosing Highlight, with marks saved on the question for good and synced, and a marker mode that marks whole sentences, were the other two ways, and were not chosen; marks saved for good would point at the answer on a retake. With it, color comes into the question where it organizes the screen (teal exhibits, accent headers and letters, a progress strip and results charts by result), and never flags a reading as abnormal. The web and the iPhone app ship together with the same gesture, colors, pen and words. Nothing on the server changes.

## Open questions

Genuinely undecided. Do not decide these in a build PR; ask the owner.

None right now.
