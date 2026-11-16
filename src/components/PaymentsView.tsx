import React, { useMemo, useState } from 'react';
import { Ban, CreditCard, FileSpreadsheet, Paperclip, Pencil, Plus, Search } from 'lucide-react';
import {
  FIELD_LIMITS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS_TH,
  PAYMENT_TYPE_LABELS_TH,
  type ContractRecord,
  type PaymentRecord,
  type UserRole,
} from '../types/billing';
import { formatTHB, voidContractPayment, type ActorContext } from '../lib/billingService';
import { round2 } from '../lib/debtEngine';
import { exportAccountingWorkbook } from '../lib/excelExport';

interface PaymentsViewProps {
  contracts: ContractRecord[];
  payments: PaymentRecord[];
  actor: ActorContext;
  userRole: UserRole;
  onRecordPayment: (contract: ContractRecord) => void;
  onEditPayment: (contract: ContractRecord, payment: PaymentRecord) => void;
  onViewAttachment: (payment: PaymentRecord) => void;
}

export function PaymentsView({
  contracts,
  payments,
  actor,
  userRole,
  onRecordPayment,
  onEditPayment,
  onViewAttachment,
}: PaymentsViewProps) {
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('ALL');
  const [selectedContractId, setSelectedContractId] = useState('');
  const [voidTarget, setVoidTarget] = useState<PaymentRecord | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  const canManagePayments = userRole === 'accounting' || userRole === 'super_admin';

  const filteredPayments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payments.filter((p) => {
      if (methodFilter !== 'ALL' && p.paymentMethod !== methodFilter) return false;
      if (q) {
        const hay = `${p.clinicName} ${p.contractCode} ${p.referenceNo}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [payments, search, methodFilter]);

  const totals = useMemo(() => {
    let totalCollectedCash = 0;
    let totalWht = 0;
    let totalPrepaid = 0;
    let activeCount = 0;
    payments.forEach((p) => {
      if (p.isVoided) return;
      activeCount++;
      totalCollectedCash = round2(totalCollectedCash + (p.actualCashAmount ?? p.amount));
      totalWht = round2(totalWht + (p.whtAmount ?? 0));
      if (p.paymentType === 'prepaid') totalPrepaid = round2(totalPrepaid + p.amount);
    });
    return {
      totalCollectedCash,
      totalWht,
      totalEffective: round2(totalCollectedCash + totalWht),
      totalPrepaid,
      activeCount,
    };
  }, [payments]);

  const activeContracts = contracts.filter((c) => c.status !== 'settled');

  const handleConfirmVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTarget || !voidReason.trim()) return;
    const parent = contracts.find((c) => c.id === voidTarget.contractId);
    if (!parent) return;
    setVoiding(true);
    try {
      await voidContractPayment(actor, parent, voidTarget, voidReason.trim());
      setVoidTarget(null);
      setVoidReason('');
    } finally {
      setVoiding(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">การเงิน ภาษีหัก ณ ที่จ่าย และหลักฐานการโอน</p>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            รายการรับชำระเงิน
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManagePayments && (
            <button
              type="button"
              onClick={() => exportAccountingWorkbook(contracts, payments)}
              disabled={contracts.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 disabled:opacity-45 cursor-pointer whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Export Excel (.xlsx)
            </button>
          )}
          {canManagePayments && activeContracts.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={selectedContractId}
                onChange={(e) => setSelectedContractId(e.target.value)}
                className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-xl text-slate-700 max-w-[220px]"
              >
                <option value="">เลือกสัญญาเพื่อรับชำระ...</option>
                {activeContracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.contractCode} — {c.clinicName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!selectedContractId}
                onClick={() => {
                  const target = contracts.find((c) => c.id === selectedContractId);
                  if (target) onRecordPayment(target);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-45 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                บันทึกรับเงิน
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <div className="text-xs text-slate-500">ยอดตัดหนี้รวม (สด + WHT)</div>
          <div className="mt-2 text-xl font-bold text-slate-900 font-mono-num">
            {formatTHB(totals.totalEffective, 2)} บ.
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <div className="text-xs text-slate-500">เงินโอนรับจริง</div>
          <div className="mt-2 text-xl font-bold text-emerald-700 font-mono-num">
            {formatTHB(totals.totalCollectedCash, 2)} บ.
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <div className="text-xs text-slate-500">ภาษีหัก ณ ที่จ่าย (WHT)</div>
          <div className="mt-2 text-xl font-bold text-[#082F4E] font-mono-num">
            {formatTHB(totals.totalWht, 2)} บ.
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <div className="text-xs text-slate-500">จำนวนรายการที่ใช้งาน</div>
          <div className="mt-2 text-xl font-bold text-slate-900 font-mono-num">
            {totals.activeCount} รายการ
          </div>
        </div>
      </div>

      {voidTarget && (
        <form
          onSubmit={handleConfirmVoid}
          className="bg-rose-50 border border-rose-200 rounded-2xl p-4 space-y-3 text-xs"
        >
          <div className="font-bold text-rose-900">
            ยืนยันการยกเลิกบิล (Void): {voidTarget.referenceNo} ({voidTarget.clinicName} ·{' '}
            {formatTHB(voidTarget.amount, 2)} บ.)
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              required
              maxLength={FIELD_LIMITS.reasonMax}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="ระบุเหตุผลการยกเลิกบิลเพื่อเก็บลง Audit Trail..."
              className="flex-1 px-3 py-2 bg-white border border-rose-200 rounded-xl"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setVoidTarget(null)}
                className="px-3 py-2 bg-white border border-slate-200 rounded-xl cursor-pointer"
              >
                ปิด
              </button>
              <button
                type="submit"
                disabled={voiding}
                className="px-4 py-2 bg-rose-600 text-white font-semibold rounded-xl cursor-pointer"
              >
                {voiding ? 'กำลังยกเลิก...' : 'ยืนยัน Void บิล'}
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อคลินิก, เลขสัญญา, เลขอ้างอิงสลิป..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
            />
          </div>
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-xl text-slate-700"
          >
            <option value="ALL">ทุกช่องทางชำระเงิน</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS_TH[m]}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                <th className="py-3 px-4">เลขอ้างอิง / วันที่</th>
                <th className="py-3 px-4">คลินิก / รหัสสัญญา</th>
                <th className="py-3 px-4">ประเภทและช่องทาง</th>
                <th className="py-3 px-4 text-right">โอนจริง / WHT</th>
                <th className="py-3 px-4 text-right">รวมตัดหนี้</th>
                <th className="py-3 px-4 text-right">หลักฐาน / จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredPayments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 px-4 text-center text-xs text-slate-500">
                    <CreditCard className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                    ยังไม่มีรายการรับชำระเงินในระบบ
                  </td>
                </tr>
              ) : (
                filteredPayments.map((p) => {
                  const parentContract = contracts.find((c) => c.id === p.contractId);
                  return (
                    <tr
                      key={p.id}
                      className={`hover:bg-slate-50/70 ${p.isVoided ? 'opacity-60 bg-slate-50' : ''}`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-semibold text-slate-900 text-xs">
                            {p.referenceNo}
                          </span>
                          {p.isVoided && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-bold">
                              VOID
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 font-mono-num">{p.paidDate}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{p.clinicName}</div>
                        <div className="text-xs text-slate-500 font-mono">{p.contractCode}</div>
                        {(p.voidReason || p.editReason) && (
                          <div className="text-[11px] text-amber-700 mt-0.5">
                            {p.voidReason ? `Void: ${p.voidReason}` : `แก้ไข: ${p.editReason}`}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-600">
                        <div className="font-semibold text-slate-800">
                          {PAYMENT_TYPE_LABELS_TH[p.paymentType]}
                        </div>
                        <div>{PAYMENT_METHOD_LABELS_TH[p.paymentMethod]}</div>
                      </td>
                      <td className="py-3.5 px-4 text-right text-xs font-mono-num text-slate-600">
                        <div>สด {formatTHB(p.actualCashAmount ?? p.amount, 2)}</div>
                        <div className="text-[11px] text-slate-500">
                          WHT {formatTHB(p.whtAmount ?? 0, 2)}
                        </div>
                      </td>
                      <td
                        className={`py-3.5 px-4 text-right font-bold font-mono-num ${
                          p.isVoided ? 'line-through text-slate-400' : 'text-emerald-700'
                        }`}
                      >
                        +{formatTHB(p.amount, 2)}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {p.hasAttachment && (
                            <button
                              type="button"
                              onClick={() => onViewAttachment(p)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-[#082F4E] bg-sky-50 border border-sky-200 rounded-lg hover:bg-sky-100 cursor-pointer"
                            >
                              <Paperclip className="w-3 h-3" />
                              สลิป
                            </button>
                          )}
                          {canManagePayments && !p.isVoided && parentContract && (
                            <>
                              <button
                                type="button"
                                onClick={() => onEditPayment(parentContract, p)}
                                className="p-1.5 text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer"
                                title="แก้ไขบิลรับชำระ"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setVoidTarget(p);
                                  setVoidReason('');
                                }}
                                className="p-1.5 text-rose-600 bg-white border border-rose-200 rounded-lg hover:bg-rose-50 cursor-pointer"
                                title="ยกเลิกบิล (Void)"
                              >
                                <Ban className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
