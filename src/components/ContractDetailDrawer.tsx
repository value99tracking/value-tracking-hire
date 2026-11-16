import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Building2,
  Calculator,
  CalendarClock,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  History,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  ShieldAlert,
  Stethoscope,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import {
  COLLECTION_CHANNELS,
  CONTRACT_TYPE_LABELS_TH,
  FIELD_LIMITS,
  INSTALLMENT_STATUS_LABELS_TH,
  PAYMENT_METHOD_LABELS_TH,
  REGION_LABELS_TH,
  STATUS_LABELS_TH,
  type CollectionChannel,
  type CollectionLogRecord,
  type ContractRecord,
  type PaymentRecord,
  type UserRole,
} from '../types/billing';
import {
  addCollectionLog,
  deleteContractWithPayments,
  fetchContractRevisions,
  formatTHB,
  restructureContractSchedule,
  voidContractPayment,
  waiveContractPenalty,
  type ActorContext,
} from '../lib/billingService';
import {
  calculateEarlySettlement,
  formatLineCollectionMessage,
  getTodayISO,
  hydrateContract,
  recalculateContractFromLedger,
  round2,
} from '../lib/debtEngine';

interface ContractDetailDrawerProps {
  contract: ContractRecord | null;
  allContracts: ContractRecord[];
  payments: PaymentRecord[];
  collectionLogs: CollectionLogRecord[];
  actor: ActorContext;
  userRole: UserRole;
  onClose: () => void;
  onSelectContract: (contract: ContractRecord) => void;
  onEditContract: (contract: ContractRecord) => void;
  onRecordPayment: (contract: ContractRecord) => void;
  onEditPayment: (contract: ContractRecord, payment: PaymentRecord) => void;
  onViewAttachment: (payment: PaymentRecord) => void;
}

type DrawerSection = 'schedule' | 'payments' | 'crm' | 'restructure';

