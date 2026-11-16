import React, { useMemo, useState } from 'react';
import { CreditCard, Pencil, Plus, Search, Wrench } from 'lucide-react';
import {
  CONTRACT_TYPE_LABELS_TH,
  REGION_LABELS_TH,
  type ContractRecord,
  type ContractStatus,
  type PaymentRecord,
  type UserRole,
} from '../types/billing';
import { formatTHB } from '../lib/billingService';
import { recalculateContractFromLedger } from '../lib/debtEngine';

interface ContractsViewProps {
  contracts: ContractRecord[];
  payments: PaymentRecord[];
  userRole: UserRole;
  onOpenNewContract: () => void;
  onSelectContract: (contract: ContractRecord) => void;
  onEditContract: (contract: ContractRecord) => void;
  onRecordPayment: (contract: ContractRecord) => void;
}

const STATUS_TABS: Array<{ key: 'ALL' | ContractStatus; label: string }> = [
  { key: 'ALL', label: 'ทั้งหมด' },
  { key: 'active', label: 'ปกติ' },
  { key: 'at_risk', label: 'มีความเสี่ยง' },
  { key: 'settled', label: 'ปิดยอดแล้ว' },
  { key: 'suspended', label: 'ระงับชั่วคราว' },
];

export function ContractsView({
  contracts,
  payments,
  userRole,
  onOpenNewContract,
  onSelectContract,
  onEditContract,
  onRecordPayment,
}: ContractsViewProps) {
  const [statusTab, setStatusTab] = useState<'ALL' | ContractStatus>('ALL');
  const [query, setQuery] = useState('');

  const ledgers = useMemo(() => {
    const map = new Map<string, ReturnType<typeof recalculateContractFromLedger>>();
    contracts.forEach((c) => {
      map.set(
        c.id,
        recalculateContractFromLedger(
          c,
          payments.filter((p) => p.contractId === c.id)
        )
      );
    });
    return map;
  }, [contracts, payments]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contracts.filter((c) => {
      const ledger = ledgers.get(c.id);
      const effectiveStatus = ledger?.nextStatus || c.status;
      if (statusTab !== 'ALL' && effectiveStatus !== statusTab) return false;
      if (q) {
        const hay = `${c.clinicName} ${c.parentClinicName || ''} ${c.contractCode} ${c.salesRep} ${c.equipmentModel || ''} ${c.serialNumber || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [contracts, ledgers, statusTab, query]);

  const canRecordPayment = userRole === 'accounting' || userRole === 'super_admin';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">การจัดการสัญญาและเครื่องมือแพทย์</p>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            จัดการสัญญาคลินิก ({contracts.length})
          </h1>
        </div>
        <button
          type="button"
          onClick={onOpenNewContract}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#082F4E] text-white text-xs font-semibold rounded-xl hover:bg-[#0B3C63] cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          สร้างสัญญาใหม่
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusTab(tab.key)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusTab === tab.key
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative lg:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาคลินิก, เครือคลินิกแม่, รุ่นเครื่อง, S/N..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                <th className="py-3 px-4">คลินิก / เครื่องมือแพทย์</th>
                <th className="py-3 px-4">ประเภท / ผู้ดูแลลูกหนี้</th>
                <th className="py-3 px-4">เกรด</th>
                <th className="py-3 px-4 text-right">ยอดสัญญารวม</th>
                <th className="py-3 px-4 text-right">ชำระแล้ว</th>
                <th className="py-3 px-4 text-right">ค้างชำระ</th>
                <th className="py-3 px-4 text-right">ดำเนินการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 px-4 text-center text-xs text-slate-500">
                    ไม่พบรายการสัญญาในหมวดหมู่นี้
                  </td>
                </tr>
              ) : (
                filtered.map((c) => {
                  const ledger = ledgers.get(c.id)!;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => onSelectContract(c)}
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 flex flex-wrap items-center gap-1.5">
                          <span>{c.clinicName}</span>
                          {ledger.shouldSuspendPM && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-bold">
                              <Wrench className="w-3 h-3" />
                              ชะลอ PM
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 font-mono">
                          {c.contractCode} · ครบ {ledger.nextDueDate}
                          {c.equipmentModel ? ` · ${c.equipmentModel}` : ''}
                        </div>
                        {c.parentClinicName && (
                          <div className="text-[11px] text-[#082F4E]">
                            คลินิกแม่: {c.parentClinicName}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-600">
                        <div className="font-semibold text-slate-800">
                          {CONTRACT_TYPE_LABELS_TH[c.contractType] || c.contractType}
                        </div>
                        <div>
                          {REGION_LABELS_TH[c.region]} · {c.salesRep}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-xs font-bold text-slate-900">
                        {ledger.suggestedGrade}
                      </td>
                      <td className="py-3.5 px-4 text-right font-semibold font-mono-num text-slate-900">
                        {formatTHB(c.totalAmount)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-num text-emerald-700">
                        {formatTHB(ledger.totalEffectivePaid)}
                      </td>
                      <td
                        className={`py-3.5 px-4 text-right font-semibold font-mono-num ${
                          ledger.overduePrincipal > 0 ? 'text-rose-600' : 'text-slate-400'
                        }`}
                      >
                        {formatTHB(ledger.overduePrincipal)}
                      </td>
                      <td
                        className="py-3.5 px-4 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          {canRecordPayment && (
                            <button
                              type="button"
                              disabled={ledger.nextStatus === 'settled'}
                              onClick={() => onRecordPayment(c)}
                              className="p-1.5 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-40 cursor-pointer"
                              title="บันทึกรับชำระเงิน"
                            >
                              <CreditCard className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={ledger.nextStatus === 'settled' && userRole !== 'super_admin'}
                            onClick={() => onEditContract(c)}
                            className="p-1.5 text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                            title="แก้ไขสัญญา"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
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
