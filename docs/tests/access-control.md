<!--meta
{
  "title": "Access Control",
  "description": "Test cases for accounts, access groups, propagation and disclosure.",
  "assumes": ["Docs/requirements/functional/access-control"],
  "next": []
}
-->

# Access Control Tests

Each test case is its own table: the meta header names the test and the
requirements it **Verifies**, and every row is one step — an **action** and its
**expected response**. Test ids compose to `T_WD_{key}`; a requirement's
**Verified By** column is calculated from these.

These are the manual counterparts of `tests/test_access_control.py`, which drives
the same behaviour against a real server process. Where the two overlap the
automated suite is authoritative — it checks the HTTP surface directly, which is
where the controls actually live.

<!--meta start {"test":"acc-disabled","name":"An open library stays open","verifies":["acc_1"],"steps":[{"action":"Start the server with no auth block in config.json","expected":"The start-up banner reads: auth: DISABLED"},{"action":"Open any document without signing in","expected":"It renders; there is no sign-in screen and no account button"},{"action":"Edit and save a document","expected":"The save succeeds"}]}-->
<!--meta end {"test":"acc-disabled"}-->

<!--meta start {"test":"acc-bootstrap","name":"First account becomes the administrator","verifies":["acc_2","acc_4"],"steps":[{"action":"Enable auth on a server with no accounts and open the site","expected":"The sign-in screen opens in Create-account mode and says the first account becomes the administrator"},{"action":"Create an account","expected":"You are signed in, and the account button shows your initials"},{"action":"Open the account panel","expected":"It shows the Administrator badge and a Manage accounts button"},{"action":"Create a second account from the accounts panel","expected":"It is created with no groups and no administrator flag"}]}-->
<!--meta end {"test":"acc-bootstrap"}-->

<!--meta start {"test":"acc-password","name":"Passwords are never stored or sent in the clear","verifies":["acc_3"],"steps":[{"action":"Open the account file named in the start-up banner","expected":"Each account holds a passwordHash of the form pbkdf2_sha256$<iterations>$<salt>$<hash>, and no plaintext"},{"action":"As an administrator, fetch /api/auth/users","expected":"The response contains no passwordHash field for any account"},{"action":"Sign in with a wrong password, then with an unknown username","expected":"Both give the same message: Incorrect username or password"}]}-->
<!--meta end {"test":"acc-password"}-->

<!--meta start {"test":"acc-groups","name":"Group membership grants read access","verifies":["acc_4","acc_5"],"steps":[{"action":"Give a document the access rule read: [staff]","expected":"The Who-can-read panel shows the Staff chip"},{"action":"Sign in as an account NOT in staff and open it","expected":"The restricted panel appears, naming Staff as the group that would open it"},{"action":"Add that account to staff from the accounts panel, sign in again, reopen","expected":"The document renders normally"}]}-->
<!--meta end {"test":"acc-groups"}-->

<!--meta start {"test":"acc-propagate","name":"A lock follows Recommended next","verifies":["acc_6"],"steps":[{"action":"Lock page A to staff; A recommends B, and B recommends C","expected":"A declares the rule; B and C inherit it"},{"action":"As an account not in staff, open B and then C","expected":"Both show the restricted panel"},{"action":"Open C's access panel as an administrator","expected":"It reports the rule as inherited, and names A"},{"action":"Give C its own rule of read: [ops]","expected":"C stops inheriting; an ops account reads C but not B"}]}-->
<!--meta end {"test":"acc-propagate"}-->

<!--meta start {"test":"acc-section","name":"A restricted section is withheld, not hidden by CSS","verifies":["acc_7","acc_11"],"steps":[{"action":"Wrap part of a public page in access-start read: [ops] and access-end","expected":"An ops account sees the section render as ordinary Markdown"},{"action":"As an account not in ops, open the page","expected":"The section is replaced by a notice naming Operations; the rest of the page renders"},{"action":"View the raw response for that .md URL","expected":"The withheld text is absent from the bytes served, not merely hidden"},{"action":"As that same account, try to edit the page","expected":"The Edit button is not offered, and a direct save is refused"}]}-->
<!--meta end {"test":"acc-section"}-->

<!--meta start {"test":"acc-locked","name":"A locked page is visible but unreadable","verifies":["acc_8","acc_12"],"steps":[{"action":"As an account without access, open the map","expected":"The locked page appears with a padlock and a colour band for its groups"},{"action":"Read the locked node","expected":"Its title is shown and its description is blank"},{"action":"Open the Access groups legend and click its group","expected":"Pages only that group can read are dimmed"},{"action":"Search for a word from the locked page's title","expected":"The page is listed with no snippet"}]}-->
<!--meta end {"test":"acc-locked"}-->

<!--meta start {"test":"acc-hidden","name":"A hidden page is indistinguishable from a missing one","verifies":["acc_9"],"steps":[{"action":"Give a page the rule hidden: true and sign in as an account without access","expected":"It is absent from the map, the document tree and the directory listing"},{"action":"Search for a word unique to that page","expected":"No result"},{"action":"Request its URL directly, then request a filename that does not exist","expected":"Both return 404 with an identical body"},{"action":"Link to it from a page you can read","expected":"The link renders as a dangling link, not a route"}]}-->
<!--meta end {"test":"acc-hidden"}-->

<!--meta start {"test":"acc-acl-rights","name":"Editing a page does not mean rewriting its permissions","verifies":["acc_10"],"steps":[{"action":"As a non-administrator with write access, edit a locked page's text and save","expected":"The save succeeds"},{"action":"Remove the access block from the same page and save","expected":"Refused, with a message that changing who can see the page needs access-management rights"},{"action":"Add an access block to an unrestricted page as the same account","expected":"Refused for the same reason"},{"action":"Delete a restricted page as the same account","expected":"Refused: deleting a restricted page needs the same right"}]}-->
<!--meta end {"test":"acc-acl-rights"}-->

<!--meta start {"test":"acc-server-side","name":"The browser is not the control","verifies":["acc_11"],"steps":[{"action":"Sign in as an account without access to a locked page, and request its .md URL directly with a command-line client carrying the session cookie","expected":"403, with the groups that would open it"},{"action":"Repeat with no cookie at all","expected":"403 with signInRequired set"},{"action":"Send a PUT to that page with a valid CSRF token","expected":"403; the file on disk is unchanged"},{"action":"Send a PUT to a writable page with no CSRF header","expected":"403; the file on disk is unchanged"}]}-->
<!--meta end {"test":"acc-server-side"}-->
