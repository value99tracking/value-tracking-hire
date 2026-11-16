import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  computeVatBreakdown,
  getTodayISO,
  hydrateContract,
  recalculateContractFromLedger,
  round2,
} from './debtEngine';
import {
  FIELD_LIMITS,
  type ActiveContractType,
  type ApprovalStatus,
  type CollectionChannel,
  type ContractRecord,
  type ContractStatus,
  type CreditGrade,
  type PaymentAttachmentRecord,
  type PaymentMethod,
  type PaymentRecord,
  type PaymentType,
  type Region,
  type RequestedRole,
  type UserPrivateInfo,
  type UserProfile,
  type UserRole,
} from '../types/billing';

export function formatTHB(amount: number, decimals = 0): string {
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(decimals === 0 ? Math.round(amount) : round2(amount));
}

export function sanitizeStr(value: string, maxLen: number): string {
  return value.trim().slice(0, maxLen);
}

export function clampAmount(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(round2(value), FIELD_LIMITS.maxAmount);
}

export function formatAssigneeLabel(user: Pick<UserProfile, 'displayName' | 'department'>): string {
  return sanitizeStr(`${user.displayName} (${user.department})`, FIELD_LIMITS.salesRepMax);
}

export interface ActorContext {
  uid: string;
  name: string;
  role: UserRole;
}

function addAuditToBatch(
  batch: WriteBatch,
  actor: ActorContext,
  entry: {
    action: string;
    targetType: 'contract' | 'payment' | 'user' | 'system';
    targetId: string;
    targetLabel: string;
    reason?: string;
    beforeSummary?: string;
    afterSummary?: string;
  }
) {
  const ref = doc(collection(db, 'auditLogs'));
  const payload: Record<string, unknown> = {
    actorUid: actor.uid,
    actorName: sanitizeStr(actor.name || 'ผู้ใช้งาน', FIELD_LIMITS.displayNameMax),
    actorRole: actor.role,
    action: sanitizeStr(entry.action, 60),
    targetType: entry.targetType,
    targetId: sanitizeStr(entry.targetId, 128),
    targetLabel: sanitizeStr(entry.targetLabel, 160),
    createdAt: serverTimestamp(),
  };
  if (entry.reason) payload.reason = sanitizeStr(entry.reason, FIELD_LIMITS.reasonMax);
  if (entry.beforeSummary) payload.beforeSummary = sanitizeStr(entry.beforeSummary, 600);
  if (entry.afterSummary) payload.afterSummary = sanitizeStr(entry.afterSummary, 600);
  batch.set(ref, payload);
}

