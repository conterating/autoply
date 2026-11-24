# Public job-board endpoints (checked 2026-11-23)

Sources: docs.greenhouse.io/job-board.html, github.com/lever/postings-api, developers.ashbyhq.com/docs/public-job-posting-api.

Autoply uses these **only for discovery**. Applications are filled through each ATS's hosted application page in a browser (the Greenhouse and Lever submit APIs need employer API keys; Ashby has no public submit API).

## Greenhouse

`GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true`

```json
{ "jobs": [ {
    "id": 127817, "internal_job_id": 144381, "title": "Vault Designer",
    "updated_at": "2016-01-14T10:55:28-05:00", "requisition_id": "50",
    "location": { "name": "NYC" },
    "absolute_url": "https://boards.greenhouse.io/vaulttec/jobs/127817",
    "language": "en", "metadata": null,
    "content": "&lt;p&gt;HTML-escaped description&lt;/p&gt;",
    "departments": [{ "id": 13583, "name": "...", "parent_id": null, "child_ids": [] }],
    "offices": [{ "id": 8304, "name": "East Coast", "location": "United States", "parent_id": null, "child_ids": [] }]
} ], "meta": { "total": 1 } }
```

`GET .../jobs/{id}?questions=true` adds `questions: [{ required, label, fields: [{ name, type, values?: [{ value, label }] }] }]`, field types `input_text | textarea | input_file | input_hidden | multi_value_single_select | multi_value_multi_select`; `demographic_questions: { header, description, questions: [{ id, label, required, type, answer_options: [{ id, label, free_form }] }] }`.

## Lever

`GET https://api.lever.co/v0/postings/{site}?mode=json` returns a bare array:

```json
[ {
  "id": "5ac21346-8e0c-4494-8e7a-3eb92ff77902", "text": "Example Job",
  "categories": { "location": "San Francisco", "commitment": "Full-time", "team": "Eng", "department": "R&D", "allLocations": ["San Francisco"] },
  "country": "US", "descriptionPlain": "...", "additionalPlain": "...",
  "lists": [{ "text": "Requirements", "content": "<li>...</li>" }],
  "hostedUrl": "https://jobs.lever.co/leverdemo/5ac2...",
  "applyUrl": "https://jobs.lever.co/leverdemo/5ac2.../apply",
  "workplaceType": "remote",
  "salaryRange": { "currency": "USD", "interval": "per-year-salary", "min": 100000, "max": 140000 }
} ]
```

`workplaceType`: `unspecified | on-site | remote | hybrid`. `createdAt` is **not** documented; do not rely on it. Rate limit guidance: under 2 req/s.

## Ashby

`GET https://api.ashbyhq.com/posting-api/job-board/{JOB_BOARD_NAME}?includeCompensation=true`

```json
{ "apiVersion": "1", "jobs": [ {
  "title": "Product Manager", "location": "Houston, TX", "department": "Product", "team": "Growth",
  "secondaryLocations": [], "isListed": true, "isRemote": true, "workplaceType": "Remote",
  "descriptionHtml": "<p>Join our team</p>", "descriptionPlain": "Join our team",
  "publishedAt": "2021-04-30T16:21:55.393+00:00", "employmentType": "FullTime",
  "address": { "postalAddress": { "addressLocality": "Houston", "addressRegion": "Texas", "addressCountry": "USA" } },
  "jobUrl": "https://jobs.ashbyhq.com/example/<uuid>", "applyUrl": "https://jobs.ashbyhq.com/example/<uuid>/application"
} ] }
```

`workplaceType`: `OnSite | Remote | Hybrid`. `employmentType`: `FullTime | PartTime | Intern | Contract | Temporary`. No `id` field is documented; derive the posting id from the UUID in `jobUrl`. Skip jobs with `isListed: false`.
