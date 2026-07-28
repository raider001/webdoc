<!--meta
{
  "title": "Navigation",
  "description": "",
  "assumes": [],
  "next": []
}
-->

# Navigation Tests

Each test case is its own table: the meta header names the test and the
requirements it **Verifies**, and every row is one step — an **action** and its
**expected response**. Test ids compose to `T_{component}_{key}` (here
`T_WD_…`); a requirement's **Verified By** column is calculated from these.

<!--meta start {"test":"nav-tree","name":"Tree lists every document","verifies":["nav_1"],"steps":[{"action":"Open the hamburger tree","expected":"The document tree panel opens"},{"action":"Scan the tree","expected":"Every folder and document appears exactly once"}]}-->
<!--meta end {"test":"nav-tree"}-->

<!--meta start {"test":"nav-contents","name":"Contents reflects headings","verifies":["nav_2"],"steps":[{"action":"Open a document","expected":"The on-this-page list matches its headings, in order"},{"action":"Click a contents entry","expected":"The content scrolls to that heading"}]}-->
<!--meta end {"test":"nav-contents"}-->

<!--meta start {"test":"nav-deeplink","name":"Deep-link resolves","verifies":["nav_3"],"steps":[{"action":"- Do step 1","expected":"The target document loads"},{"action":"Observe the requirement row","expected":"It scrolls into view and flashes"}]}-->
<!--meta end {"test":"nav-deeplink"}-->
