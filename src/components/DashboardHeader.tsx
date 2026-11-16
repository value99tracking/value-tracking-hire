import React, { useState } from 'react';
import {
  AlertTriangle,
  Bell,
  FileText,
  History,
  LayoutGrid,
  Plus,
  Receipt,
  Settings,
  User,
} from 'lucide-react';
import { ROLE_LABELS_TH, type ContractRecord, type NavTab, type UserRole } from '../types/billing';
import { formatTHB } from '../lib/billingService';

interface DashboardHeaderProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  contracts: ContractRecord[];
  userRole: UserRole;
  onSelectContract: (contract: ContractRecord) => void;
  onOpenNewContract: () => void;
}

const NAV_ITEMS: Array<{
  key: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'overview', label: 'ภาพรวมลูกหนี้', icon: LayoutGrid },
  { key: 'payments', label: 'รับชำระเงิน', icon: Receipt },
  { key: 'contracts', label: 'สัญญาทั้งหมด', icon: FileText },
  { key: 'risk', label: 'ติดตามความเสี่ยง', icon: AlertTriangle },
  { key: 'audit', label: 'ประวัติแก้ไข', icon: History },
  { key: 'account', label: 'บัญชีและสิทธิ์', icon: Settings },
];

export function DashboardHeader({
  activeTab,
  onSelectTab,
  contracts,
  userRole,
  onSelectContract,
  onOpenNewContract,
}: DashboardHeaderProps) {
  const [notifOpen, setNotifOpen] = useState(false);

  const overdueAlerts = contracts
    .filter((c) => c.overdueAmount > 0 || c.status === 'at_risk')
    .slice(0, 6);

  return (
    <>
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
          <button
            type="button"
            onClick={() => onSelectTab('overview')}
            className="flex items-center gap-2.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span className="w-9 h-9 rounded-xl bg-[#082F4E] text-white text-xs font-extrabold flex items-center justify-center tracking-tight shrink-0">
              VE
            </span>
            <span className="text-base font-bold text-slate-900 tracking-tight whitespace-nowrap shrink-0">
              Value E-billing
            </span>
          </button>

          <nav className="hidden lg:flex items-center gap-5">
            {NAV_ITEMS.map((item) => {
              const active = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onSelectTab(item.key)}
                  className={`py-5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'border-[#082F4E] text-slate-900 font-semibold'
                      : 'border-transparent text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2.5 shrink-0 relative">
            <span className="hidden sm:inline-block px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold whitespace-nowrap shrink-0">
              {ROLE_LABELS_TH[userRole]}
            </span>

            <button
              type="button"
              onClick={() => setNotifOpen((o) => !o)}
              aria-label="แจ้งเตือนยอดค้างชำระ"
              className="relative w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 flex items-center justify-center cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {overdueAlerts.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {overdueAlerts.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => onSelectTab('account')}
              aria-label="บัญชีสมาชิก"
              className="w-9 h-9 rounded-full bg-[#082F4E] text-white flex items-center justify-center hover:bg-[#0B3C63] transition-colors cursor-pointer"
            >
              <User className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onOpenNewContract}
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#082F4E] text-white text-xs font-semibold rounded-xl hover:bg-[#0B3C63] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              เพิ่มสัญญาใหม่
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-12 w-80 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden z-40">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">
                    แจ้งเตือนยอดค้างชำระ ({overdueAlerts.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setNotifOpen(false);
                      onSelectTab('risk');
                    }}
                    className="text-xs font-semibold text-[#082F4E] hover:underline cursor-pointer"
                  >
                    ดูทั้งหมด
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                  {overdueAlerts.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500">
                      ไม่มีรายการค้างชำระในขณะนี้
                    </div>
                  ) : (
                    overdueAlerts.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setNotifOpen(false);
                          onSelectContract(c);
                        }}
                        className="w-full p-3.5 text-left hover:bg-slate-50 flex items-center justify-between gap-3 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 truncate">
                            {c.clinicName}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {c.contractCode} · เกรด {c.creditGrade}
                          </div>
                        </div>
                        <div className="text-xs font-bold text-rose-600 font-mono-num shrink-0">
                          {formatTHB(c.overdueAmount)}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 px-1 py-1.5 flex items-center justify-around">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelectTab(item.key)}
              className={`flex flex-col items-center justify-center px-1.5 py-1.5 rounded-xl transition-colors cursor-pointer ${
                active ? 'text-[#082F4E] bg-sky-50' : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[10px] font-semibold mt-0.5 whitespace-nowrap">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
