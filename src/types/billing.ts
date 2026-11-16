export type Region = 'BKK' | 'North' | 'South' | 'Northeast' | 'East' | 'Central';
export type ContractType = 'ซื้อขาย' | 'เช่าซื้อ' | 'เช่า' | 'SaaS' | 'Hybrid' | 'Enterprise';
export type ActiveContractType = 'ซื้อขาย' | 'เช่าซื้อ' | 'เช่า';
export type CreditGrade = 'A+' | 'A' | 'AB' | 'B' | 'C' | 'D' | 'E' | 'F';
export type ContractStatus = 'active' | 'at_risk' | 'settled' | 'suspended';
export type PaymentType = 'installment' | 'prepaid' | 'settlement';
export type PaymentMethod = 'Bank Transfer' | 'PromptPay' | 'Credit Card' | 'Cheque';
export type UserRole = 'sales' | 'accounting' | 'super_admin';
export type RequestedRole = 'sales' | 'accounting';
export type ApprovalStatus = 'pending' | 'approved' | 'suspended';
export type CollectionChannel = 'โทรศัพท์' | 'LINE' | 'อีเมล' | 'เข้าพบหน้างาน';
export type InstallmentStatus = 'paid' | 'partial' | 'overdue' | 'due_this_month' | 'upcoming';

export const REGIONS: Region[] = ['BKK', 'North', 'South', 'Northeast', 'East', 'Central'];
export const CONTRACT_TYPES: ActiveContractType[] = ['ซื้อขาย', 'เช่าซื้อ', 'เช่า'];
export const CREDIT_GRADES: CreditGrade[] = ['A+', 'A', 'AB', 'B', 'C', 'D', 'E', 'F'];
export const CONTRACT_STATUSES: ContractStatus[] = ['active', 'at_risk', 'settled', 'suspended'];
export const PAYMENT_TYPES: PaymentType[] = ['installment', 'prepaid', 'settlement'];
export const PAYMENT_METHODS: PaymentMethod[] = ['Bank Transfer', 'PromptPay', 'Credit Card', 'Cheque'];
export const COLLECTION_CHANNELS: CollectionChannel[] = ['โทรศัพท์', 'LINE', 'อีเมล', 'เข้าพบหน้างาน'];
export const USER_ROLES: UserRole[] = ['sales', 'accounting', 'super_admin'];

export const EQUIPMENT_PRESETS = [
  'Pico Laser',
  'Diode Laser',
  'HIFU Ultramax 7D',
  'Q-Switch Nd:YAG Laser',
  'RF Microneedling',
  'Cryolipolysis Slimming',
] as const;

export const REGION_LABELS_TH: Record<Region, string> = {
  BKK: 'กรุงเทพฯ',
  North: 'ภาคเหนือ',
  South: 'ภาคใต้',
  Northeast: 'ภาคอีสาน',
  East: 'ภาคตะวันออก',
  Central: 'ภาคกลาง',
};

export const CONTRACT_TYPE_LABELS_TH: Record<string, string> = {
  'ซื้อขาย': 'ซื้อขาย',
  'เช่าซื้อ': 'เช่าซื้อ',
  'เช่า': 'เช่า',
  SaaS: 'ซื้อขาย (เดิม)',
  Hybrid: 'เช่าซื้อ (เดิม)',
  Enterprise: 'เช่า (เดิม)',
};

export const STATUS_LABELS_TH: Record<ContractStatus, string> = {
  active: 'ปกติ',
  at_risk: 'มีความเสี่ยง',
  settled: 'ปิดยอดแล้ว',
  suspended: 'ระงับชั่วคราว',
};

export const PAYMENT_TYPE_LABELS_TH: Record<PaymentType, string> = {
  installment: 'ชำระค่างวด',
  prepaid: 'ชำระล่วงหน้า',
  settlement: 'ปิดยอดสัญญา',
};

export const PAYMENT_METHOD_LABELS_TH: Record<PaymentMethod, string> = {
  'Bank Transfer': 'โอนเงินธนาคาร',
  PromptPay: 'พร้อมเพย์',
  'Credit Card': 'บัตรเครดิต',
  Cheque: 'เช็คสั่งจ่าย',
};

export const ROLE_LABELS_TH: Record<UserRole, string> = {
  sales: 'ฝ่ายขาย',
  accounting: 'ฝ่ายบัญชี',
  super_admin: 'ผู้บริหาร',
};

export const APPROVAL_STATUS_LABELS_TH: Record<ApprovalStatus, string> = {
  pending: 'รออนุมัติสิทธิ์',
  approved: 'อนุมัติแล้ว',
  suspended: 'ระงับการใช้งาน',
};

