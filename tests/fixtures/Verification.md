<!--meta
{
  "title": "Verification",
  "description": "Fixture holding a test case that verifies a fixture requirement.",
  "assumes": ["Guides/Requirements"],
  "next": []
}
-->

# Verification

A TEST FIXTURE. The test case below declares that it verifies `R_FX_FIX_1`, so
the requirement table in `Guides/Requirements` gains a Verified By entry and the
coverage rollup has something to roll up.

<!--meta start {"test-case":"fix_1","verifies":"R_FX_FIX_1"}-->
| action | response |
| --- | --- |
| Open the requirements fixture. | The requirement table renders with two rows. |
<!--meta end {"test-case":"fix_1"}-->
