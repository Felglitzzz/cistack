---
name: secure-coding
description: For cistack reviewers only. The security checklist for a diff that touches data access, requests, user input, authentication, sessions or secrets.
user-invocable: false
---

# Secure coding

The checklist for the security item. It is a floor: still read the whole diff.

Each rule says what goes wrong, when it applies, and what shows the code is safe. Check only the rules the diff triggers. A rule the project has settled in its own docs (for example "authentication is by bearer header only, so CSRF does not apply") is not raised again.

## Data access

**Injection**
- Fails: input changes the meaning of a query, shell command, file path or template.
- Applies: wherever input is built into something that is then run or opened.
- Safe: parameters, argument lists or the library's own builder. No string building. Paths are resolved and checked to stay inside their folder.

**Ownership**
- Fails: a user reads or changes another user's record by guessing its id.
- Applies: every fetch, update or delete by id.
- Safe: the query filters by id and by owner, and a test asking for someone else's id is refused.

**Tenancy**
- Fails: one tenant sees another's data.
- Applies: every query on tenant data.
- Safe: the tenant filter comes from the authenticated session, never from the request.

**Races on check-then-act**
- Fails: two requests both pass a check, then both act: two accounts with one email, one token spent twice.
- Applies: uniqueness, single-use tokens, balances and counters.
- Safe: a unique constraint, a lock or an atomic update. A check in application code alone is not enough.

## Requests and pages

**CORS**
- Fails: a hostile site reads authenticated responses from a browser.
- Safe: an explicit list of origins, never a wildcard with credentials.

**CSRF**
- Fails: a hostile page makes the browser send a state-changing request with the user's cookie.
- Applies: only when a cookie carries the authentication.
- Safe: a CSRF token, or a `SameSite` cookie plus an origin check, on every state-changing route.

**Cross-site scripting**
- Fails: someone's markup runs in another viewer's browser.
- Applies: HTML or markdown rendered from user content.
- Safe: escaped, or passed through a sanitizer with an allow list.

**Server-side request forgery**
- Fails: the server fetches an internal address for an attacker.
- Applies: fetching a URL the user supplied.
- Safe: an allow list of hosts, or private and loopback addresses refused after resolving, redirects included.

**Rate limits**
- Fails: unlimited guesses at a login or reset, or unlimited cost from an anonymous caller.
- Applies: new or changed endpoints that are unauthenticated or check credentials.
- Safe: a limit in the route or the gateway that you can point to.

**Input validation**
- Fails: oversized, malformed or unexpected fields reach the logic or the data.
- Safe: each field has a type and bounds before it is used.

## Authentication and secrets

**Tokens**
- Fails: a forged, expired, stolen or replayed token is accepted.
- Safe: the algorithm is pinned when verifying, expiry and audience are checked, lifetimes are short, refresh tokens rotate and are hashed at rest, and logout and password changes revoke them.

**Passwords**
- Fails: leaked hashes crack quickly, or answers and timing reveal which accounts exist.
- Safe: a slow, salted password hash, constant-time comparison, and one answer for an unknown user and a wrong password.

**Mass assignment**
- Fails: a client sets its own role or tenant, or a response leaks a password hash.
- Safe: requests and responses list their fields explicitly.

**Fail closed**
- Fails: a security check errors and the request goes through.
- Safe: an error or timeout in the check denies, and a test covers it.

**Secrets and errors**
- Fails: a secret is committed or logged, production starts with a default secret, or an error shows internals.
- Safe: secrets come from the environment with no insecure default, and error responses are generic.

## Performance

**One query per row**
- Fails: a list of 500 rows costs 501 queries.
- Applies: collections that are unbounded or sized by the user.
- A finding here fails `risk`, not `security`.

## Reporting

A finding names the input and the outcome. Injection, a missing ownership check and a forged token are certain failures. A missing rate limit on an internal endpoint is not a finding.