export const INSTALLMENT_STATUS_LABELS_TH: Record<InstallmentStatus, string> = {
  paid: 'ชำระครบแล้ว',
  partial: 'ชำระบางส่วน',
  overdue: 'ค้างชำระ',
  due_this_month: 'ครบกำหนดเดือนนี้',
  upcoming: 'ยังไม่ครบกำหนด',
};

// Validation bounds synchronized verbatim with firebase-blueprint.json & firestore.rules
export const FIELD_LIMITS = {
  displayNameMax: 100,
  companyNameMax: 120,
  departmentMax: 80,
  emailMax: 180,
  phoneMax: 30,
  contractCodeMax: 32,
  contractCodePattern: /^[a-zA-Z0-9-]+$/,
  clinicNameMax: 120,
  parentClinicNameMax: 120,
  contactPersonMax: 100,
  contactPhoneMax: 30,
  taxIdMax: 20,
  companyAddressMax: 300,
  equipmentModelMax: 120,
  serialNumberMax: 80,
  salesRepMax: 120,
  dueDateMax: 20,
  notesMax: 500,
  referenceNoMax: 64,
  paymentNoteMax: 300,
  reasonMax: 300,
  attachmentNameMax: 120,
  attachmentDataUrlMax: 450000,
  maxInstallments: 120,
  maxAmount: 1000000000,
} as const;

export interface UserProfile {
  uid: string;
  displayName: string;
  companyName: string;
  department: string;
  role: UserRole;
  requestedRole?: RequestedRole;
  approvalStatus: ApprovalStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserPrivateInfo {
  uid: string;
  email: string;
  phone?: string;
  updatedAt?: unknown;
}

export interface ContractRecord {
  id: string;
  ownerId: string;
  assignedRepUid: string;
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
  contractType: ContractType;
  salesRep: string;
  creditGrade: CreditGrade;
  includeVat: boolean;
  amountBeforeVat: number;
  vatAmount: number;
  totalAmount: number;
  downPayment: number;
  securityDeposit: number;
  totalInstallments: number;
  monthlyInstallment: number;
  startDate: string;
  penaltyRatePercent: number;
  waivedPenaltyAmount: number;
  restructuredFromInstallment?: number;
  restructuredMonthlyAmount?: number;
  restructuredTotalInstallments?: number;
  restructuredDate?: string;
  scheduleVersion: number;
  paidAmount: number;
  prepaidAmount: number;
  notDueAmount: number;
  dueThisMonthAmount: number;
  overdueAmount: number;
  lastPaymentDate?: string;
  status: ContractStatus;
  dueDate: string;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ContractRevisionRecord {
  id: string;
  contractId: string;
  version: number;
  reason: string;
  previousTotalInstallments: number;
  previousMonthlyInstallment: number;
  previousStartDate: string;
  newTotalInstallments: number;
  newMonthlyInstallment: number;
  restructuredFromInstallment: number;
  changedByUid: string;
  changedByName: string;
  createdAt?: unknown;
}

export interface PaymentRecord {
  id: string;
  ownerId: string;
  contractId: string;
  contractAssignedRepUid: string;
  clinicName: string;
  contractCode: string;
  actualCashAmount: number;
  whtRate: number;
  whtAmount: number;
  amount: number;
  paymentType: PaymentType;
  paymentMethod: PaymentMethod;
  referenceNo: string;
  paidDate: string;
  hasAttachment: boolean;
  attachmentFileName?: string;
  isVoided: boolean;
  voidReason?: string;
  editReason?: string;
  note?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PaymentAttachmentRecord {
  id: string;
  ownerId: string;
  contractId: string;
  contractAssignedRepUid: string;
  paymentId: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  createdAt?: unknown;
}

export interface CollectionLogRecord {
  id: string;
  ownerId: string;
  authorName: string;
  contractId: string;
  assignedRepUid: string;
  contractCode: string;
  clinicName: string;
  contactDate: string;
  contactPerson: string;
  channel: CollectionChannel;
  promiseToPayDate?: string;
  note: string;
  createdAt?: unknown;
}

export interface AuditLogRecord {
  id: string;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  targetType: 'contract' | 'payment' | 'user' | 'system';
  targetId: string;
  targetLabel: string;
  reason?: string;
  beforeSummary?: string;
  afterSummary?: string;
  createdAt?: unknown;
}

export type NavTab = 'overview' | 'payments' | 'contracts' | 'risk' | 'audit' | 'account';