export function ContractDetailDrawer({
  contract,
  allContracts,
  payments,
  collectionLogs,
  actor,
  userRole,
  onClose,
  onSelectContract,
  onEditContract,
  onRecordPayment,
  onEditPayment,
  onViewAttachment,
}: ContractDetailDrawerProps) {
  const [section, setSection] = useState<DrawerSection>('schedule');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copiedLine, setCopiedLine] = useState(false);

  // CRM Log state
  const [contactDate, setContactDate] = useState(getTodayISO());
  const [contactPerson, setContactPerson] = useState('');
  const [channel, setChannel] = useState<CollectionChannel>('โทรศัพท์');
  const [promiseToPayDate, setPromiseToPayDate] = useState('');
  const [crmNote, setCrmNote] = useState('');
  const [savingCrm, setSavingCrm] = useState(false);

  // Waive Penalty state (Super Admin only)
  const [waiveOpen, setWaiveOpen] = useState(false);
  const [waiveAmount, setWaiveAmount] = useState('');
  const [waiveReason, setWaiveReason] = useState('');
  const [savingWaive, setSavingWaive] = useState(false);

  // Void Payment state (Accounting / Super Admin)
  const [voidTarget, setVoidTarget] = useState<PaymentRecord | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [savingVoid, setSavingVoid] = useState(false);

  // Early Settlement & Restructuring state
  const [earlyDiscountPct, setEarlyDiscountPct] = useState('3');
  const [fromInstallment, setFromInstallment] = useState('1');
  const [newTotalInstallments, setNewTotalInstallments] = useState('18');
  const [newMonthlyAmount, setNewMonthlyAmount] = useState('');
  const [restructureReason, setRestructureReason] = useState('');
  const [savingRestructure, setSavingRestructure] = useState(false);
  const [revisions, setRevisions] = useState<Array<Record<string, unknown>>>([]);
  const [actionError, setActionError] = useState('');

  const hydrated = useMemo(() => (contract ? hydrateContract(contract) : null), [contract]);

  const contractPayments = useMemo(() => {
    if (!contract) return [];
    return payments.filter((p) => p.contractId === contract.id);
  }, [contract, payments]);

  const ledger = useMemo(() => {
    if (!hydrated) return null;
    return recalculateContractFromLedger(hydrated, contractPayments);
  }, [hydrated, contractPayments]);

  const contractLogs = useMemo(() => {
    if (!contract) return [];
    return collectionLogs.filter((l) => l.contractId === contract.id);
  }, [contract, collectionLogs]);

  const siblingContracts = useMemo(() => {
    if (!hydrated?.parentClinicName) return [];
    return allContracts.filter(
      (c) =>
        c.id !== hydrated.id &&
        (c.parentClinicName || '').trim().toLowerCase() ===
          hydrated.parentClinicName!.trim().toLowerCase()
    );
  }, [allContracts, hydrated]);

  useEffect(() => {
    if (!contract || !ledger || !hydrated) return;
    setActionError('');
    setConfirmDelete(false);
    setWaiveOpen(false);
    setVoidTarget(null);
    setContactPerson(hydrated.contactPerson || '');
    const nextInst = ledger.nextInstallmentNo || 1;
    setFromInstallment(String(nextInst));
    const currentTotal = hydrated.restructuredTotalInstallments || hydrated.totalInstallments;
    setNewTotalInstallments(String(currentTotal + 6));
    const remainingPrincipal = round2(
      ledger.overduePrincipal + ledger.dueThisMonthPrincipal + ledger.notDuePrincipal
    );
    const futureCount = Math.max(1, currentTotal + 6 - nextInst + 1);
    setNewMonthlyAmount(String(round2(remainingPrincipal / futureCount)));

    void fetchContractRevisions(contract.id).then(setRevisions).catch(() => setRevisions([]));
  }, [contract?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!contract || !hydrated || !ledger) return null;

  const canRecordOrEditPayment = userRole === 'accounting' || userRole === 'super_admin';
  const canDeleteContract = userRole === 'super_admin';
  const canWaivePenalty = userRole === 'super_admin';
  const canRestructure = userRole === 'accounting' || userRole === 'super_admin';
  const earlyQuote = calculateEarlySettlement(ledger, Number(earlyDiscountPct) || 0);

  const handleCopyLine = async () => {
    const msg = formatLineCollectionMessage(hydrated, ledger);
    try {
      await navigator.clipboard.writeText(msg);
      setCopiedLine(true);
      setTimeout(() => setCopiedLine(false), 2500);
    } catch {
      setActionError('ไม่สามารถคัดลอกข้อความอัตโนมัติได้');
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setActionError('');
    try {
      await deleteContractWithPayments(actor, hydrated, contractPayments);
      setConfirmDelete(false);
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'ไม่สามารถลบสัญญาได้');
    } finally {
      setDeleting(false);
    }
  };

  const handleAddCollectionLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crmNote.trim() || !contactPerson.trim()) return;
    setSavingCrm(true);
    setActionError('');
    try {
      await addCollectionLog(actor, hydrated, {
        contactDate,
        contactPerson: contactPerson.trim(),
        channel,
        promiseToPayDate: promiseToPayDate || undefined,
        note: crmNote.trim(),
      });
      setCrmNote('');
      setPromiseToPayDate('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'บันทึกติดตามทวงถามไม่สำเร็จ');
    } finally {
      setSavingCrm(false);
    }
  };

  const handleWaivePenalty = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(waiveAmount) || 0;
    if (amt <= 0 || !waiveReason.trim()) return;
    setSavingWaive(true);
    setActionError('');
    try {
      await waiveContractPenalty(actor, hydrated, amt, waiveReason.trim());
      setWaiveOpen(false);
      setWaiveAmount('');
      setWaiveReason('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'ไม่สามารถยกเว้นเบี้ยปรับได้');
    } finally {
      setSavingWaive(false);
    }
  };

  const handleVoidPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTarget || !voidReason.trim()) return;
    setSavingVoid(true);
    setActionError('');
    try {
      await voidContractPayment(actor, hydrated, voidTarget, voidReason.trim());
      setVoidTarget(null);
      setVoidReason('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'ไม่สามารถยกเลิกบิลได้');
    } finally {
      setSavingVoid(false);
    }
  };

  const handleRestructure = async (e: React.FormEvent) => {
    e.preventDefault();
    const fromNo = Math.max(1, Number(fromInstallment) || 1);
    const nextTotal = Math.max(fromNo, Number(newTotalInstallments) || fromNo);
    const nextMonthly = Number(newMonthlyAmount) || 0;
    if (!restructureReason.trim() || nextMonthly <= 0) {
      setActionError('กรุณากรอกค่างวดใหม่และเหตุผลการปรับโครงสร้างหนี้');
      return;
    }
    setSavingRestructure(true);
    setActionError('');
    try {
      await restructureContractSchedule(actor, hydrated, contractPayments, {
        fromInstallment: fromNo,
        newTotalInstallments: nextTotal,
        newMonthlyAmount: nextMonthly,
        reason: restructureReason.trim(),
      });
      setRestructureReason('');
      const rev = await fetchContractRevisions(hydrated.id);
      setRevisions(rev);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'ไม่สามารถปรับโครงสร้างหนี้ได้');
    } finally {
      setSavingRestructure(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/45 backdrop-blur-[1px] flex justify-end">
      <div className="bg-white border-l border-slate-200 w-full max-w-2xl h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono font-semibold text-slate-600">
                {hydrated.contractCode}
              </span>
              <span className="px-2 py-0.5 rounded bg-[#082F4E] text-white font-semibold">
                {CONTRACT_TYPE_LABELS_TH[hydrated.contractType] || hydrated.contractType}
              </span>
              <span className="text-slate-500">{REGION_LABELS_TH[hydrated.region]}</span>
              {ledger.shouldSuspendPM && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-600 text-white font-bold">
                  <Wrench className="w-3 h-3" />
                  ชะลอการเข้าซ่อมบำรุง (PM) ชั่วคราว (ค้าง {ledger.maxOverdueDays} วัน)
                </span>
              )}
            </div>
            <h3 className="text-lg font-bold text-slate-900 mt-1 truncate">{hydrated.clinicName}</h3>
            {hydrated.parentClinicName && (
              <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                <span>เครือคลินิกแม่: {hydrated.parentClinicName}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyLine}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 cursor-pointer whitespace-nowrap"
            >
              {copiedLine ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedLine ? 'คัดลอกข้อความ LINE แล้ว' : 'คัดลอกแจ้งเตือน LINE'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {actionError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {actionError}
            </div>
          )}

          {/* Hero Financial Summary */}
          <div className="bg-[#082F4E] text-white rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs text-sky-200">มูลค่าสัญญารวม (รวม VAT 7%)</div>
                <div className="text-2xl font-bold font-mono-num mt-0.5">
                  {formatTHB(hydrated.totalAmount, 2)} บาท
                </div>
                <div className="text-[11px] text-sky-200/80 mt-0.5 font-mono-num">
                  ก่อน VAT {formatTHB(hydrated.amountBeforeVat, 2)} + VAT {formatTHB(hydrated.vatAmount, 2)} · เงินดาวน์ {formatTHB(hydrated.downPayment, 2)}
                </div>
              </div>
              <div className="text-right">
                <span className="inline-block px-2.5 py-1 rounded-lg bg-white/15 text-xs font-bold">
                  เกรด {ledger.suggestedGrade} · {STATUS_LABELS_TH[ledger.nextStatus]}
                </span>
                {hydrated.securityDeposit > 0 && (
                  <div className="text-[11px] text-amber-200 mt-1.5 font-mono-num">
                    เงินประกันสัญญาเช่า (แยกบัญชี): {formatTHB(hydrated.securityDeposit, 2)} บ.
                  </div>
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-white/15 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <div className="text-sky-200/80">ชำระแล้ว (สด+WHT)</div>
                <div className="font-bold font-mono-num text-emerald-300">
                  {formatTHB(ledger.totalEffectivePaid, 2)}
                </div>
                <div className="text-[10px] text-sky-200/75">
                  ล่าสุด: {ledger.lastPaymentDate || '-'}
                </div>
              </div>
              <div>
                <div className="text-sky-200/80">ค้างชำระ</div>
                <div className="font-bold font-mono-num text-rose-300">
                  {formatTHB(ledger.overduePrincipal, 2)}
                </div>
              </div>
              <div>
                <div className="text-sky-200/80">ครบกำหนดเดือนนี้</div>
                <div className="font-bold font-mono-num">
                  {formatTHB(ledger.dueThisMonthPrincipal, 2)}
                </div>
              </div>
              <div>
                <div className="text-sky-200/80">ยังไม่ครบกำหนด</div>
                <div className="font-bold font-mono-num">
                  {formatTHB(ledger.notDuePrincipal, 2)}
                </div>
              </div>
            </div>
          </div>

          {/* Integrity Check */}
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-emerald-900 font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>ตรวจสอบสมดุลยอดหนี้ (Source-of-Truth Integrity Check)</span>
            </div>
            <div className="font-mono-num text-emerald-800">
              ยอดจัดงวด {formatTHB(ledger.integrityCheck.financedTotal, 2)} = ยอดรวมจัดสรร{' '}
              {formatTHB(ledger.integrityCheck.reconciledSum, 2)} (ผลต่าง{' '}
              {formatTHB(ledger.integrityCheck.discrepancy, 2)} บ.)
            </div>
          </div>

          {/* Customer, Equipment & Parent Siblings Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1.5">
              <div className="font-bold text-slate-800 mb-1">ข้อมูลลูกค้าและผู้ดูแล</div>
              <div>
                <span className="text-slate-500">ผู้ดูแลลูกหนี้:</span>{' '}
                <span className="font-semibold text-slate-900">{hydrated.salesRep}</span>
              </div>
              <div>
                <span className="text-slate-500">ผู้ติดต่อ:</span>{' '}
                <span className="font-semibold text-slate-900">
                  {hydrated.contactPerson || '-'} {hydrated.contactPhone ? `(${hydrated.contactPhone})` : ''}
                </span>
              </div>
              <div>
                <span className="text-slate-500">เลขผู้เสียภาษี:</span>{' '}
                <span className="font-mono text-slate-900">{hydrated.taxId || '-'}</span>
              </div>
              <div>
                <span className="text-slate-500">ที่อยู่:</span>{' '}
                <span className="text-slate-700">{hydrated.companyAddress || '-'}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="font-bold text-slate-800 mb-1 flex items-center gap-1.5">
                <Stethoscope className="w-3.5 h-3.5 text-[#082F4E]" />
                <span>ข้อมูลเครื่องมือแพทย์และประกัน</span>
              </div>
              <div>
                <span className="text-slate-500">รุ่นเครื่อง:</span>{' '}
                <span className="font-semibold text-slate-900">{hydrated.equipmentModel || '-'}</span>
              </div>
              <div>
                <span className="text-slate-500">หมายเลขเครื่อง (S/N):</span>{' '}
                <span className="font-mono text-slate-900">{hydrated.serialNumber || '-'}</span>
              </div>
              <div>
                <span className="text-slate-500">วันส่งมอบ:</span>{' '}
                <span className="font-mono-num text-slate-900">{hydrated.deliveryDate || '-'}</span>
              </div>
              <div>
                <span className="text-slate-500">หมดประกันตัวเครื่อง:</span>{' '}
                <span className="font-mono-num text-slate-900">{hydrated.warrantyEndDate || '-'}</span>
              </div>
            </div>

            {siblingContracts.length > 0 && (
              <div className="sm:col-span-2 pt-3 border-t border-slate-200">
                <div className="text-[11px] font-bold text-slate-700 mb-1.5">
                  สัญญาอื่นภายใต้เครือ {hydrated.parentClinicName} ({siblingContracts.length} สัญญา)
                </div>
                <div className="flex flex-wrap gap-2">
                  {siblingContracts.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onSelectContract(s)}
                      className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-semibold text-[#082F4E] hover:bg-sky-50 cursor-pointer"
                    >
                      {s.contractCode} — {s.clinicName}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Drawer Section Tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
            {[
              { id: 'schedule', label: `ตารางงวด (${ledger.installments.length})` },
              { id: 'payments', label: `ประวัติรับชำระ (${contractPayments.length})` },
              { id: 'crm', label: `ติดตามหนี้ (${contractLogs.length})` },
              { id: 'restructure', label: 'ปิดบัญชี / ปรับโครงสร้าง' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSection(t.id as DrawerSection)}
                className={`flex-1 py-2 px-3 text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer transition-colors ${
                  section === t.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Section 1: Installment Schedule */}
          {section === 'schedule' && (
            <div className="space-y-3">
              {/* Late Penalty Summary Bar */}
              <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <div className="font-bold text-amber-900">
                    เบี้ยปรับล่าช้า ({hydrated.penaltyRatePercent}%/เดือน):{' '}
                    <span className="font-mono-num">{formatTHB(ledger.netPenalty, 2)} บาท</span>
                  </div>
                  <div className="text-[11px] text-amber-800">
                    เบี้ยปรับคำนวณรวม {formatTHB(ledger.grossPenalty, 2)} บ. · ยกเว้นแล้ว (Waive){' '}
                    {formatTHB(ledger.waivedPenalty, 2)} บ.
                  </div>
                </div>
                {canWaivePenalty && ledger.netPenalty > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setWaiveAmount(String(ledger.netPenalty));
                      setWaiveOpen((v) => !v);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-amber-900 bg-white border border-amber-300 rounded-lg hover:bg-amber-100 cursor-pointer"
                  >
                    ยกเว้นเบี้ยปรับ (Waive)
                  </button>
                )}
              </div>

              {waiveOpen && canWaivePenalty && (
                <form
                  onSubmit={handleWaivePenalty}
                  className="bg-white border border-amber-300 rounded-xl p-4 space-y-3 text-xs"
                >
                  <div className="font-bold text-slate-900">
                    อนุมัติยกเว้นเบี้ยปรับล่าช้า (เฉพาะผู้บริหาร)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        จำนวนเงินที่ยกเว้น (บาท) *
                      </label>
                      <input
                        type="number"
                        required
                        min={1}
                        step="0.01"
                        value={waiveAmount}
                        onChange={(e) => setWaiveAmount(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        เหตุผลการยกเว้น *
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={FIELD_LIMITS.reasonMax}
                        value={waiveReason}
                        onChange={(e) => setWaiveReason(e.target.value)}
                        placeholder="เช่น ลูกค้าโอนล่าช้าเนื่องจากระบบธนาคาร"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setWaiveOpen(false)}
                      className="px-3 py-1.5 border border-slate-200 rounded-lg cursor-pointer"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="submit"
                      disabled={savingWaive}
                      className="px-3 py-1.5 bg-[#082F4E] text-white font-semibold rounded-lg cursor-pointer"
                    >
                      {savingWaive ? 'กำลังบันทึก...' : 'ยืนยันยกเว้นเบี้ยปรับ'}
                    </button>
                  </div>
                </form>
              )}

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                      <th className="py-2.5 px-3">งวด</th>
                      <th className="py-2.5 px-3">ครบกำหนด</th>
                      <th className="py-2.5 px-3 text-right">ยอดงวด</th>
                      <th className="py-2.5 px-3 text-right">ตัดชำระ</th>
                      <th className="py-2.5 px-3 text-right">คงเหลือ</th>
                      <th className="py-2.5 px-3 text-center">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ledger.installments.map((row) => (
                      <tr key={row.installmentNo} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-3 font-mono font-semibold text-slate-800">
                          {row.installmentNo}/{row.totalCount}
                        </td>
                        <td className="py-2.5 px-3 font-mono-num text-slate-700">
                          <div>{row.dueDate}</div>
                          {row.paymentDates.length > 0 && (
                            <div className="text-[10px] text-emerald-700">
                              ชำระ: {row.paymentDates.join(', ')}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-num text-slate-900">
                          {formatTHB(row.scheduledAmount, 2)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-num text-emerald-700 font-semibold">
                          {formatTHB(row.paidAmount, 2)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-num font-semibold text-slate-900">
                          {formatTHB(row.remainingAmount, 2)}
                          {row.penaltyAmount > 0 && (
                            <div className="text-[10px] text-rose-600">
                              +ปรับ {formatTHB(row.penaltyAmount, 2)}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                              row.status === 'paid'
                                ? 'bg-emerald-50 text-emerald-700'
                                : row.status === 'partial'
                                  ? 'bg-amber-100 text-amber-800'
                                  : row.status === 'overdue'
                                    ? 'bg-rose-100 text-rose-700'
                                    : row.status === 'due_this_month'
                                      ? 'bg-sky-100 text-sky-800'
                                      : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {INSTALLMENT_STATUS_LABELS_TH[row.status]}
                            {row.overdueDays > 0 ? ` (${row.overdueDays}ว.)` : ''}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Section 2: Payment History (Edit/Void/Attachment) */}
          {section === 'payments' && (
            <div className="space-y-3">
              {voidTarget && (
                <form
                  onSubmit={handleVoidPayment}
                  className="bg-rose-50 border border-rose-200 rounded-xl p-4 space-y-2.5 text-xs"
                >
                  <div className="font-bold text-rose-900">
                    ยืนยันการยกเลิกบิล (Void): {voidTarget.referenceNo} ({formatTHB(voidTarget.amount, 2)} บ.)
                  </div>
                  <input
                    type="text"
                    required
                    maxLength={FIELD_LIMITS.reasonMax}
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="ระบุเหตุผลการยกเลิกบิล (บังคับ)..."
                    className="w-full px-3 py-2 bg-white border border-rose-200 rounded-lg"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setVoidTarget(null)}
                      className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg cursor-pointer"
                    >
                      ปิด
                    </button>
                    <button
                      type="submit"
                      disabled={savingVoid}
                      className="px-3 py-1.5 bg-rose-600 text-white font-semibold rounded-lg cursor-pointer"
                    >
                      {savingVoid ? 'กำลังยกเลิก...' : 'ยืนยัน Void บิลและคำนวณหนี้ใหม่'}
                    </button>
                  </div>
                </form>
              )}

              {contractPayments.length === 0 ? (
                <div className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
                  ยังไม่มีประวัติการรับชำระเงินสำหรับสัญญานี้
                </div>
              ) : (
                contractPayments.map((pay) => (
                  <div
                    key={pay.id}
                    className={`p-3.5 border rounded-xl text-xs space-y-2 ${
                      pay.isVoided
                        ? 'bg-slate-100/80 border-slate-200 opacity-70'
                        : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-900">
                            {pay.referenceNo}
                          </span>
                          {pay.isVoided && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-bold">
                              ยกเลิกแล้ว (VOID)
                            </span>
                          )}
                        </div>
                        <div className="text-slate-500 mt-0.5">
                          วันที่รับชำระ {pay.paidDate} · {PAYMENT_METHOD_LABELS_TH[pay.paymentMethod]}
                        </div>
                        <div className="text-slate-600 mt-0.5 font-mono-num">
                          เงินโอน {formatTHB(pay.actualCashAmount ?? pay.amount, 2)} บ. + WHT{' '}
                          {formatTHB(pay.whtAmount ?? 0, 2)} บ.
                        </div>
                        {pay.voidReason && (
                          <div className="text-rose-700 mt-1">เหตุผล Void: {pay.voidReason}</div>
                        )}
                        {pay.editReason && (
                          <div className="text-amber-700 mt-1">เหตุผลแก้ไข: {pay.editReason}</div>
                        )}
                      </div>

                      <div className="text-right shrink-0">
                        <div
                          className={`text-sm font-bold font-mono-num ${
                            pay.isVoided ? 'line-through text-slate-400' : 'text-emerald-700'
                          }`}
                        >
                          +{formatTHB(pay.amount, 2)} บ.
                        </div>
                        <div className="flex items-center justify-end gap-1.5 mt-2">
                          {pay.hasAttachment && (
                            <button
                              type="button"
                              onClick={() => onViewAttachment(pay)}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-sky-50 text-[#082F4E] border border-sky-200 rounded-lg hover:bg-sky-100 cursor-pointer"
                            >
                              <Paperclip className="w-3 h-3" />
                              ดูสลิป
                            </button>
                          )}
                          {canRecordOrEditPayment && !pay.isVoided && (
                            <>
                              <button
                                type="button"
                                onClick={() => onEditPayment(hydrated, pay)}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                              >
                                <Pencil className="w-3 h-3" />
                                แก้ไข
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setVoidTarget(pay);
                                  setVoidReason('');
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-white text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-50 cursor-pointer"
                              >
                                <Ban className="w-3 h-3" />
                                Void
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Section 3: Collection & CRM Log */}
          {section === 'crm' && (
            <div className="space-y-4">
              <form
                onSubmit={handleAddCollectionLog}
                className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 text-xs"
              >
                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                  <MessageSquarePlus className="w-4 h-4 text-[#082F4E]" />
                  <span>บันทึกการติดตามทวงถาม (Collection Log)</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1">วันที่ติดต่อ *</label>
                    <input
                      type="date"
                      required
                      value={contactDate}
                      onChange={(e) => setContactDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1">ช่องทาง</label>
                    <select
                      value={channel}
                      onChange={(e) => setChannel(e.target.value as CollectionChannel)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg"
                    >
                      {COLLECTION_CHANNELS.map((ch) => (
                        <option key={ch} value={ch}>
                          {ch}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1">ผู้ที่สนทนา *</label>
                    <input
                      type="text"
                      required
                      maxLength={FIELD_LIMITS.contactPersonMax}
                      value={contactPerson}
                      onChange={(e) => setContactPerson(e.target.value)}
                      placeholder="ชื่อผู้รับเรื่อง"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1">
                      วันนัดชำระ (PTP)
                    </label>
                    <input
                      type="date"
                      value={promiseToPayDate}
                      onChange={(e) => setPromiseToPayDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
                <textarea
                  rows={2}
                  required
                  maxLength={FIELD_LIMITS.notesMax}
                  value={crmNote}
                  onChange={(e) => setCrmNote(e.target.value)}
                  placeholder="สรุปผลการเจรจา เช่น ลูกค้ารับทราบยอดและแจ้งโอนวันศุกร์..."
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingCrm}
                    className="px-4 py-1.5 bg-[#082F4E] text-white font-semibold rounded-lg hover:bg-[#0B3C63] disabled:opacity-50 cursor-pointer"
                  >
                    {savingCrm ? 'กำลังบันทึก...' : 'บันทึกการติดตาม'}
                  </button>
                </div>
              </form>

              <div className="space-y-2">
                {contractLogs.length === 0 ? (
                  <div className="text-xs text-slate-400 text-center py-6 border border-slate-200 rounded-xl">
                    ยังไม่มีบันทึกการติดตามทวงถาม
                  </div>
                ) : (
                  contractLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3.5 bg-white border border-slate-200 rounded-xl text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900">
                          {log.contactDate} · {log.channel} · คุยกับ {log.contactPerson}
                        </span>
                        <span className="text-[11px] text-slate-500">โดย {log.authorName}</span>
                      </div>
                      <p className="text-slate-700">{log.note}</p>
                      {log.promiseToPayDate && (
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-50 text-[#082F4E] font-semibold text-[11px]">
                          <CalendarClock className="w-3 h-3" />
                          นัดชำระ (Promise to Pay): {log.promiseToPayDate}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Section 4: Early Settlement & Debt Restructuring */}
          {section === 'restructure' && (
            <div className="space-y-4">
              {/* Early Settlement Calculator */}
              <div className="bg-sky-50/60 border border-sky-200 rounded-xl p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-[#082F4E] flex items-center gap-1.5">
                    <Calculator className="w-4 h-4" />
                    <span>คำนวณยอดปิดบัญชีล่วงหน้า (Early Settlement)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-600">ส่วนลดงวดยังไม่ถึงกำหนด (%)</span>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      step="0.5"
                      value={earlyDiscountPct}
                      onChange={(e) => setEarlyDiscountPct(e.target.value)}
                      className="w-16 px-2 py-1 bg-white border border-sky-200 rounded-lg font-mono-num text-right"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-white border border-sky-100 rounded-xl p-3">
                  <div>
                    <div className="text-slate-500">เงินต้นคงเหลือ</div>
                    <div className="font-bold font-mono-num text-slate-900">
                      {formatTHB(earlyQuote.remainingPrincipal, 2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">เบี้ยปรับสุทธิ</div>
                    <div className="font-bold font-mono-num text-rose-600">
                      +{formatTHB(earlyQuote.netPenalty, 2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">ส่วนลดปิดบัญชี</div>
                    <div className="font-bold font-mono-num text-emerald-700">
                      -{formatTHB(earlyQuote.discountAmount, 2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">ยอดปิดบัญชีสุทธิ</div>
                    <div className="font-bold font-mono-num text-[#082F4E] text-sm">
                      {formatTHB(earlyQuote.netPayoffAmount, 2)} บ.
                    </div>
                  </div>
                </div>
              </div>

              {/* Debt Restructuring Form */}
              {canRestructure && ledger.nextStatus !== 'settled' && (
                <form
                  onSubmit={handleRestructure}
                  className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 text-xs"
                >
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-600" />
                    <span>ขยายงวด / ปรับโครงสร้างหนี้ (เก็บประวัติตารางเดิมอัตโนมัติ)</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    <div>
                      <label className="block font-semibold text-slate-600 mb-1">เริ่มปรับตั้งแต่งวดที่</label>
                      <input
                        type="number"
                        min={1}
                        max={120}
                        required
                        value={fromInstallment}
                        onChange={(e) => setFromInstallment(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-600 mb-1">จำนวนงวดรวมใหม่</label>
                      <input
                        type="number"
                        min={1}
                        max={120}
                        required
                        value={newTotalInstallments}
                        onChange={(e) => setNewTotalInstallments(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-600 mb-1">ค่างวดใหม่/เดือน (บ.)</label>
                      <input
                        type="number"
                        min={1}
                        step="0.01"
                        required
                        value={newMonthlyAmount}
                        onChange={(e) => setNewMonthlyAmount(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-mono-num"
                      />
                    </div>
                  </div>
                  <input
                    type="text"
                    required
                    maxLength={FIELD_LIMITS.reasonMax}
                    value={restructureReason}
                    onChange={(e) => setRestructureReason(e.target.value)}
                    placeholder="เหตุผลการปรับโครงสร้างหนี้ (บังคับระบุ)..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={savingRestructure}
                      className="px-4 py-2 bg-[#082F4E] text-white font-semibold rounded-lg hover:bg-[#0B3C63] disabled:opacity-50 cursor-pointer"
                    >
                      {savingRestructure ? 'กำลังบันทึก...' : 'บันทึกตารางปรับโครงสร้างหนี้'}
                    </button>
                  </div>
                </form>
              )}

              {/* Archived Revisions */}
              <div className="space-y-2 text-xs">
                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                  <History className="w-4 h-4 text-slate-500" />
                  <span>ประวัติตารางงวดก่อนปรับโครงสร้าง ({revisions.length})</span>
                </div>
                {revisions.length === 0 ? (
                  <div className="text-slate-400 bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
                    ยังไม่มีประวัติการปรับโครงสร้างหนี้ในสัญญานี้
                  </div>
                ) : (
                  revisions.map((rev) => (
                    <div
                      key={String(rev.id)}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1"
                    >
                      <div className="flex items-center justify-between font-semibold text-slate-900">
                        <span>ตารางเวอร์ชันเดิม V.{String(rev.version)}</span>
                        <span className="text-slate-500">โดย {String(rev.changedByName)}</span>
                      </div>
                      <div className="text-slate-600">
                        เดิม {String(rev.previousTotalInstallments)} งวด (งวดละ{' '}
                        {formatTHB(Number(rev.previousMonthlyInstallment || 0), 2)} บ.) → เปลี่ยนเป็น{' '}
                        {String(rev.newTotalInstallments)} งวด (งวดละ{' '}
                        {formatTHB(Number(rev.newMonthlyInstallment || 0), 2)} บ.)
                      </div>
                      <div className="text-slate-500">เหตุผล: {String(rev.reason)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 space-y-2">
          {confirmDelete ? (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-rose-800 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                ยืนยันการลบสัญญา {hydrated.contractCode} และประวัติรับชำระที่เกี่ยวข้องทั้งหมด?
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleDelete}
                  className="flex-1 py-2 text-xs font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 cursor-pointer"
                >
                  {deleting ? 'กำลังลบ...' : 'ยืนยันลบถาวร'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {canRecordOrEditPayment && (
                <button
                  type="button"
                  disabled={ledger.nextStatus === 'settled'}
                  onClick={() => onRecordPayment(hydrated)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-45 cursor-pointer whitespace-nowrap"
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  บันทึกรับชำระเงิน
                </button>
              )}
              <button
                type="button"
                disabled={ledger.nextStatus === 'settled' && userRole !== 'super_admin'}
                onClick={() => onEditContract(hydrated)}
                className="py-2.5 px-3.5 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-100 disabled:opacity-45 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Pencil className="w-3.5 h-3.5" />
                แก้ไขสัญญา
              </button>
              {canDeleteContract && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="py-2.5 px-3 bg-white border border-rose-200 text-rose-600 text-xs font-semibold rounded-xl hover:bg-rose-50 flex items-center gap-1 cursor-pointer"
                  title="ลบสัญญา (เฉพาะผู้บริหาร)"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
