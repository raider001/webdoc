<!--meta
{
  "title": "Verification",
  "description": "Test-case requirements that verify the functional requirements - modelled as requirement blocks so the whole V-model is one traceable graph.",
  "assumes": ["Guides/Requirements"],
  "next": ["Guides/Requirements"]
}
-->

# Verification

Test cases are modelled as `requirement` blocks of `type:"test"`, so verification
lives in the very same trace graph. The functional requirements on the
[Requirements](#/Guides/Requirements) page reference these by id in their
`verifiedBy` fields; because the trace index is global, those chips deep-link
straight here - **across documents**.

Each test card below shows an automatically computed **Verifies** row: the
requirements that name this test in their `verifiedBy`.

## Test cases

```requirement
{
  "id": "TC-101",
  "title": "Verify a reset email is delivered and its token expires on time",
  "type": "test",
  "status": "approved",
  "relatedTo": ["FR-001", "FR-002"],
  "tags": ["auth"]
}
```

```requirement
{
  "id": "TC-002",
  "title": "Verify account-change notifications are sent",
  "type": "test",
  "status": "approved",
  "relatedTo": ["SR-002"],
  "tags": ["security", "notifications"]
}
```
