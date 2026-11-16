# Security Specification — Value E-billing (AR, Installment & RBAC Hub)

## 1. Data Invariants
1. **Strict RBAC & Approval Gate**:
   - Every user has a non-PII `/users/{userId}` document containing `role` (`sales`, `accounting`, `super_admin`) and `approvalStatus` (`pending`, `approved`, `suspended`).
   - Only `praphai33344@gmail.com` (with `email_verified == true`) can self-initialize as `super_admin` + `approved`. All other new accounts self-initialize strictly with `role: 'sales'` and `approvalStatus: 'pending'`.
   - Self-modification of `role` or `approvalStatus` by non-super-admins is strictly forbidden.
2. **PII Isolation**:
   - User email and phone reside exclusively in `/users/{userId}/private/info`, accessible only to the owner (`request.auth.uid == userId`).
   - `/users/{userId}` contains zero PII so verified/approved team members can safely populate the `"ผู้ดูแลลูกหนี้"` dropdown.
3. **Role-Based Contract & Payment Scoping**:
   - `sales`: Can read/create contracts where `ownerId == uid || assignedRepUid == uid`. Cannot delete contracts, void/edit payments, waive penalties, or retroactively alter settled contracts.
   - `accounting`: Can read all contracts/payments/attachments/collectionLogs, record/edit/void payments with atomic recalculation of the parent contract (`getAfter().updatedAt == request.time`), and restructure schedules. Cannot approve users, waive penalties, or reset workspace.
   - `super_admin`: Full oversight across contracts, payments, user approvals/role assignment, penalty waivers, audit log reading, and system reset.
4. **Immutable Audit Trail & Schedule Revisions**:
   - `/auditLogs/{logId}` entries must match `actorUid == request.auth.uid` and `createdAt == request.time`, and are immutable against updates (`allow update: if false`).
   - `/contracts/{contractId}/revisions/{revisionId}` archives pre-restructure schedules and is immutable against updates.
5. **Payment & Attachment Integrity**:
   - Creating a payment requires an existing parent contract and atomic update of the parent contract's `updatedAt == request.time` in the same `writeBatch`.
   - Editing or voiding a payment is restricted to `accounting` and `super_admin`, must set `updatedAt == request.time`, and must atomically recalculate the parent contract (`getAfter(...).updatedAt == request.time`).

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Self-Privilege Escalation (Profile Create)**: Non-owner user registers `/users/attacker` with `role: "super_admin"` or `approvalStatus: "approved"`. -> Rejected by `isValidInitialUserRole()`.
2. **Self-Role Tampering (Profile Update)**: `sales` updates `/users/{uid}` trying to change `role` to `"super_admin"` or `approvalStatus` to `"approved"`. -> Rejected by `affectedKeys().hasOnly(['displayName', 'companyName', 'department', 'updatedAt'])`.
3. **Spoofed Super Admin Email**: Attacker registers with `email_verified: false` claiming admin email. -> Rejected by `request.auth.token.email_verified == true`.
4. **Sales Deleting Contract**: `sales` attempts `deleteDoc(/contracts/{id})`. -> Rejected because `allow delete` requires `isSuperAdmin()`.
5. **Sales Editing or Voiding Payment**: `sales` attempts `updateDoc(/payments/{id}, { isVoided: true })`. -> Rejected by `isAccountingOrAdmin()`.
6. **Sales Cross-Rep Contract Scraping**: `sales` A tries `get(/contracts/{id})` belonging to `sales` B (`assignedRepUid == userB && ownerId == userB`). -> Rejected by contract `allow get` rule.
7. **Shadow Field Injection**: Client sends contract or payment payload with unexpected ghost field `bypassAudit: true`. -> Rejected by strict `data.keys().hasOnly([...])`.
8. **ID Poisoning**: Client writes `/contracts/invalid!@#id` or oversized doc ID. -> Rejected by `isValidId()`.
9. **Negative Financial Poisoning**: Client creates contract with `totalAmount: -1000` or payment with `actualCashAmount: -500`. -> Rejected by `is number && val >= 0`.
10. **Non-Atomic Payment Desync**: Accounting creates or edits `/payments/{id}` without atomically updating parent contract `updatedAt == request.time`. -> Rejected by `getAfter(...).data.updatedAt == request.time`.
11. **Audit Log Forgery**: User A writes `/auditLogs/{id}` with `actorUid: "userB"` or modifies existing `/auditLogs/{id}`. -> Rejected by `incoming().actorUid == request.auth.uid` and `allow update: if false`.
12. **PII Leak Attempt**: `super_admin` or `sales` tries reading `/users/{otherUid}/private/info`. -> Rejected by `isOwner(userId)`.
