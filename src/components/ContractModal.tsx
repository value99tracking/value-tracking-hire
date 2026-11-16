import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Calculator, Stethoscope, Users, X } from 'lucide-react';
import {
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  CREDIT_GRADES,
  EQUIPMENT_PRESETS,
  FIELD_LIMITS,
  REGIONS,
  REGION_LABELS_TH,
  STATUS_LABELS_TH,
  type ActiveContractType,
  type ContractRecord,
  type ContractStatus,
  type CreditGrade,
  type PaymentRecord,
  type Region,
  type UserProfile,
  type UserRole,
} from '../types/billing';
import {
  createContract,
  formatAssigneeLabel,
  formatTHB,
  updateContract,
  type ActorContext,
  type ContractFormInput,
} from '../lib/billingService';
import { computeVatBreakdown, getTodayISO, hydrateContract, round2 } from '../lib/debtEngine';

interface ContractModalProps {
  isOpen: boolean;
  actor: ActorContext;
  userRole: UserRole;
  usersDirectory: UserProfile[];
  existingParentClinics: string[];
  editingContract?: ContractRecord | null;
  linkedPayments?: PaymentRecord[];
  onClose: () => void;
}

export function ContractModal({
  isOpen,
  actor,
  userRole,
  usersDirectory,
  existingParentClinics,
  editingContract,
  linkedPayments = [],
  onClose,
}: ContractModalProps) {
  const [contractCode, setContractCode] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [parentClinicName, setParentClinicName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [taxId, setTaxId] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');

  const [equipmentModel, setEquipmentModel] = useState('Pico Laser');
  const [serialNumber, setSerialNumber] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [warrantyEndDate, setWarrantyEndDate] = useState('');

  const [region, setRegion] = useState<Region>('BKK');
  const [contractType, setContractType] = useState<ActiveContractType>('เช่าซื้อ');
  const [assignedRepUid, setAssignedRepUid] = useState('');
  const [creditGrade, setCreditGrade] = useState<CreditGrade>('A');
  const [status, setStatus] = useState<ContractStatus>('active');

  const [includeVat, setIncludeVat] = useState(true);
  const [vatInputMode, setVatInputMode] = useState<'before_vat' | 'include_vat'>('before_vat');
  const [baseAmountInput, setBaseAmountInput] = useState('1000000');
  const [downPayment, setDownPayment] = useState('200000');
  const [securityDeposit, setSecurityDeposit] = useState('0');
  const [totalInstallments, setTotalInstallments] = useState('12');
  const [startDate, setStartDate] = useState(getTodayISO());
  const [penaltyRatePercent, setPenaltyRatePercent] = useState('1.5');
  const [notes, setNotes] = useState('');
  const [editReason, setEditReason] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const approvedUsers = useMemo(
    () => usersDirectory.filter((u) => u.approvalStatus === 'approved'),
    [usersDirectory]
  );

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setEditReason('');

    if (editingContract) {
      const h = hydrateContract(editingContract);
      setContractCode(h.contractCode);
      setClinicName(h.clinicName);
      setParentClinicName(h.parentClinicName || '');
      setContactPerson(h.contactPerson || '');
      setContactPhone(h.contactPhone || '');
      setTaxId(h.taxId || '');
      setCompanyAddress(h.companyAddress || '');
      setEquipmentModel(h.equipmentModel || '');
      setSerialNumber(h.serialNumber || '');
      setDeliveryDate(h.deliveryDate || '');
      setWarrantyEndDate(h.warrantyEndDate || '');
      setRegion(h.region);
      const mappedType: ActiveContractType =
        h.contractType === 'ซื้อขาย' || h.contractType === 'เช่าซื้อ' || h.contractType === 'เช่า'
          ? h.contractType
          : h.contractType === 'Enterprise'
            ? 'เช่า'
            : h.contractType === 'Hybrid'
              ? 'เช่าซื้อ'
              : 'ซื้อขาย';
      setContractType(mappedType);
      setAssignedRepUid(h.assignedRepUid || actor.uid);
      setCreditGrade(h.creditGrade);
      setStatus(h.status);
      setIncludeVat(h.includeVat);
      setVatInputMode('before_vat');
      setBaseAmountInput(String(h.amountBeforeVat));
      setDownPayment(String(h.downPayment));
      setSecurityDeposit(String(h.securityDeposit));
      setTotalInstallments(String(h.totalInstallments));
      setStartDate(h.startDate);
      setPenaltyRatePercent(String(h.penaltyRatePercent));
      setNotes(h.notes || '');
    } else {
      const today = getTodayISO();
      const rand = Math.floor(100 + Math.random() * 899);
      setContractCode(`CNT-2026-${rand}`);
      setClinicName('');
      setParentClinicName('');
      setContactPerson('');
      setContactPhone('');
      setTaxId('');
      setCompanyAddress('');
      setEquipmentModel('Pico Laser');
      setSerialNumber('');
      setDeliveryDate(today);
      setWarrantyEndDate('');
      setRegion('BKK');
      setContractType('เช่าซื้อ');
      setAssignedRepUid(actor.uid);
      setCreditGrade('A');
      setStatus('active');
      setIncludeVat(true);
      setVatInputMode('before_vat');
      setBaseAmountInput('1000000');
      setDownPayment('200000');
      setSecurityDeposit('0');
      setTotalInstallments('12');
      setStartDate(today);
      setPenaltyRatePercent('1.5');
      setNotes('');
    }
  }, [isOpen, editingContract, actor.uid]);

  const financialPreview = useMemo(() => {
    const rawNum = Number(baseAmountInput) || 0;
    const vat = computeVatBreakdown(rawNum, vatInputMode, includeVat);
    const down = Math.min(round2(Math.max(0, Number(downPayment) || 0)), vat.totalAmount);
    const deposit = round2(Math.max(0, Number(securityDeposit) || 0));
    const count = Math.max(1, Math.min(FIELD_LIMITS.maxInstallments, Math.round(Number(totalInstallments) || 1)));
    const financed = round2(Math.max(0, vat.totalAmount - down));
    const monthly = round2(financed / count);
    return { ...vat, down, deposit, count, financed, monthly };
  }, [baseAmountInput, vatInputMode, includeVat, downPayment, securityDeposit, totalInstallments]);

  if (!isOpen) return null;

  const isSalesEditingExisting = Boolean(editingContract) && userRole === 'sales';
  const isSettledLocked = Boolean(editingContract) && editingContract?.status === 'settled' && userRole !== 'super_admin';

  const selectedRepUser =
    approvedUsers.find((u) => u.uid === assignedRepUid) ||
    usersDirectory.find((u) => u.uid === assignedRepUid);
  const resolvedRepLabel = selectedRepUser
    ? formatAssigneeLabel(selectedRepUser)
    : editingContract?.salesRep || `${actor.name} (${userRole === 'sales' ? 'ฝ่ายขาย' : userRole === 'accounting' ? 'ฝ่ายบัญชี' : 'ผู้บริหาร'})`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!FIELD_LIMITS.contractCodePattern.test(contractCode.trim())) {
      setError('รหัสสัญญาต้องเป็นตัวอักษรภาษาอังกฤษ ตัวเลข หรือขีด (-) เท่านั้น');
      return;
    }
    if (financialPreview.down > financialPreview.totalAmount) {
      setError('เงินดาวน์ต้องไม่เกินมูลค่าสัญญารวม');
      return;
    }

    const input: ContractFormInput = {
      contractCode: contractCode.trim(),
      clinicName: clinicName.trim(),
      parentClinicName: parentClinicName.trim(),
      contactPerson: contactPerson.trim(),
      contactPhone: contactPhone.trim(),
      taxId: taxId.trim(),
      companyAddress: companyAddress.trim(),
      equipmentModel: equipmentModel.trim(),
      serialNumber: serialNumber.trim(),
      deliveryDate: deliveryDate.trim(),
      warrantyEndDate: warrantyEndDate.trim(),
      region,
      contractType,
      assignedRepUid: userRole === 'sales' ? actor.uid : assignedRepUid || actor.uid,
      salesRep: resolvedRepLabel,
      creditGrade,
      includeVat,
      amountBeforeVat: financialPreview.amountBeforeVat,
      vatAmount: financialPreview.vatAmount,
      totalAmount: financialPreview.totalAmount,
      downPayment: financialPreview.down,
      securityDeposit: financialPreview.deposit,
      totalInstallments: financialPreview.count,
      startDate: startDate.trim(),
      penaltyRatePercent: Math.max(0, Math.min(50, Number(penaltyRatePercent) || 0)),
      status,
      notes: notes.trim(),
    };

    setSaving(true);
    try {
      if (editingContract) {
        await updateContract(actor, editingContract, input, linkedPayments, editReason.trim() || undefined);
      } else {
        await createContract(actor, input);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถบันทึกข้อมูลสัญญาได้');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full shadow-xl overflow-hidden my-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {editingContract ? `แก้ไขสัญญา ${editingContract.contractCode}` : 'สร้างสัญญาคลินิกใหม่'}
            </h3>
            <p className="text-xs text-slate-500">
              รองรับสัญญา ซื้อขาย / เช่าซื้อ / เช่า พร้อมคำนวณ VAT 7% และตารางงวดอัตโนมัติ
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          {isSettledLocked && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
              สัญญานี้ปิดยอดแล้ว เฉพาะผู้บริหาร (Super Admin) เท่านั้นที่สามารถแก้ไขข้อมูลย้อนหลังได้
            </div>
          )}

          {isSalesEditingExisting && !isSettledLocked && (
            <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-xs text-sky-900">
              สิทธิ์ฝ่ายขาย: สามารถอัปเดตข้อมูลติดต่อลูกค้า เครื่องมือแพทย์ และหมายเหตุได้ (ตัวเลขทางการเงินล็อกสำหรับฝ่ายบัญชี/ผู้บริหาร)
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Section 1: Contract & Parent Clinic */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
              <Users className="w-4 h-4 text-[#082F4E]" />
              <span>ข้อมูลสัญญาและลูกค้าคลินิก</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  รหัสสัญญา *
                </label>
                <input
                  type="text"
                  required
                  disabled={isSalesEditingExisting}
                  minLength={2}
                  maxLength={FIELD_LIMITS.contractCodeMax}
                  value={contractCode}
                  onChange={(e) => setContractCode(e.target.value)}
                  placeholder="CNT-2026-001"
                  className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E] disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ชื่อคลินิก / สาขา *
                </label>
                <input
                  type="text"
                  required
                  disabled={isSalesEditingExisting}
                  minLength={2}
                  maxLength={FIELD_LIMITS.clinicNameMax}
                  value={clinicName}
                  onChange={(e) => setClinicName(e.target.value)}
                  placeholder="เช่น Aura Aesthetic ทองหล่อ"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E] disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ชื่อคลินิกแม่ (ผูกหลายสาขา)
                </label>
                <input
                  type="text"
                  list="parent-clinic-suggestions"
                  maxLength={FIELD_LIMITS.parentClinicNameMax}
                  value={parentClinicName}
                  onChange={(e) => setParentClinicName(e.target.value)}
                  placeholder="เช่น เครือ Aura Wellness Group"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
                />
                <datalist id="parent-clinic-suggestions">
                  {existingParentClinics.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">ชื่อผู้ติดต่อ</label>
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.contactPersonMax}
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  placeholder="เช่น พญ.ณัฐธิดา / คุณธนกร"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">เบอร์โทรศัพท์</label>
                <input
                  type="tel"
                  maxLength={FIELD_LIMITS.contactPhoneMax}
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="08X-XXX-XXXX"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  เลขประจำตัวผู้เสียภาษี
                </label>
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.taxIdMax}
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  placeholder="0105561044821"
                  className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">ที่อยู่บริษัท / คลินิก</label>
              <input
                type="text"
                maxLength={FIELD_LIMITS.companyAddressMax}
                value={companyAddress}
                onChange={(e) => setCompanyAddress(e.target.value)}
                placeholder="เลขที่ อาคาร ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์"
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">ประเภทสัญญา *</label>
                <select
                  disabled={isSalesEditingExisting}
                  value={contractType}
                  onChange={(e) => setContractType(e.target.value as ActiveContractType)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E] disabled:opacity-60"
                >
                  {CONTRACT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">ภูมิภาค *</label>
                <select
                  disabled={isSalesEditingExisting}
                  value={region}
                  onChange={(e) => setRegion(e.target.value as Region)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E] disabled:opacity-60"
                >
                  {REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {REGION_LABELS_TH[r]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">ผู้ดูแลลูกหนี้ *</label>
                <select
                  disabled={userRole === 'sales' || isSalesEditingExisting}
                  value={assignedRepUid}
                  onChange={(e) => setAssignedRepUid(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E] disabled:opacity-60"
                >
                  {approvedUsers.length === 0 ? (
                    <option value={actor.uid}>{actor.name}</option>
                  ) : (
                    approvedUsers.map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {formatAssigneeLabel(u)}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">เกรด / สถานะ</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    disabled={isSalesEditingExisting}
                    value={creditGrade}
                    onChange={(e) => setCreditGrade(e.target.value as CreditGrade)}
                    className="px-2 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl disabled:opacity-60"
                  >
                    {CREDIT_GRADES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <select
                    disabled={isSalesEditingExisting}
                    value={status}
                    onChange={(e) => setStatus(e.target.value as ContractStatus)}
                    className="px-2 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl disabled:opacity-60"
                  >
                    {CONTRACT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS_TH[s]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Medical Equipment */}
          <div className="pt-4 border-t border-slate-100 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
              <Stethoscope className="w-4 h-4 text-[#082F4E]" />
              <span>ข้อมูลเครื่องมือแพทย์และการรับประกัน</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  รุ่นเครื่องมือแพทย์
                </label>
                <input
                  type="text"
                  list="equipment-model-presets"
                  maxLength={FIELD_LIMITS.equipmentModelMax}
                  value={equipmentModel}
                  onChange={(e) => setEquipmentModel(e.target.value)}
                  placeholder="เช่น Pico Laser"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
                />
                <datalist id="equipment-model-presets">
                  {EQUIPMENT_PRESETS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  หมายเลขเครื่อง (S/N)
                </label>
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.serialNumberMax}
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  placeholder="PIC-2026-88412"
                  className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">วันส่งมอบเครื่อง</label>
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  วันหมดประกันตัวเครื่อง
                </label>
                <input
                  type="date"
                  value={warrantyEndDate}
                  onChange={(e) => setWarrantyEndDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Financial Schedule & VAT 7% */}
          <div className="pt-4 border-t border-slate-100 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                <Calculator className="w-4 h-4 text-[#082F4E]" />
                <span>มูลค่าสัญญา ภาษี (VAT 7%) และตารางงวดชำระ</span>
              </div>

              <div className="flex items-center gap-3 text-xs">
                <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
                  <input
                    type="checkbox"
                    disabled={isSalesEditingExisting}
                    checked={includeVat}
                    onChange={(e) => setIncludeVat(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  คำนวณ VAT 7%
                </label>
                {includeVat && (
                  <select
                    disabled={isSalesEditingExisting}
                    value={vatInputMode}
                    onChange={(e) => setVatInputMode(e.target.value as 'before_vat' | 'include_vat')}
                    className="px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    <option value="before_vat">กรอกยอดก่อน VAT</option>
                    <option value="include_vat">กรอกยอดสุทธิรวม VAT</option>
                  </select>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  {includeVat && vatInputMode === 'before_vat'
                    ? 'ราคาสัญญาก่อน VAT (บาท) *'
                    : 'มูลค่าสัญญาสุทธิ (บาท) *'}
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  disabled={isSalesEditingExisting}
                  value={baseAmountInput}
                  onChange={(e) => setBaseAmountInput(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-num bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E] disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  เงินดาวน์ (บาท)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  disabled={isSalesEditingExisting}
                  value={downPayment}
                  onChange={(e) => setDownPayment(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-num bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E] disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  เงินประกันสัญญาเช่า (แยกจากดาวน์)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  disabled={isSalesEditingExisting}
                  value={securityDeposit}
                  onChange={(e) => setSecurityDeposit(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-num bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E] disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  จำนวนงวดทั้งหมด (เดือน) *
                </label>
                <input
                  type="number"
                  min={1}
                  max={FIELD_LIMITS.maxInstallments}
                  required
                  disabled={isSalesEditingExisting}
                  value={totalInstallments}
                  onChange={(e) => setTotalInstallments(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-num bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E] disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  วันที่เริ่มสัญญา (งวดที่ 1) *
                </label>
                <input
                  type="date"
                  required
                  disabled={isSalesEditingExisting}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E] disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  อัตราเบี้ยปรับล่าช้า (% ต่อเดือน)
                </label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  step="0.1"
                  disabled={isSalesEditingExisting}
                  value={penaltyRatePercent}
                  onChange={(e) => setPenaltyRatePercent(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-num bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E] disabled:opacity-60"
                />
              </div>
            </div>

            {/* Live Financial Breakdown Banner */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
              <div>
                <div className="text-slate-500">ยอดก่อน VAT</div>
                <div className="font-bold text-slate-900 font-mono-num mt-0.5">
                  {formatTHB(financialPreview.amountBeforeVat, 2)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">VAT 7%</div>
                <div className="font-bold text-slate-900 font-mono-num mt-0.5">
                  {formatTHB(financialPreview.vatAmount, 2)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">มูลค่าสุทธิรวม VAT</div>
                <div className="font-bold text-[#082F4E] font-mono-num mt-0.5">
                  {formatTHB(financialPreview.totalAmount, 2)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">ยอดผ่อนจัดงวดสุทธิ</div>
                <div className="font-bold text-slate-900 font-mono-num mt-0.5">
                  {formatTHB(financialPreview.financed, 2)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">ยอดผ่อน/เช่าต่อเดือน</div>
                <div className="font-bold text-emerald-700 font-mono-num mt-0.5">
                  {formatTHB(financialPreview.monthly, 2)} บ.
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">หมายเหตุสัญญา</label>
              <textarea
                rows={2}
                maxLength={FIELD_LIMITS.notesMax}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="เงื่อนไขพิเศษหรือรายละเอียดการวางบิล..."
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
              />
            </div>

            {editingContract && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  เหตุผลการแก้ไข (บันทึกใน Audit Trail)
                </label>
                <textarea
                  rows={2}
                  maxLength={FIELD_LIMITS.reasonMax}
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="ระบุเหตุผลการแก้ไขข้อมูลสัญญา..."
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
                />
              </div>
            )}
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
              disabled={saving || isSettledLocked}
              className="px-5 py-2 text-sm font-semibold text-white bg-[#082F4E] rounded-xl hover:bg-[#0B3C63] disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'กำลังบันทึก...' : editingContract ? 'บันทึกการแก้ไขสัญญา' : 'สร้างสัญญาและตารางงวด'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
