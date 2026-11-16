import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, CreditCard, FileUp, History, Paperclip, X } from 'lucide-react';
import {
  FIELD_LIMITS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS_TH,
  PAYMENT_TYPES,
  PAYMENT_TYPE_LABELS_TH,
  type ContractRecord,
  type PaymentMethod,
  type PaymentRecord,
  type PaymentType,
} from '../types/billing';
import {
  compressAttachmentFile,
  editContractPayment,
  formatTHB,
  recordContractPayment,
  type ActorContext,
  type AttachmentUploadInput,
} from '../lib/billingService';
import {
  getTodayISO,
  previewPaymentAllocation,
  recalculateContractFromLedger,
  round2,
} from '../lib/debtEngine';

interface PaymentModalProps {
  isOpen: boolean;
  actor: ActorContext;
  contract: ContractRecord | null;
  contractPayments: PaymentRecord[];
  editingPayment?: PaymentRecord | null;
  onClose: () => void;
}

export function PaymentModal({
  isOpen,
  actor,
  contract,
  contractPayments,
  editingPayment = null,
  onClose,
}: PaymentModalProps) {
  const [actualCashAmount, setActualCashAmount] = useState('');
  const [whtRate, setWhtRate] = useState<number>(0);
  const [whtAmount, setWhtAmount] = useState('0');
  const [paymentType, setPaymentType] = useState<PaymentType>('installment');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Bank Transfer');
  const [referenceNo, setReferenceNo] = useState('');
  const [paidDate, setPaidDate] = useState(getTodayISO());
  const [note, setNote] = useState('');
  const [editReason, setEditReason] = useState('');
  const [attachment, setAttachment] = useState<AttachmentUploadInput | null>(null);
  const [showDateHistory, setShowDateHistory] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const baselinePayments = useMemo(() => {
    if (!editingPayment) return contractPayments;
    return contractPayments.filter((p) => p.id !== editingPayment.id);
  }, [contractPayments, editingPayment]);

  const ledgerBefore = useMemo(() => {
    if (!contract) return null;
    return recalculateContractFromLedger(contract, baselinePayments);
  }, [contract, baselinePayments]);

  useEffect(() => {
    if (!isOpen || !contract) return;
    setError('');
    setAttachment(null);
    setEditReason('');
    setShowDateHistory(false);

    if (editingPayment) {
      setActualCashAmount(String(editingPayment.actualCashAmount ?? editingPayment.amount));
      setWhtRate(editingPayment.whtRate ?? 0);
      setWhtAmount(String(editingPayment.whtAmount ?? 0));
      setPaymentType(editingPayment.paymentType);
      setPaymentMethod(editingPayment.paymentMethod);
      setReferenceNo(editingPayment.referenceNo);
      setPaidDate(editingPayment.paidDate);
      setNote(editingPayment.note || '');
    } else {
      const summary = recalculateContractFromLedger(contract, contractPayments);
      const suggestedGross =
        summary.nextInstallmentRemaining > 0
          ? summary.nextInstallmentRemaining
          : contract.monthlyInstallment || 50000;
      const defaultWhtRate = contract.contractType === 'เช่า' ? 5 : 0;
      const basePreVat = contract.includeVat ? round2(suggestedGross / 1.07) : suggestedGross;
      const calcWht = defaultWhtRate > 0 ? round2(basePreVat * (defaultWhtRate / 100)) : 0;
      const calcCash = round2(Math.max(0, suggestedGross - calcWht));

      setActualCashAmount(String(calcCash));
      setWhtRate(defaultWhtRate);
      setWhtAmount(String(calcWht));
      setPaymentType('installment');
      setPaymentMethod('Bank Transfer');
      setReferenceNo(
        `SLIP-${contract.contractCode.replace('CNT-', '')}-${Math.floor(10 + Math.random() * 89)}`
      );
      setPaidDate(getTodayISO());
      setNote('');
    }
  }, [isOpen, contract, editingPayment, contractPayments]);

  const cashNum = round2(Math.max(0, Number(actualCashAmount) || 0));
  const whtNum = round2(Math.max(0, Number(whtAmount) || 0));
  const totalApplied = round2(cashNum + whtNum);

  const allocationPreview = useMemo(() => {
    if (!contract) return null;
    return previewPaymentAllocation(
      contract,
      contractPayments,
      cashNum,
      whtNum,
      editingPayment?.id
    );
  }, [contract, contractPayments, cashNum, whtNum, editingPayment]);

  if (!isOpen || !contract || !ledgerBefore) return null;

  const isSettledAndCreate = !editingPayment && ledgerBefore.nextStatus === 'settled';
  const totalRemainingBefore = round2(
    ledgerBefore.overduePrincipal +
      ledgerBefore.dueThisMonthPrincipal +
      ledgerBefore.notDuePrincipal
  );

  const applyWhtRatePreset = (rate: number) => {
    setWhtRate(rate);
    const baseGross =
      ledgerBefore.nextInstallmentRemaining > 0
        ? ledgerBefore.nextInstallmentRemaining
        : round2(cashNum + whtNum);
    const basePreVat = contract.includeVat ? round2(baseGross / 1.07) : baseGross;
    const nextWht = rate > 0 ? round2(basePreVat * (rate / 100)) : 0;
    const nextCash = round2(Math.max(0, baseGross - nextWht));
    setWhtAmount(String(nextWht));
    setActualCashAmount(String(nextCash));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const processed = await compressAttachmentFile(file);
      setAttachment(processed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถแนบไฟล์ได้');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (totalApplied <= 0) {
      setError('ยอดรับโอนจริงรวมภาษีหัก ณ ที่จ่ายต้องมากกว่า 0 บาท');
      return;
    }
    if (editingPayment && !editReason.trim()) {
      setError('กรุณาระบุเหตุผลในการแก้ไขบิลรับชำระเงิน');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        actualCashAmount: cashNum,
        whtRate,
        whtAmount: whtNum,
        paymentType,
        paymentMethod,
        referenceNo: referenceNo.trim() || `REF-${Date.now()}`,
        paidDate,
        note: note.trim(),
        attachment,
      };
      if (editingPayment) {
        await editContractPayment(actor, contract, editingPayment, payload, editReason.trim());
      } else {
        await recordContractPayment(actor, contract, payload);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถบันทึกรายการรับชำระได้');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full shadow-xl overflow-hidden my-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <CreditCard className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {editingPayment ? 'แก้ไขบิลรับชำระเงิน' : 'บันทึกรับชำระเงิน'}
              </h3>
              <p className="text-xs text-slate-500">
                {contract.clinicName} · {contract.contractCode}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* Top Summary Card */}
          <div className="bg-[#082F4E] text-white rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[11px] text-sky-200/85">ค่างวดเป้าหมายปัจจุบัน</div>
                <div className="text-sm font-bold">
                  {ledgerBefore.nextInstallmentNo
                    ? `งวดที่ ${ledgerBefore.nextInstallmentNo} / ${ledgerBefore.installments.length} · คงเหลืองวดนี้ ${formatTHB(ledgerBefore.nextInstallmentRemaining, 2)} บาท`
                    : 'ชำระครบทุกงวดแล้ว'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-sky-200/85">ค่างวดปกติ/เดือน</div>
                <div className="text-sm font-bold font-mono-num">
                  {formatTHB(contract.restructuredMonthlyAmount || contract.monthlyInstallment, 2)} บ.
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-white/15 text-xs">
              <div>
                <div className="text-sky-200/80">ยอดค้างชำระ</div>
                <div className="font-bold text-rose-300 font-mono-num">
                  {formatTHB(ledgerBefore.overduePrincipal, 2)}
                </div>
              </div>
              <div>
                <div className="text-sky-200/80">คงเหลือทั้งสัญญา</div>
                <div className="font-bold font-mono-num">{formatTHB(totalRemainingBefore, 2)}</div>
              </div>
              <div>
                <div className="text-sky-200/80">ชำระสะสม / ล่าสุด</div>
                <div className="font-bold text-emerald-300 font-mono-num">
                  {formatTHB(ledgerBefore.totalEffectivePaid, 2)}
                </div>
                <div className="text-[10px] text-sky-200/90">
                  ล่าสุด: {ledgerBefore.lastPaymentDate || 'ยังไม่เคยชำระ'}
                </div>
              </div>
            </div>

            {ledgerBefore.paymentDateHistory.length > 0 && (
              <div className="pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowDateHistory((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] text-sky-200 hover:text-white cursor-pointer"
                >
                  <History className="w-3.5 h-3.5" />
                  {showDateHistory
                    ? 'ซ่อนประวัติวันที่รับชำระที่ผ่านมา'
                    : `ดูประวัติวันที่รับชำระที่ผ่านมา (${ledgerBefore.paymentDateHistory.length} ครั้ง)`}
                </button>
                {showDateHistory && (
                  <div className="mt-2 max-h-24 overflow-y-auto space-y-1 text-[11px] bg-white/10 rounded-xl p-2.5">
                    {ledgerBefore.paymentDateHistory.map((h, i) => (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <span className="font-mono">
                          {h.paidDate} · {h.ref}
                        </span>
                        <span className="font-mono-num font-semibold">
                          +{formatTHB(h.amount, 2)} บ.
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {isSettledAndCreate && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
              สัญญานี้ปิดยอดเรียบร้อยแล้ว หากต้องการปรับปรุงยอดสามารถแก้ไขบิลเดิมได้จากหน้ารายการรับชำระ
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Cash Transfer + WHT Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                ยอดเงินโอนรับจริง (บาท) *
              </label>
              <input
                type="number"
                required
                min={0}
                max={FIELD_LIMITS.maxAmount}
                step="0.01"
                value={actualCashAmount}
                onChange={(e) => setActualCashAmount(e.target.value)}
                className="w-full px-3.5 py-2.5 text-base font-bold font-mono-num bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-700">
                  ภาษีหัก ณ ที่จ่าย WHT (50 ทวิ)
                </label>
                <div className="flex items-center gap-1">
                  {[0, 3, 5].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => applyWhtRatePreset(r)}
                      className={`px-1.5 py-0.5 text-[10px] font-bold rounded border cursor-pointer ${
                        whtRate === r
                          ? 'bg-[#082F4E] text-white border-[#082F4E]'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {r}%
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="number"
                min={0}
                max={FIELD_LIMITS.maxAmount}
                step="0.01"
                value={whtAmount}
                onChange={(e) => setWhtAmount(e.target.value)}
                className="w-full px-3.5 py-2.5 text-base font-bold font-mono-num bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
              />
            </div>
          </div>

          {/* Live Preview Box */}
          {allocationPreview && (
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-emerald-900 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ตัวอย่างผลการตัดยอด (Preview)
                </span>
                <span className="font-bold text-emerald-800 font-mono-num">
                  ยอดตัดหนี้รวม {formatTHB(allocationPreview.totalApplied, 2)} บาท
                </span>
              </div>

              {allocationPreview.allocations.length === 0 ? (
                <p className="text-[11px] text-slate-600">
                  กรอกยอดเงินเพื่อดูการตัดชำระงวดอัตโนมัติ (รองรับชำระบางส่วนและปัดยอดข้ามงวด)
                </p>
              ) : (
                <div className="space-y-1 max-h-28 overflow-y-auto text-[11px]">
                  {allocationPreview.allocations.map((a) => (
                    <div
                      key={a.installmentNo}
                      className="flex items-center justify-between bg-white/80 border border-emerald-100 rounded-lg px-2.5 py-1.5"
                    >
                      <span>
                        งวดที่ {a.installmentNo} ({a.dueDate}) →{' '}
                        <span
                          className={`font-semibold ${
                            a.resultingStatus === 'ชำระครบแล้ว'
                              ? 'text-emerald-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {a.resultingStatus}
                        </span>
                      </span>
                      <span className="font-mono-num font-bold text-slate-900">
                        ตัด {formatTHB(a.appliedAmount, 2)}
                        {a.remainingAfter > 0 && (
                          <span className="text-amber-700 font-normal">
                            {' '}
                            (เหลืองวดนี้ {formatTHB(a.remainingAfter, 2)})
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                  {allocationPreview.surplusCreditAfterAll > 0 && (
                    <div className="text-[11px] font-semibold text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1">
                      ยอดโอนเกินมูลค่าสัญญาทั้งฉบับ: เก็บเป็นเครดิตชำระล่วงหน้า{' '}
                      {formatTHB(allocationPreview.surplusCreditAfterAll, 2)} บาท
                    </div>
                  )}
                </div>
              )}

              <div className="pt-1 border-t border-emerald-200/70 flex items-center justify-between text-[11px] text-emerald-900">
                <span>ยอดคงเหลือทั้งสัญญาหลังตัดชำระนี้</span>
                <span className="font-bold font-mono-num">
                  {formatTHB(allocationPreview.remainingBalanceAfter, 2)} บาท
                  {allocationPreview.willSettleContract && ' (ปิดยอดสัญญาอัตโนมัติ)'}
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">ประเภทการชำระ</label>
              <select
                value={paymentType}
                onChange={(e) => setPaymentType(e.target.value as PaymentType)}
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
              >
                {PAYMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PAYMENT_TYPE_LABELS_TH[t]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">ช่องทางชำระ</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS_TH[m]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                เลขที่อ้างอิง / สลิป *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.referenceNoMax}
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                วันที่รับชำระเงิน *
              </label>
              <input
                type="date"
                required
                value={paidDate}
                onChange={(e) => setPaidDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
              />
            </div>
          </div>

          {/* Slip / 50 ทวิ Attachment */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              แนบหลักฐานการโอน (สลิป / หนังสือรับรอง 50 ทวิ)
            </label>
            <label className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-slate-50 border border-dashed border-slate-300 rounded-xl hover:bg-slate-100/70 cursor-pointer">
              <div className="flex items-center gap-2 text-xs text-slate-600 min-w-0">
                <FileUp className="w-4 h-4 text-[#082F4E] shrink-0" />
                <span className="truncate">
                  {attachment
                    ? `แนบไฟล์ใหม่: ${attachment.fileName}`
                    : editingPayment?.hasAttachment
                      ? `มีไฟล์เดิมอยู่แล้ว (${editingPayment.attachmentFileName || 'สลิปแนบ'}) — เลือกเพื่อเปลี่ยน`
                      : 'คลิกเพื่ออัปโหลดรูปสลิป (JPG, PNG) หรือ PDF (≤ 300KB)'}
                </span>
              </div>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={handleFileChange}
                className="hidden"
              />
              {attachment && (
                <Paperclip className="w-4 h-4 text-emerald-600 shrink-0" />
              )}
            </label>
          </div>

          {editingPayment && (
            <div>
              <label className="block text-xs font-semibold text-rose-700 mb-1">
                เหตุผลในการแก้ไขบิล (บังคับระบุ) *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.reasonMax}
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="เช่น แก้ไขยอด WHT 3% ตามใบ 50 ทวิตัวจริง"
                className="w-full px-3 py-2 text-sm bg-rose-50/40 border border-rose-200 rounded-xl focus:outline-none focus:bg-white focus:border-rose-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">หมายเหตุ</label>
            <input
              type="text"
              maxLength={FIELD_LIMITS.paymentNoteMax}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น โอนเข้าบัญชีบริษัท กสิกรไทย..."
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saving || isSettledAndCreate}
              className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
            >
              {saving
                ? 'กำลังคำนวณและบันทึก...'
                : editingPayment
                  ? 'บันทึกการแก้ไขและคำนวณหนี้ใหม่'
                  : 'ยืนยันรับชำระเงิน'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