export async function upsertUserProfile(
  uid: string,
  profileInput: {
    displayName: string;
    companyName: string;
    department: string;
    requestedRole?: RequestedRole;
  },
  privateInput: { email: string; phone?: string },
  isBootstrappedAdmin = false
): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const privateRef = doc(db, 'users', uid, 'private', 'info');

  const safeDisplayName = sanitizeStr(profileInput.displayName || 'ผู้ใช้งานระบบ', FIELD_LIMITS.displayNameMax) || 'ผู้ใช้งานระบบ';
  const safeCompany = sanitizeStr(profileInput.companyName || 'Value Tracking Hire', FIELD_LIMITS.companyNameMax) || 'Value Tracking Hire';
  const safeDepartment = sanitizeStr(profileInput.department || 'บริหารลูกหนี้', FIELD_LIMITS.departmentMax) || 'บริหารลูกหนี้';
  const safeEmail = sanitizeStr(privateInput.email, FIELD_LIMITS.emailMax);
  const safePhone = privateInput.phone ? sanitizeStr(privateInput.phone, FIELD_LIMITS.phoneMax) : '';

  try {
    const existingSnap = await getDoc(userRef);
    const batch = writeBatch(db);

    if (existingSnap.exists()) {
      const prev = existingSnap.data() as Partial<UserProfile>;
      const updatePayload: Record<string, unknown> = {
        displayName: safeDisplayName,
        companyName: safeCompany,
        department: safeDepartment,
        updatedAt: serverTimestamp(),
      };
      // Migrate legacy user doc or enforce bootstrapped admin role/approval
      if (
        !prev.role ||
        !prev.approvalStatus ||
        (isBootstrappedAdmin && (prev.role !== 'super_admin' || prev.approvalStatus !== 'approved'))
      ) {
        updatePayload.role = isBootstrappedAdmin ? 'super_admin' : 'sales';
        updatePayload.approvalStatus = isBootstrappedAdmin ? 'approved' : 'pending';
        if (!isBootstrappedAdmin && profileInput.requestedRole) {
          updatePayload.requestedRole = profileInput.requestedRole;
        }
      }
      batch.update(userRef, updatePayload);
    } else {
      const createPayload: Record<string, unknown> = {
        uid,
        displayName: safeDisplayName,
        companyName: safeCompany,
        department: safeDepartment,
        role: isBootstrappedAdmin ? 'super_admin' : 'sales',
        approvalStatus: isBootstrappedAdmin ? 'approved' : 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (!isBootstrappedAdmin && profileInput.requestedRole) {
        createPayload.requestedRole = profileInput.requestedRole;
      }
      batch.set(userRef, createPayload);
    }

    const privateSnap = await getDoc(privateRef);
    const privatePayload: Record<string, unknown> = {
      uid,
      email: safeEmail,
      updatedAt: serverTimestamp(),
    };
    if (safePhone) {
      privatePayload.phone = safePhone;
    }

    if (privateSnap.exists()) {
      batch.update(privateRef, privatePayload);
    } else {
      batch.set(privateRef, privatePayload);
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }
}

export async function updateUserRoleAndApproval(
  actor: ActorContext,
  targetUser: UserProfile,
  nextRole: UserRole,
  nextApprovalStatus: ApprovalStatus,
  reason?: string
): Promise<void> {
  const userRef = doc(db, 'users', targetUser.uid);
  const batch = writeBatch(db);
  batch.update(userRef, {
    role: nextRole,
    approvalStatus: nextApprovalStatus,
    updatedAt: serverTimestamp(),
  });

  addAuditToBatch(batch, actor, {
    action: 'อนุมัติ/ปรับสิทธิ์ผู้ใช้งาน',
    targetType: 'user',
    targetId: targetUser.uid,
    targetLabel: formatAssigneeLabel(targetUser),
    reason: reason || 'ปรับปรุงสิทธิ์โดยผู้บริหาร',
    beforeSummary: `บทบาท: ${targetUser.role}, สถานะ: ${targetUser.approvalStatus}`,
    afterSummary: `บทบาท: ${nextRole}, สถานะ: ${nextApprovalStatus}`,
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${targetUser.uid}`);
  }
}

export async function fetchUserProfileData(
  uid: string
): Promise<{ profile: UserProfile | null; privateInfo: UserPrivateInfo | null }> {
  try {
    const [profileSnap, privateSnap] = await Promise.all([
      getDoc(doc(db, 'users', uid)),
      getDoc(doc(db, 'users', uid, 'private', 'info')),
    ]);

    return {
      profile: profileSnap.exists() ? (profileSnap.data() as UserProfile) : null,
      privateInfo: privateSnap.exists() ? (privateSnap.data() as UserPrivateInfo) : null,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${uid}`);
  }
}

export interface ContractFormInput {
  contractCode: string;
  clinicName: string;
  parentClinicName?: string;
  contactPerson?: string;
  contactPhone?: string;
  taxId?: string;
  companyAddress?: string;
  equipmentModel?: string;
  serialNumber?: string;
  deliveryDate?: string;
  warrantyEndDate?: string;
  region: Region;
  contractType: ActiveContractType;
  assignedRepUid: string;
  salesRep: string;
  creditGrade: CreditGrade;
  includeVat: boolean;
  amountBeforeVat: number;
  vatAmount: number;
  totalAmount: number;
  downPayment: number;
  securityDeposit: number;
  totalInstallments: number;
  startDate: string;
  penaltyRatePercent: number;
  status: ContractStatus;
  notes?: string;
}

function buildContractPayloadBase(input: ContractFormInput) {
  const safeTotal = clampAmount(input.totalAmount);
  const vatBreakdown = input.includeVat
    ? computeVatBreakdown(input.amountBeforeVat > 0 ? input.amountBeforeVat : safeTotal, input.amountBeforeVat > 0 ? 'before_vat' : 'include_vat', true)
    : { amountBeforeVat: safeTotal, vatAmount: 0, totalAmount: safeTotal };

  const safeDown = Math.min(clampAmount(input.downPayment), vatBreakdown.totalAmount);
  const safeInstallments = Math.max(1, Math.min(FIELD_LIMITS.maxInstallments, Math.round(input.totalInstallments || 1)));
  const financed = round2(Math.max(0, vatBreakdown.totalAmount - safeDown));
  const monthlyInstallment = round2(financed / safeInstallments);

  const payload: Record<string, unknown> = {
    assignedRepUid: sanitizeStr(input.assignedRepUid, 128),
    contractCode: sanitizeStr(input.contractCode.replace(/[^a-zA-Z0-9-]/g, ''), FIELD_LIMITS.contractCodeMax),
    clinicName: sanitizeStr(input.clinicName, FIELD_LIMITS.clinicNameMax),
    parentClinicName: sanitizeStr(input.parentClinicName || '', FIELD_LIMITS.parentClinicNameMax),
    contactPerson: sanitizeStr(input.contactPerson || '', FIELD_LIMITS.contactPersonMax),
    contactPhone: sanitizeStr(input.contactPhone || '', FIELD_LIMITS.contactPhoneMax),
    taxId: sanitizeStr(input.taxId || '', FIELD_LIMITS.taxIdMax),
    companyAddress: sanitizeStr(input.companyAddress || '', FIELD_LIMITS.companyAddressMax),
    equipmentModel: sanitizeStr(input.equipmentModel || '', FIELD_LIMITS.equipmentModelMax),
    serialNumber: sanitizeStr(input.serialNumber || '', FIELD_LIMITS.serialNumberMax),
    deliveryDate: sanitizeStr(input.deliveryDate || '', FIELD_LIMITS.dueDateMax),
    warrantyEndDate: sanitizeStr(input.warrantyEndDate || '', FIELD_LIMITS.dueDateMax),
    region: input.region,
    contractType: input.contractType,
    salesRep: sanitizeStr(input.salesRep, FIELD_LIMITS.salesRepMax),
    creditGrade: input.creditGrade,
    includeVat: Boolean(input.includeVat),
    amountBeforeVat: vatBreakdown.amountBeforeVat,
    vatAmount: vatBreakdown.vatAmount,
    totalAmount: vatBreakdown.totalAmount,
    downPayment: safeDown,
    securityDeposit: clampAmount(input.securityDeposit),
    totalInstallments: safeInstallments,
    monthlyInstallment,
    startDate: sanitizeStr(input.startDate || getTodayISO(), FIELD_LIMITS.dueDateMax),
    penaltyRatePercent: Math.max(0, Math.min(50, round2(input.penaltyRatePercent ?? 1.5))),
    notes: sanitizeStr(input.notes || '', FIELD_LIMITS.notesMax),
  };

  return { payload, vatBreakdown, safeDown, safeInstallments, monthlyInstallment };
}

function buildLegacyBackfillFields(contract: ContractRecord): Record<string, unknown> {
  const h = hydrateContract(contract);
  const cleanCode = h.contractCode.replace(/[^a-zA-Z0-9-]/g, '');
  const safeCode = sanitizeStr(cleanCode.length >= 2 ? cleanCode : 'CNT-000', FIELD_LIMITS.contractCodeMax);
  const safeClinic = sanitizeStr(h.clinicName.length >= 2 ? h.clinicName : 'คลินิก', FIELD_LIMITS.clinicNameMax);
  const safeRep = sanitizeStr(h.salesRep.length >= 2 ? h.salesRep : 'ผู้ดูแลระบบ', FIELD_LIMITS.salesRepMax);
  const safeRepUid = sanitizeStr(h.assignedRepUid || h.ownerId || 'system', 128);

  return {
    assignedRepUid: safeRepUid,
    contractCode: safeCode,
    clinicName: safeClinic,
    region: h.region,
    contractType: h.contractType,
    salesRep: safeRep,
    creditGrade: h.creditGrade,
    includeVat: h.includeVat,
    amountBeforeVat: h.amountBeforeVat,
    vatAmount: h.vatAmount,
    totalAmount: h.totalAmount,
    downPayment: h.downPayment,
    securityDeposit: h.securityDeposit,
    totalInstallments: h.totalInstallments,
    monthlyInstallment: h.monthlyInstallment,
    startDate: sanitizeStr(h.startDate || getTodayISO(), FIELD_LIMITS.dueDateMax),
    penaltyRatePercent: h.penaltyRatePercent,
    waivedPenaltyAmount: round2(h.waivedPenaltyAmount ?? 0),
    scheduleVersion: Math.max(1, Math.round(h.scheduleVersion ?? 1)),
  };
}

export async function createContract(
  actor: ActorContext,
  input: ContractFormInput
): Promise<string> {
  const contractRef = doc(collection(db, 'contracts'));
  const { payload } = buildContractPayloadBase(input);
  if (String(payload.contractCode).length < 2) {
    throw new Error('รหัสสัญญาต้องมีอย่างน้อย 2 ตัวอักษรภาษาอังกฤษหรือตัวเลข');
  }

  const draftRecord = hydrateContract({
    id: contractRef.id,
    ownerId: actor.uid,
    ...(payload as Partial<ContractRecord>),
    waivedPenaltyAmount: 0,
    scheduleVersion: 1,
    status: input.status,
    dueDate: String(payload.startDate),
  });
  const ledger = recalculateContractFromLedger(draftRecord, []);

  const finalPayload: Record<string, unknown> = {
    ...payload,
    ownerId: actor.uid,
    waivedPenaltyAmount: 0,
    scheduleVersion: 1,
    paidAmount: ledger.totalEffectivePaid,
    prepaidAmount: ledger.prepaidFutureAmount,
    notDueAmount: ledger.notDuePrincipal,
    dueThisMonthAmount: ledger.dueThisMonthPrincipal,
    overdueAmount: ledger.overduePrincipal,
    creditGrade: input.creditGrade || ledger.suggestedGrade,
    status: input.status === 'suspended' ? 'suspended' : ledger.nextStatus,
    dueDate: ledger.nextDueDate,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const batch = writeBatch(db);
  batch.set(contractRef, finalPayload);
  addAuditToBatch(batch, actor, {
    action: 'สร้างสัญญาใหม่',
    targetType: 'contract',
    targetId: contractRef.id,
    targetLabel: `${finalPayload.contractCode} (${finalPayload.clinicName})`,
    afterSummary: `ยอดรวม ${formatTHB(Number(finalPayload.totalAmount), 2)} บาท | ดาวน์ ${formatTHB(Number(finalPayload.downPayment), 2)} | ${finalPayload.totalInstallments} งวด | ผู้ดูแล: ${finalPayload.salesRep}`,
  });

  try {
    await batch.commit();
    return contractRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `contracts/${contractRef.id}`);
  }
}

export async function updateContract(
  actor: ActorContext,
  existingContract: ContractRecord,
  input: ContractFormInput,
  linkedPayments: PaymentRecord[],
  reason?: string
): Promise<void> {
  const contractRef = doc(db, 'contracts', existingContract.id);
  const batch = writeBatch(db);

  if (actor.role === 'sales') {
    // Sales can only update non-financial customer/equipment/notes fields
    const salesPayload: Record<string, unknown> = {
      parentClinicName: sanitizeStr(input.parentClinicName || '', FIELD_LIMITS.parentClinicNameMax),
      contactPerson: sanitizeStr(input.contactPerson || '', FIELD_LIMITS.contactPersonMax),
      contactPhone: sanitizeStr(input.contactPhone || '', FIELD_LIMITS.contactPhoneMax),
      taxId: sanitizeStr(input.taxId || '', FIELD_LIMITS.taxIdMax),
      companyAddress: sanitizeStr(input.companyAddress || '', FIELD_LIMITS.companyAddressMax),
      equipmentModel: sanitizeStr(input.equipmentModel || '', FIELD_LIMITS.equipmentModelMax),
      serialNumber: sanitizeStr(input.serialNumber || '', FIELD_LIMITS.serialNumberMax),
      deliveryDate: sanitizeStr(input.deliveryDate || '', FIELD_LIMITS.dueDateMax),
      warrantyEndDate: sanitizeStr(input.warrantyEndDate || '', FIELD_LIMITS.dueDateMax),
      notes: sanitizeStr(input.notes || '', FIELD_LIMITS.notesMax),
      updatedAt: serverTimestamp(),
    };
    batch.update(contractRef, salesPayload);
    addAuditToBatch(batch, actor, {
      action: 'อัปเดตข้อมูลลูกค้า/เครื่องมือ',
      targetType: 'contract',
      targetId: existingContract.id,
      targetLabel: `${existingContract.contractCode} (${existingContract.clinicName})`,
      reason: reason || 'แก้ไขข้อมูลติดต่อ/เครื่องมือแพทย์โดยฝ่ายขาย',
      beforeSummary: `เครื่อง: ${existingContract.equipmentModel || '-'} | ผู้ติดต่อ: ${existingContract.contactPerson || '-'}`,
      afterSummary: `เครื่อง: ${salesPayload.equipmentModel || '-'} | ผู้ติดต่อ: ${salesPayload.contactPerson || '-'}`,
    });
  } else {
    const { payload } = buildContractPayloadBase(input);
    const merged = hydrateContract({
      ...existingContract,
      ...(payload as Partial<ContractRecord>),
      status: input.status,
    });
    const ledger = recalculateContractFromLedger(merged, linkedPayments);

    const updatePayload: Record<string, unknown> = {
      ...payload,
      waivedPenaltyAmount: round2(existingContract.waivedPenaltyAmount ?? 0),
      scheduleVersion: Math.max(1, Math.round(existingContract.scheduleVersion ?? 1)),
      paidAmount: ledger.totalEffectivePaid,
      prepaidAmount: ledger.prepaidFutureAmount,
      notDueAmount: ledger.notDuePrincipal,
      dueThisMonthAmount: ledger.dueThisMonthPrincipal,
      overdueAmount: ledger.overduePrincipal,
      creditGrade: input.creditGrade,
      status: input.status === 'suspended' ? 'suspended' : ledger.nextStatus,
      dueDate: ledger.nextDueDate,
      updatedAt: serverTimestamp(),
    };
    if (ledger.lastPaymentDate) {
      updatePayload.lastPaymentDate = ledger.lastPaymentDate;
    }

    batch.update(contractRef, updatePayload);
    addAuditToBatch(batch, actor, {
      action: 'แก้ไขข้อมูลสัญญา',
      targetType: 'contract',
      targetId: existingContract.id,
      targetLabel: `${existingContract.contractCode} (${input.clinicName})`,
      reason: reason || 'แก้ไขรายละเอียดสัญญาและคำนวณตารางงวดใหม่',
      beforeSummary: `ยอดรวม ${formatTHB(existingContract.totalAmount, 2)} | ${existingContract.totalInstallments} งวด | ผู้ดูแล: ${existingContract.salesRep}`,
      afterSummary: `ยอดรวม ${formatTHB(Number(updatePayload.totalAmount), 2)} | ${updatePayload.totalInstallments} งวด | ผู้ดูแล: ${updatePayload.salesRep}`,
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `contracts/${existingContract.id}`);
  }
}

export async function restructureContractSchedule(
  actor: ActorContext,
  contract: ContractRecord,
  linkedPayments: PaymentRecord[],
  params: {
    fromInstallment: number;
    newTotalInstallments: number;
    newMonthlyAmount: number;
    reason: string;
  }
): Promise<void> {
  const hydrated = hydrateContract(contract);
  const nextVersion = (hydrated.scheduleVersion || 1) + 1;

  const updatedDraft = hydrateContract({
    ...hydrated,
    restructuredFromInstallment: params.fromInstallment,
    restructuredTotalInstallments: params.newTotalInstallments,
    restructuredMonthlyAmount: round2(params.newMonthlyAmount),
    restructuredDate: getTodayISO(),
    scheduleVersion: nextVersion,
  });

  const ledger = recalculateContractFromLedger(updatedDraft, linkedPayments);
  const contractRef = doc(db, 'contracts', contract.id);
  const revisionRef = doc(collection(db, 'contracts', contract.id, 'revisions'));
  const batch = writeBatch(db);

  batch.set(revisionRef, {
    contractId: contract.id,
    version: hydrated.scheduleVersion || 1,
    reason: sanitizeStr(params.reason, FIELD_LIMITS.reasonMax),
    previousTotalInstallments: hydrated.restructuredTotalInstallments || hydrated.totalInstallments,
    previousMonthlyInstallment: hydrated.restructuredMonthlyAmount || hydrated.monthlyInstallment,
    previousStartDate: hydrated.startDate,
    newTotalInstallments: params.newTotalInstallments,
    newMonthlyInstallment: round2(params.newMonthlyAmount),
    restructuredFromInstallment: params.fromInstallment,
    changedByUid: actor.uid,
    changedByName: sanitizeStr(actor.name, FIELD_LIMITS.displayNameMax),
    createdAt: serverTimestamp(),
  });

  batch.update(contractRef, {
    ...buildLegacyBackfillFields(hydrated),
    restructuredFromInstallment: params.fromInstallment,
    restructuredTotalInstallments: params.newTotalInstallments,
    restructuredMonthlyAmount: round2(params.newMonthlyAmount),
    restructuredDate: getTodayISO(),
    scheduleVersion: nextVersion,
    paidAmount: ledger.totalEffectivePaid,
    prepaidAmount: ledger.prepaidFutureAmount,
    notDueAmount: ledger.notDuePrincipal,
    dueThisMonthAmount: ledger.dueThisMonthPrincipal,
    overdueAmount: ledger.overduePrincipal,
    creditGrade: ledger.suggestedGrade,
    status: ledger.nextStatus,
    dueDate: ledger.nextDueDate,
    updatedAt: serverTimestamp(),
  });

  addAuditToBatch(batch, actor, {
    action: 'ปรับโครงสร้างหนี้/ขยายงวด',
    targetType: 'contract',
    targetId: contract.id,
    targetLabel: `${contract.contractCode} (${contract.clinicName})`,
    reason: params.reason,
    beforeSummary: `งวดเดิม ${hydrated.restructuredTotalInstallments || hydrated.totalInstallments} งวด | งวดละ ${formatTHB(hydrated.restructuredMonthlyAmount || hydrated.monthlyInstallment, 2)} บาท`,
    afterSummary: `ขยายเป็น ${params.newTotalInstallments} งวด (เริ่มงวดที่ ${params.fromInstallment}) | งวดละ ${formatTHB(params.newMonthlyAmount, 2)} บาท`,
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `contracts/${contract.id}`);
  }
}

export async function waiveContractPenalty(
  actor: ActorContext,
  contract: ContractRecord,
  additionalWaiveAmount: number,
  reason: string
): Promise<void> {
  const hydrated = hydrateContract(contract);
  const newWaived = round2((hydrated.waivedPenaltyAmount || 0) + Math.max(0, additionalWaiveAmount));
  const contractRef = doc(db, 'contracts', contract.id);
  const batch = writeBatch(db);

  batch.update(contractRef, {
    ...buildLegacyBackfillFields(hydrated),
    waivedPenaltyAmount: newWaived,
    updatedAt: serverTimestamp(),
  });

  addAuditToBatch(batch, actor, {
    action: 'ยกเว้นเบี้ยปรับล่าช้า (Waive)',
    targetType: 'contract',
    targetId: contract.id,
    targetLabel: `${contract.contractCode} (${contract.clinicName})`,
    reason,
    beforeSummary: `ยกเว้นสะสมเดิม ${formatTHB(hydrated.waivedPenaltyAmount, 2)} บาท`,
    afterSummary: `ยกเว้นสะสมใหม่ ${formatTHB(newWaived, 2)} บาท (+${formatTHB(additionalWaiveAmount, 2)})`,
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `contracts/${contract.id}`);
  }
}

export async function deleteContractWithPayments(
  actor: ActorContext,
  contract: ContractRecord,
  linkedPayments: PaymentRecord[],
  reason?: string
): Promise<void> {
  const batch = writeBatch(db);
  linkedPayments.forEach((p) => {
    batch.delete(doc(db, 'payments', p.id));
    if (p.hasAttachment) {
      batch.delete(doc(db, 'paymentAttachments', p.id));
    }
  });
  batch.delete(doc(db, 'contracts', contract.id));

  addAuditToBatch(batch, actor, {
    action: 'ลบสัญญาถาวร',
    targetType: 'contract',
    targetId: contract.id,
    targetLabel: `${contract.contractCode} (${contract.clinicName})`,
    reason: reason || 'ลบสัญญาและรายการรับชำระที่เกี่ยวข้อง',
    beforeSummary: `ยอดรวม ${formatTHB(contract.totalAmount, 2)} บาท | ชำระแล้ว ${formatTHB(contract.paidAmount, 2)} บาท`,
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `contracts/${contract.id}`);
  }
}

export interface AttachmentUploadInput {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

export interface PaymentFormInput {
  actualCashAmount: number;
  whtRate: number;
  whtAmount: number;
  paymentType: PaymentType;
  paymentMethod: PaymentMethod;
  referenceNo: string;
  paidDate: string;
  note?: string;
  attachment?: AttachmentUploadInput | null;
}

async function loadAllPaymentsForContract(contractId: string): Promise<PaymentRecord[]> {
  const q = query(collection(db, 'payments'), where('contractId', '==', contractId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<PaymentRecord, 'id'>),
  }));
}

export async function recordContractPayment(
  actor: ActorContext,
  contract: ContractRecord,
  input: PaymentFormInput
): Promise<void> {
  const cash = clampAmount(input.actualCashAmount);
  const wht = clampAmount(input.whtAmount);
  const totalApplied = round2(cash + wht);
  if (totalApplied <= 0) {
    throw new Error('ยอดเงินรับโอนรวมภาษีหัก ณ ที่จ่ายต้องมากกว่า 0 บาท');
  }

  const hydrated = hydrateContract(contract);
  const paymentRef = doc(collection(db, 'payments'));
  const contractRef = doc(db, 'contracts', contract.id);

  const newPaymentObj: PaymentRecord = {
    id: paymentRef.id,
    ownerId: actor.uid,
    contractId: contract.id,
    contractAssignedRepUid: hydrated.assignedRepUid,
    clinicName: sanitizeStr(contract.clinicName, FIELD_LIMITS.clinicNameMax),
    contractCode: sanitizeStr(contract.contractCode, FIELD_LIMITS.contractCodeMax),
    actualCashAmount: cash,
    whtRate: Math.max(0, Math.min(15, round2(input.whtRate))),
    whtAmount: wht,
    amount: totalApplied,
    paymentType: input.paymentType,
    paymentMethod: input.paymentMethod,
    referenceNo: sanitizeStr(input.referenceNo, FIELD_LIMITS.referenceNoMax),
    paidDate: sanitizeStr(input.paidDate, FIELD_LIMITS.dueDateMax),
    hasAttachment: Boolean(input.attachment),
    attachmentFileName: input.attachment ? sanitizeStr(input.attachment.fileName, FIELD_LIMITS.attachmentNameMax) : undefined,
    isVoided: false,
    note: input.note ? sanitizeStr(input.note, FIELD_LIMITS.paymentNoteMax) : undefined,
  };

  try {
    const existingPayments = await loadAllPaymentsForContract(contract.id);
    const ledger = recalculateContractFromLedger(hydrated, [...existingPayments, newPaymentObj]);

    const batch = writeBatch(db);
    const paymentPayload: Record<string, unknown> = {
      ownerId: newPaymentObj.ownerId,
      contractId: newPaymentObj.contractId,
      contractAssignedRepUid: newPaymentObj.contractAssignedRepUid,
      clinicName: newPaymentObj.clinicName,
      contractCode: newPaymentObj.contractCode,
      actualCashAmount: newPaymentObj.actualCashAmount,
      whtRate: newPaymentObj.whtRate,
      whtAmount: newPaymentObj.whtAmount,
      amount: newPaymentObj.amount,
      paymentType: newPaymentObj.paymentType,
      paymentMethod: newPaymentObj.paymentMethod,
      referenceNo: newPaymentObj.referenceNo,
      paidDate: newPaymentObj.paidDate,
      hasAttachment: newPaymentObj.hasAttachment,
      isVoided: false,
      createdAt: serverTimestamp(),
    };
    if (newPaymentObj.attachmentFileName) paymentPayload.attachmentFileName = newPaymentObj.attachmentFileName;
    if (newPaymentObj.note) paymentPayload.note = newPaymentObj.note;

    batch.set(paymentRef, paymentPayload);

    if (input.attachment) {
      batch.set(doc(db, 'paymentAttachments', paymentRef.id), {
        ownerId: actor.uid,
        contractId: contract.id,
        contractAssignedRepUid: hydrated.assignedRepUid,
        paymentId: paymentRef.id,
        fileName: sanitizeStr(input.attachment.fileName, FIELD_LIMITS.attachmentNameMax),
        mimeType: sanitizeStr(input.attachment.mimeType || 'image/jpeg', 80),
        dataUrl: input.attachment.dataUrl.slice(0, FIELD_LIMITS.attachmentDataUrlMax),
        createdAt: serverTimestamp(),
      });
    }

    batch.update(contractRef, {
      ...buildLegacyBackfillFields(hydrated),
      paidAmount: ledger.totalEffectivePaid,
      prepaidAmount: ledger.prepaidFutureAmount,
      notDueAmount: ledger.notDuePrincipal,
      dueThisMonthAmount: ledger.dueThisMonthPrincipal,
      overdueAmount: ledger.overduePrincipal,
      lastPaymentDate: ledger.lastPaymentDate || input.paidDate,
      creditGrade: ledger.suggestedGrade,
      status: ledger.nextStatus,
      dueDate: ledger.nextDueDate,
      updatedAt: serverTimestamp(),
    });

    addAuditToBatch(batch, actor, {
      action: 'บันทึกรับชำระเงิน',
      targetType: 'payment',
      targetId: paymentRef.id,
      targetLabel: `${contract.contractCode} · ${newPaymentObj.referenceNo}`,
      beforeSummary: `ค้างชำระ ${formatTHB(contract.overdueAmount, 2)} | ชำระแล้ว ${formatTHB(contract.paidAmount, 2)}`,
      afterSummary: `รับโอน ${formatTHB(cash, 2)} + WHT ${formatTHB(wht, 2)} (รวม ${formatTHB(totalApplied, 2)}) | วันที่ ${input.paidDate}`,
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `payments/${paymentRef.id}`);
  }
}

export async function editContractPayment(
  actor: ActorContext,
  contract: ContractRecord,
  existingPayment: PaymentRecord,
  input: PaymentFormInput,
  editReason: string
): Promise<void> {
  if (!editReason.trim()) {
    throw new Error('กรุณาระบุเหตุผลในการแก้ไขบิลรับชำระ');
  }

  const cash = clampAmount(input.actualCashAmount);
  const wht = clampAmount(input.whtAmount);
  const totalApplied = round2(cash + wht);
  if (totalApplied <= 0) {
    throw new Error('ยอดเงินรับโอนรวมภาษีหัก ณ ที่จ่ายต้องมากกว่า 0 บาท');
  }

  const hydrated = hydrateContract(contract);
  const paymentRef = doc(db, 'payments', existingPayment.id);
  const contractRef = doc(db, 'contracts', contract.id);

  try {
    const existingPayments = await loadAllPaymentsForContract(contract.id);
    const updatedPaymentObj: PaymentRecord = {
      ...existingPayment,
      actualCashAmount: cash,
      whtRate: Math.max(0, Math.min(15, round2(input.whtRate))),
      whtAmount: wht,
      amount: totalApplied,
      paymentType: input.paymentType,
      paymentMethod: input.paymentMethod,
      referenceNo: sanitizeStr(input.referenceNo, FIELD_LIMITS.referenceNoMax),
      paidDate: sanitizeStr(input.paidDate, FIELD_LIMITS.dueDateMax),
      hasAttachment: Boolean(input.attachment) || existingPayment.hasAttachment,
      attachmentFileName: input.attachment
        ? sanitizeStr(input.attachment.fileName, FIELD_LIMITS.attachmentNameMax)
        : existingPayment.attachmentFileName,
      editReason: sanitizeStr(editReason, FIELD_LIMITS.reasonMax),
      note: input.note ? sanitizeStr(input.note, FIELD_LIMITS.paymentNoteMax) : '',
    };

    const nextPayments = existingPayments.map((p) =>
      p.id === existingPayment.id ? updatedPaymentObj : p
    );
    const ledger = recalculateContractFromLedger(hydrated, nextPayments);

    const batch = writeBatch(db);
    const updatePaymentPayload: Record<string, unknown> = {
      actualCashAmount: updatedPaymentObj.actualCashAmount,
      whtRate: updatedPaymentObj.whtRate,
      whtAmount: updatedPaymentObj.whtAmount,
      amount: updatedPaymentObj.amount,
      paymentType: updatedPaymentObj.paymentType,
      paymentMethod: updatedPaymentObj.paymentMethod,
      referenceNo: updatedPaymentObj.referenceNo,
      paidDate: updatedPaymentObj.paidDate,
      hasAttachment: updatedPaymentObj.hasAttachment,
      editReason: updatedPaymentObj.editReason,
      note: updatedPaymentObj.note || '',
      updatedAt: serverTimestamp(),
    };
    if (updatedPaymentObj.attachmentFileName) {
      updatePaymentPayload.attachmentFileName = updatedPaymentObj.attachmentFileName;
    }

    batch.update(paymentRef, updatePaymentPayload);

    if (input.attachment) {
      const attRef = doc(db, 'paymentAttachments', existingPayment.id);
      const attSnap = await getDoc(attRef);
      if (attSnap.exists()) {
        batch.update(attRef, {
          fileName: sanitizeStr(input.attachment.fileName, FIELD_LIMITS.attachmentNameMax),
          mimeType: sanitizeStr(input.attachment.mimeType || 'image/jpeg', 80),
          dataUrl: input.attachment.dataUrl.slice(0, FIELD_LIMITS.attachmentDataUrlMax),
        });
      } else {
        batch.set(attRef, {
          ownerId: actor.uid,
          contractId: contract.id,
          contractAssignedRepUid: hydrated.assignedRepUid,
          paymentId: existingPayment.id,
          fileName: sanitizeStr(input.attachment.fileName, FIELD_LIMITS.attachmentNameMax),
          mimeType: sanitizeStr(input.attachment.mimeType || 'image/jpeg', 80),
          dataUrl: input.attachment.dataUrl.slice(0, FIELD_LIMITS.attachmentDataUrlMax),
          createdAt: serverTimestamp(),
        });
      }
    }

    const contractUpdatePayload: Record<string, unknown> = {
      ...buildLegacyBackfillFields(hydrated),
      paidAmount: ledger.totalEffectivePaid,
      prepaidAmount: ledger.prepaidFutureAmount,
      notDueAmount: ledger.notDuePrincipal,
      dueThisMonthAmount: ledger.dueThisMonthPrincipal,
      overdueAmount: ledger.overduePrincipal,
      creditGrade: ledger.suggestedGrade,
      status: ledger.nextStatus,
      dueDate: ledger.nextDueDate,
      updatedAt: serverTimestamp(),
    };
    if (ledger.lastPaymentDate) {
      contractUpdatePayload.lastPaymentDate = ledger.lastPaymentDate;
    }
    batch.update(contractRef, contractUpdatePayload);

    addAuditToBatch(batch, actor, {
      action: 'แก้ไขบิลรับชำระเงิน',
      targetType: 'payment',
      targetId: existingPayment.id,
      targetLabel: `${contract.contractCode} · ${updatedPaymentObj.referenceNo}`,
      reason: editReason,
      beforeSummary: `ยอดเดิม ${formatTHB(existingPayment.amount, 2)} (เงินสด ${formatTHB(existingPayment.actualCashAmount ?? existingPayment.amount, 2)} + WHT ${formatTHB(existingPayment.whtAmount ?? 0, 2)}) วันที่ ${existingPayment.paidDate}`,
      afterSummary: `ยอดใหม่ ${formatTHB(totalApplied, 2)} (เงินสด ${formatTHB(cash, 2)} + WHT ${formatTHB(wht, 2)}) วันที่ ${input.paidDate}`,
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `payments/${existingPayment.id}`);
  }
}

export async function voidContractPayment(
  actor: ActorContext,
  contract: ContractRecord,
  existingPayment: PaymentRecord,
  voidReason: string
): Promise<void> {
  if (!voidReason.trim()) {
    throw new Error('กรุณาระบุเหตุผลในการยกเลิกบิล (Void)');
  }

  const hydrated = hydrateContract(contract);
  const paymentRef = doc(db, 'payments', existingPayment.id);
  const contractRef = doc(db, 'contracts', contract.id);

  try {
    const existingPayments = await loadAllPaymentsForContract(contract.id);
    const nextPayments = existingPayments.map((p) =>
      p.id === existingPayment.id ? { ...p, isVoided: true, voidReason } : p
    );
    const ledger = recalculateContractFromLedger(hydrated, nextPayments);

    const batch = writeBatch(db);
    batch.update(paymentRef, {
      isVoided: true,
      voidReason: sanitizeStr(voidReason, FIELD_LIMITS.reasonMax),
      updatedAt: serverTimestamp(),
    });

    const contractUpdatePayload: Record<string, unknown> = {
      ...buildLegacyBackfillFields(hydrated),
      paidAmount: ledger.totalEffectivePaid,
      prepaidAmount: ledger.prepaidFutureAmount,
      notDueAmount: ledger.notDuePrincipal,
      dueThisMonthAmount: ledger.dueThisMonthPrincipal,
      overdueAmount: ledger.overduePrincipal,
      creditGrade: ledger.suggestedGrade,
      status: ledger.nextStatus,
      dueDate: ledger.nextDueDate,
      updatedAt: serverTimestamp(),
    };
    if (ledger.lastPaymentDate) {
      contractUpdatePayload.lastPaymentDate = ledger.lastPaymentDate;
    } else {
      contractUpdatePayload.lastPaymentDate = '';
    }
    batch.update(contractRef, contractUpdatePayload);

    addAuditToBatch(batch, actor, {
      action: 'ยกเลิกบิลรับชำระเงิน (Void)',
      targetType: 'payment',
      targetId: existingPayment.id,
      targetLabel: `${contract.contractCode} · ${existingPayment.referenceNo}`,
      reason: voidReason,
      beforeSummary: `บิลยอด ${formatTHB(existingPayment.amount, 2)} บาท (วันที่ ${existingPayment.paidDate})`,
      afterSummary: `สถานะยกเลิก (Void) และคำนวณยอดหนี้สัญญาใหม่ทันที`,
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `payments/${existingPayment.id}`);
  }
}

export async function fetchPaymentAttachment(
  paymentId: string
): Promise<PaymentAttachmentRecord | null> {
  try {
    const snap = await getDoc(doc(db, 'paymentAttachments', paymentId));
    if (!snap.exists()) return null;
    return {
      id: snap.id,
      ...(snap.data() as Omit<PaymentAttachmentRecord, 'id'>),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `paymentAttachments/${paymentId}`);
  }
}

export async function addCollectionLog(
  actor: ActorContext,
  contract: ContractRecord,
  input: {
    contactDate: string;
    contactPerson: string;
    channel: CollectionChannel;
    promiseToPayDate?: string;
    note: string;
  }
): Promise<void> {
  const logRef = doc(collection(db, 'collectionLogs'));
  const hydrated = hydrateContract(contract);
  const batch = writeBatch(db);

  const payload: Record<string, unknown> = {
    ownerId: actor.uid,
    authorName: sanitizeStr(actor.name, FIELD_LIMITS.displayNameMax),
    contractId: contract.id,
    assignedRepUid: hydrated.assignedRepUid,
    contractCode: sanitizeStr(contract.contractCode, FIELD_LIMITS.contractCodeMax),
    clinicName: sanitizeStr(contract.clinicName, FIELD_LIMITS.clinicNameMax),
    contactDate: sanitizeStr(input.contactDate, FIELD_LIMITS.dueDateMax),
    contactPerson: sanitizeStr(input.contactPerson, FIELD_LIMITS.contactPersonMax),
    channel: input.channel,
    note: sanitizeStr(input.note, FIELD_LIMITS.notesMax),
    createdAt: serverTimestamp(),
  };
  if (input.promiseToPayDate) {
    payload.promiseToPayDate = sanitizeStr(input.promiseToPayDate, FIELD_LIMITS.dueDateMax);
  }

  batch.set(logRef, payload);

  addAuditToBatch(batch, actor, {
    action: 'บันทึกการติดตามทวงถาม',
    targetType: 'contract',
    targetId: contract.id,
    targetLabel: `${contract.contractCode} (${contract.clinicName})`,
    afterSummary: `${input.channel} | ผู้ติดต่อ: ${input.contactPerson}${input.promiseToPayDate ? ` | นัดชำระ: ${input.promiseToPayDate}` : ''}`,
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `collectionLogs/${logRef.id}`);
  }
}

export async function fetchContractRevisions(
  contractId: string
): Promise<Array<Record<string, unknown> & { id: string }>> {
  try {
    const snap = await getDocs(collection(db, 'contracts', contractId, 'revisions'));
    const rows: Array<Record<string, unknown> & { id: string }> = snap.docs.map((d) => ({
      ...(d.data() as Record<string, unknown>),
      id: d.id,
    }));
    return rows.sort((a, b) => Number(b['version'] || 0) - Number(a['version'] || 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `contracts/${contractId}/revisions`);
  }
}

export async function resetWorkspaceData(
  actor: ActorContext,
  contracts: ContractRecord[],
  payments: PaymentRecord[]
): Promise<void> {
  // Super Admin workspace reset (chunks of 400 writes per Firestore 500 batch limit)
  try {
    const logsSnap = await getDocs(collection(db, 'collectionLogs'));
    const ops: Array<(batch: WriteBatch) => void> = [];

    payments.forEach((p) => {
      ops.push((b) => b.delete(doc(db, 'payments', p.id)));
      if (p.hasAttachment) {
        ops.push((b) => b.delete(doc(db, 'paymentAttachments', p.id)));
      }
    });
    logsSnap.docs.forEach((d) => {
      ops.push((b) => b.delete(d.ref));
    });
    contracts.forEach((c) => {
      ops.push((b) => b.delete(doc(db, 'contracts', c.id)));
    });

    for (let i = 0; i < ops.length; i += 400) {
      const chunk = ops.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach((fn) => fn(batch));
      await batch.commit();
    }

    const auditBatch = writeBatch(db);
    addAuditToBatch(auditBatch, actor, {
      action: 'รีเซ็ตข้อมูลพอร์ตลูกหนี้ทั้งระบบ',
      targetType: 'system',
      targetId: 'workspace',
      targetLabel: 'Value E-billing Workspace',
      reason: 'ล้างข้อมูลสัญญา บิลรับชำระ และบันทึกติดตามหนี้โดยผู้บริหาร',
      beforeSummary: `${contracts.length} สัญญา, ${payments.length} รายการรับชำระ`,
      afterSummary: '0 สัญญา (พร้อมเริ่มต้นใหม่)',
    });
    await auditBatch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'contracts');
  }
}

export async function logSystemBackupAction(actor: ActorContext, countSummary: string): Promise<void> {
  const batch = writeBatch(db);
  addAuditToBatch(batch, actor, {
    action: 'สำรองข้อมูลระบบ (JSON Backup)',
    targetType: 'system',
    targetId: 'backup',
    targetLabel: 'Value E-billing Backup',
    afterSummary: countSummary,
  });
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'auditLogs');
  }
}

export async function compressAttachmentFile(file: File): Promise<AttachmentUploadInput> {
  if (file.type === 'application/pdf') {
    if (file.size > 300 * 1024) {
      throw new Error('ไฟล์ PDF ต้องมีขนาดไม่เกิน 300 KB (หรืออัปโหลดเป็นรูปภาพ PNG/JPG ระบบจะย่อขนาดให้อัตโนมัติ)');
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ PDF ได้'));
      reader.readAsDataURL(file);
    });
    return { fileName: file.name, mimeType: file.type, dataUrl };
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('รองรับเฉพาะไฟล์รูปภาพ (JPG, PNG, WEBP) หรือ PDF ขนาดไม่เกิน 300 KB');
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1200;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('ไม่สามารถประมวลผลรูปภาพได้'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.72);
        if (compressed.length > FIELD_LIMITS.attachmentDataUrlMax) {
          resolve(canvas.toDataURL('image/jpeg', 0.5));
        } else {
          resolve(compressed);
        }
      };
      img.onerror = () => reject(new Error('ไฟล์รูปภาพไม่ถูกต้อง'));
      img.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
    reader.readAsDataURL(file);
  });

  return { fileName: file.name, mimeType: 'image/jpeg', dataUrl };
}

export async function migrateLegacyUserContractStatus(contract: ContractRecord): Promise<void> {
  // Helper left available if direct status update is ever needed
  await updateDoc(doc(db, 'contracts', contract.id), {
    updatedAt: serverTimestamp(),
  });
}
