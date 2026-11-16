import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Clock, RefreshCw, ShieldAlert } from 'lucide-react';
import { AuthProvider, BOOTSTRAPPED_ADMIN_EMAIL, useAuth } from './contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from './lib/firebase';
import { formatAssigneeLabel, type ActorContext } from './lib/billingService';
import { hydrateContract } from './lib/debtEngine';
import { seedSamplePortfolio } from './lib/seedData';
import {
  ROLE_LABELS_TH,
  type AuditLogRecord,
  type CollectionLogRecord,
  type ContractRecord,
  type NavTab,
  type PaymentRecord,
} from './types/billing';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthScreen } from './components/AuthScreen';
import { DashboardHeader } from './components/DashboardHeader';
import { OverviewView } from './components/OverviewView';
import { PaymentsView } from './components/PaymentsView';
import { ContractsView } from './components/ContractsView';
import { RiskAgingView } from './components/RiskAgingView';
import { AuditTrailView } from './components/AuditTrailView';
import { AccountView } from './components/AccountView';
import { ContractModal } from './components/ContractModal';
import { PaymentModal } from './components/PaymentModal';
import { ContractDetailDrawer } from './components/ContractDetailDrawer';
import { AttachmentViewerModal } from './components/AttachmentViewerModal';

function WorkspaceApp() {
  const {
    user,
    isEmailVerified,
    authReady,
    profile,
    profileLoading,
    usersDirectory,
    refreshProfile,
    logout,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [collectionLogs, setCollectionLogs] = useState<CollectionLogRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const [contractModalOpen, setContractModalOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<ContractRecord | null>(null);
  const [paymentModalState, setPaymentModalState] = useState<{
    contract: ContractRecord;
    editingPayment?: PaymentRecord | null;
  } | null>(null);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [viewingAttachmentPayment, setViewingAttachmentPayment] = useState<PaymentRecord | null>(
    null
  );

  const isBootstrappedAdmin =
    (user?.email || '').toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();
  const rawRole = profile?.role as string | undefined;
  const isAdminRole =
    isBootstrappedAdmin ||
    rawRole === 'super_admin' ||
    rawRole === 'admin' ||
    rawRole === 'ผู้บริหาร';
  const isApproved =
    isAdminRole || profile?.approvalStatus === 'approved';
  const effectiveRole = isAdminRole
    ? 'super_admin'
    : profile?.role || 'sales';

  useEffect(() => {
    if (!authReady || !user || !isEmailVerified || !profile || !isApproved) {
      setContracts([]);
      setPayments([]);
      setCollectionLogs([]);
      setAuditLogs([]);
      setDataLoading(false);
      return;
    }

    setDataLoading(true);
    const unsubs: Array<() => void> = [];

    if (effectiveRole === 'accounting' || effectiveRole === 'super_admin') {
      unsubs.push(
        onSnapshot(
          collection(db, 'contracts'),
          (snap) => {
            const list = snap.docs.map((d) =>
              hydrateContract({ id: d.id, ...(d.data() as Partial<ContractRecord>) })
            );
            list.sort((a, b) => a.contractCode.localeCompare(b.contractCode));
            setContracts(list);
            setDataLoading(false);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'contracts')
        )
      );

      unsubs.push(
        onSnapshot(
          collection(db, 'payments'),
          (snap) => {
            const list = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<PaymentRecord, 'id'>),
            }));
            list.sort((a, b) => b.paidDate.localeCompare(a.paidDate));
            setPayments(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'payments')
        )
      );

      unsubs.push(
        onSnapshot(
          collection(db, 'collectionLogs'),
          (snap) => {
            const list = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<CollectionLogRecord, 'id'>),
            }));
            list.sort((a, b) => b.contactDate.localeCompare(a.contactDate));
            setCollectionLogs(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'collectionLogs')
        )
      );

      unsubs.push(
        onSnapshot(
          collection(db, 'auditLogs'),
          (snap) => {
            const list = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<AuditLogRecord, 'id'>),
            }));
            list.sort((a, b) => {
              const ta =
                a.createdAt && typeof a.createdAt === 'object' && 'seconds' in a.createdAt
                  ? Number((a.createdAt as { seconds: number }).seconds)
                  : 0;
              const tb =
                b.createdAt && typeof b.createdAt === 'object' && 'seconds' in b.createdAt
                  ? Number((b.createdAt as { seconds: number }).seconds)
                  : 0;
              return tb - ta;
            });
            setAuditLogs(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs')
        )
      );
    } else {
      // Sales role: strictly query contracts owned by or assigned to this rep
      let ownedContracts: ContractRecord[] = [];
      let assignedContracts: ContractRecord[] = [];
      const mergeContracts = () => {
        const map = new Map<string, ContractRecord>();
        ownedContracts.forEach((c) => map.set(c.id, c));
        assignedContracts.forEach((c) => map.set(c.id, c));
        const merged = Array.from(map.values()).sort((a, b) =>
          a.contractCode.localeCompare(b.contractCode)
        );
        setContracts(merged);
        setDataLoading(false);
      };

      unsubs.push(
        onSnapshot(
          query(collection(db, 'contracts'), where('ownerId', '==', user.uid)),
          (snap) => {
            ownedContracts = snap.docs.map((d) =>
              hydrateContract({ id: d.id, ...(d.data() as Partial<ContractRecord>) })
            );
            mergeContracts();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'contracts')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'contracts'), where('assignedRepUid', '==', user.uid)),
          (snap) => {
            assignedContracts = snap.docs.map((d) =>
              hydrateContract({ id: d.id, ...(d.data() as Partial<ContractRecord>) })
            );
            mergeContracts();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'contracts')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'payments'), where('contractAssignedRepUid', '==', user.uid)),
          (snap) => {
            const list = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<PaymentRecord, 'id'>),
            }));
            list.sort((a, b) => b.paidDate.localeCompare(a.paidDate));
            setPayments(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'payments')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'collectionLogs'), where('assignedRepUid', '==', user.uid)),
          (snap) => {
            const list = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<CollectionLogRecord, 'id'>),
            }));
            list.sort((a, b) => b.contactDate.localeCompare(a.contactDate));
            setCollectionLogs(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'collectionLogs')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'auditLogs'), where('actorUid', '==', user.uid)),
          (snap) => {
            const list = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<AuditLogRecord, 'id'>),
            }));
            list.sort((a, b) => {
              const ta =
                a.createdAt && typeof a.createdAt === 'object' && 'seconds' in a.createdAt
                  ? Number((a.createdAt as { seconds: number }).seconds)
                  : 0;
              const tb =
                b.createdAt && typeof b.createdAt === 'object' && 'seconds' in b.createdAt
                  ? Number((b.createdAt as { seconds: number }).seconds)
                  : 0;
              return tb - ta;
            });
            setAuditLogs(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs')
        )
      );
    }

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [authReady, user, isEmailVerified, profile, isApproved, effectiveRole]);

  const existingParentClinics = useMemo(() => {
    const set = new Set<string>();
    contracts.forEach((c) => {
      if (c.parentClinicName) set.add(c.parentClinicName.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'th'));
  }, [contracts]);

  if (!authReady || (user && isEmailVerified && profileLoading && !profile)) {
    return (
      <div className="min-h-screen bg-[#F4F7FA] flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-11 h-11 rounded-2xl bg-[#082F4E] text-white font-bold flex items-center justify-center mx-auto">
            VE
          </div>
          <p className="text-xs font-medium text-slate-500">กำลังเชื่อมต่อ Firebase Workspace...</p>
        </div>
      </div>
    );
  }

  if (!user || !isEmailVerified) {
    return <AuthScreen />;
  }

  // Pending / Suspended Approval Gate
  if (profile && !isApproved) {
    const isSuspended = profile.approvalStatus === 'suspended';
    return (
      <div className="min-h-screen bg-[#F4F7FA] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-7 shadow-sm space-y-5 text-center">
          <div
            className={`w-12 h-12 rounded-2xl mx-auto flex items-center justify-center ${
              isSuspended ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'
            }`}
          >
            {isSuspended ? <ShieldAlert className="w-6 h-6" /> : <Clock className="w-6 h-6" />}
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              {isSuspended
                ? 'บัญชีผู้ใช้งานถูกระงับชั่วคราว'
                : 'บัญชีอยู่ระหว่างรอการอนุมัติสิทธิ์'}
            </h1>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              {isSuspended
                ? 'กรุณาติดต่อผู้บริหาร (Super Admin) เพื่อเปิดใช้งานบัญชีของคุณอีกครั้ง'
                : `สวัสดีคุณ ${profile.displayName} (${user.email}) ระบบได้บันทึกคำขอใช้งานสิทธิ์ "${ROLE_LABELS_TH[profile.requestedRole || 'sales']}" เรียบร้อยแล้ว กรุณารอผู้บริหารอนุมัติสิทธิ์`}
            </p>
          </div>
          <div className="space-y-2.5 pt-2">
            <button
              type="button"
              onClick={() => void refreshProfile()}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-[#082F4E] text-white text-xs font-semibold rounded-xl hover:bg-[#0B3C63] cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              ตรวจสอบสถานะการอนุมัติอีกครั้ง
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="w-full py-2.5 px-4 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-50 cursor-pointer"
            >
              ออกจากระบบ
            </button>
          </div>
        </div>
      </div>
    );
  }

  const actor: ActorContext = {
    uid: user.uid,
    name: profile?.displayName || user.displayName || 'ผู้ใช้งาน',
    role: effectiveRole,
  };

  const selectedContract = contracts.find((c) => c.id === selectedContractId) || null;

  const handleSeedPortfolio = async () => {
    setSeeding(true);
    try {
      const label = profile
        ? formatAssigneeLabel(profile)
        : `${actor.name} (${ROLE_LABELS_TH[actor.role]})`;
      await seedSamplePortfolio(user.uid, label);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F7FA] pb-20 lg:pb-10">
      <DashboardHeader
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        contracts={contracts}
        userRole={effectiveRole}
        onSelectContract={(c) => setSelectedContractId(c.id)}
        onOpenNewContract={() => {
          setEditingContract(null);
          setContractModalOpen(true);
        }}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'overview' && (
          <OverviewView
            contracts={contracts}
            payments={payments}
            userRole={effectiveRole}
            loading={dataLoading}
            seeding={seeding}
            onSeedPortfolio={handleSeedPortfolio}
            onOpenNewContract={() => {
              setEditingContract(null);
              setContractModalOpen(true);
            }}
            onSelectContract={(c) => setSelectedContractId(c.id)}
            onRecordPayment={(c) => setPaymentModalState({ contract: c, editingPayment: null })}
            onNavigateTab={setActiveTab}
          />
        )}

        {activeTab === 'payments' && (
          <PaymentsView
            contracts={contracts}
            payments={payments}
            actor={actor}
            userRole={effectiveRole}
            onRecordPayment={(c) => setPaymentModalState({ contract: c, editingPayment: null })}
            onEditPayment={(c, p) => setPaymentModalState({ contract: c, editingPayment: p })}
            onViewAttachment={(p) => setViewingAttachmentPayment(p)}
          />
        )}

        {activeTab === 'contracts' && (
          <ContractsView
            contracts={contracts}
            payments={payments}
            userRole={effectiveRole}
            onOpenNewContract={() => {
              setEditingContract(null);
              setContractModalOpen(true);
            }}
            onSelectContract={(c) => setSelectedContractId(c.id)}
            onEditContract={(c) => {
              setEditingContract(c);
              setContractModalOpen(true);
            }}
            onRecordPayment={(c) => setPaymentModalState({ contract: c, editingPayment: null })}
          />
        )}

        {activeTab === 'risk' && (
          <RiskAgingView
            contracts={contracts}
            payments={payments}
            collectionLogs={collectionLogs}
            userRole={effectiveRole}
            onSelectContract={(c) => setSelectedContractId(c.id)}
            onRecordPayment={(c) => setPaymentModalState({ contract: c, editingPayment: null })}
          />
        )}

        {activeTab === 'audit' && <AuditTrailView auditLogs={auditLogs} />}

        {activeTab === 'account' && (
          <AccountView
            contracts={contracts}
            payments={payments}
            collectionLogs={collectionLogs}
            auditLogs={auditLogs}
            actor={actor}
            seeding={seeding}
            onSeedPortfolio={handleSeedPortfolio}
          />
        )}
      </main>

      <ContractModal
        isOpen={contractModalOpen}
        actor={actor}
        userRole={effectiveRole}
        usersDirectory={usersDirectory}
        existingParentClinics={existingParentClinics}
        editingContract={editingContract}
        linkedPayments={
          editingContract ? payments.filter((p) => p.contractId === editingContract.id) : []
        }
        onClose={() => {
          setContractModalOpen(false);
          setEditingContract(null);
        }}
      />

      <PaymentModal
        isOpen={Boolean(paymentModalState)}
        actor={actor}
        contract={paymentModalState?.contract || null}
        contractPayments={
          paymentModalState
            ? payments.filter((p) => p.contractId === paymentModalState.contract.id)
            : []
        }
        editingPayment={paymentModalState?.editingPayment || null}
        onClose={() => setPaymentModalState(null)}
      />

      <ContractDetailDrawer
        contract={selectedContract}
        allContracts={contracts}
        payments={payments}
        collectionLogs={collectionLogs}
        actor={actor}
        userRole={effectiveRole}
        onClose={() => setSelectedContractId(null)}
        onSelectContract={(c) => setSelectedContractId(c.id)}
        onEditContract={(c) => {
          setSelectedContractId(null);
          setEditingContract(c);
          setContractModalOpen(true);
        }}
        onRecordPayment={(c) => setPaymentModalState({ contract: c, editingPayment: null })}
        onEditPayment={(c, p) => setPaymentModalState({ contract: c, editingPayment: p })}
        onViewAttachment={(p) => setViewingAttachmentPayment(p)}
      />

      <AttachmentViewerModal
        payment={viewingAttachmentPayment}
        onClose={() => setViewingAttachmentPayment(null)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <WorkspaceApp />
      </AuthProvider>
    </ErrorBoundary>
  );
}
