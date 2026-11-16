import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../lib/firebase';
import { fetchUserProfileData, upsertUserProfile } from '../lib/billingService';
import type { RequestedRole, UserPrivateInfo, UserProfile } from '../types/billing';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'praphai33344@gmail.com';

interface RegisterPayload {
  email: string;
  password: string;
  displayName: string;
  companyName: string;
  department: string;
  requestedRole: RequestedRole;
  phone?: string;
}

interface PendingDraft {
  displayName: string;
  companyName: string;
  department: string;
  requestedRole: RequestedRole;
  phone?: string;
}

interface AuthContextValue {
  user: User | null;
  isEmailVerified: boolean;
  authReady: boolean;
  profile: UserProfile | null;
  privateInfo: UserPrivateInfo | null;
  usersDirectory: UserProfile[];
  profileLoading: boolean;
  pendingProfileDraft: PendingDraft | null;
  registerWithEmail: (payload: RegisterPayload) => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  refreshEmailVerification: () => Promise<boolean>;
  sendResetPassword: (email: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const DRAFT_STORAGE_KEY = 've_pending_profile_draft';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [privateInfo, setPrivateInfo] = useState<UserPrivateInfo | null>(null);
  const [usersDirectory, setUsersDirectory] = useState<UserProfile[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [pendingProfileDraft, setPendingProfileDraft] = useState<PendingDraft | null>(() => {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const syncVerifiedUserProfile = useCallback(
    async (firebaseUser: User) => {
      if (!firebaseUser.emailVerified) {
        setProfile(null);
        setPrivateInfo(null);
        return;
      }

      const isBootstrappedAdmin =
        (firebaseUser.email || '').toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();

      setProfileLoading(true);
      try {
        const existing = await fetchUserProfileData(firebaseUser.uid);
        if (existing.profile && existing.profile.role && existing.profile.approvalStatus) {
          // Ensure bootstrapped admin email always retains super_admin + approved
          if (
            isBootstrappedAdmin &&
            (existing.profile.role !== 'super_admin' || existing.profile.approvalStatus !== 'approved')
          ) {
            await upsertUserProfile(
              firebaseUser.uid,
              {
                displayName: existing.profile.displayName,
                companyName: existing.profile.companyName,
                department: existing.profile.department,
              },
              {
                email: firebaseUser.email || '',
                phone: existing.privateInfo?.phone,
              },
              true
            );
            const refreshed = await fetchUserProfileData(firebaseUser.uid);
            setProfile(refreshed.profile);
            setPrivateInfo(refreshed.privateInfo);
          } else {
            setProfile(existing.profile);
            setPrivateInfo(existing.privateInfo);
          }
          localStorage.removeItem(DRAFT_STORAGE_KEY);
          setPendingProfileDraft(null);
        } else {
          let draft = pendingProfileDraft;
          try {
            const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
            if (raw) draft = JSON.parse(raw);
          } catch {
            // ignore storage errors
          }

          await upsertUserProfile(
            firebaseUser.uid,
            {
              displayName:
                existing.profile?.displayName ||
                draft?.displayName ||
                firebaseUser.displayName ||
                'สมาชิกทีมงาน',
              companyName:
                existing.profile?.companyName || draft?.companyName || 'Value Tracking Hire',
              department:
                existing.profile?.department || draft?.department || 'ผู้บริหารระบบ',
              requestedRole: draft?.requestedRole || 'sales',
            },
            {
              email: firebaseUser.email || '',
              phone: existing.privateInfo?.phone || draft?.phone,
            },
            isBootstrappedAdmin
          );
          localStorage.removeItem(DRAFT_STORAGE_KEY);
          setPendingProfileDraft(null);
          const refreshed = await fetchUserProfileData(firebaseUser.uid);
          setProfile(refreshed.profile);
          setPrivateInfo(refreshed.privateInfo);
        }
      } finally {
        setProfileLoading(false);
      }
    },
    [pendingProfileDraft]
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsEmailVerified(Boolean(currentUser?.emailVerified));
      setAuthReady(true);
      if (currentUser && currentUser.emailVerified) {
        await syncVerifiedUserProfile(currentUser);
      } else {
        setProfile(null);
        setPrivateInfo(null);
        setUsersDirectory([]);
      }
    });
    return () => unsubscribe();
  }, [syncVerifiedUserProfile]);

  // Subscribe to non-PII users directory when user is verified & approved (or super_admin)
  useEffect(() => {
    if (!authReady || !user || !isEmailVerified || !profile) {
      setUsersDirectory([]);
      return;
    }

    const canListDirectory =
      profile.approvalStatus === 'approved' ||
      profile.role === 'super_admin' ||
      (user.email || '').toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();

    if (!canListDirectory) {
      setUsersDirectory([]);
      return;
    }

    const unsub = onSnapshot(
      collection(db, 'users'),
      (snap) => {
        const list: UserProfile[] = snap.docs.map((d) => ({
          ...(d.data() as UserProfile),
          uid: d.id,
        }));
        list.sort((a, b) => a.displayName.localeCompare(b.displayName, 'th'));
        setUsersDirectory(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'users');
      }
    );

    return () => unsub();
  }, [authReady, user, isEmailVerified, profile]);

  const registerWithEmail = async (payload: RegisterPayload) => {
    const draft: PendingDraft = {
      displayName: payload.displayName.trim(),
      companyName: payload.companyName.trim(),
      department: payload.department.trim(),
      requestedRole: payload.requestedRole,
      phone: payload.phone?.trim(),
    };
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // ignore
    }
    setPendingProfileDraft(draft);

    const cred = await createUserWithEmailAndPassword(auth, payload.email.trim(), payload.password);
    await updateProfile(cred.user, {
      displayName: draft.displayName,
    });
    await sendEmailVerification(cred.user);
    setUser(cred.user);
  };

  const loginWithEmail = async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    if (cred.user.emailVerified) {
      await syncVerifiedUserProfile(cred.user);
    }
  };

  const loginWithGoogle = async () => {
    const cred = await signInWithPopup(auth, googleProvider);
    if (cred.user.emailVerified) {
      await syncVerifiedUserProfile(cred.user);
    }
  };

  const logout = async () => {
    await signOut(auth);
    setProfile(null);
    setPrivateInfo(null);
    setUsersDirectory([]);
  };

  const resendVerificationEmail = async () => {
    if (!auth.currentUser) return;
    await sendEmailVerification(auth.currentUser);
  };

  const refreshEmailVerification = async (): Promise<boolean> => {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    await auth.currentUser.getIdToken(true);
    const refreshedUser = auth.currentUser;
    setUser(refreshedUser);
    setIsEmailVerified(Boolean(refreshedUser.emailVerified));
    if (refreshedUser.emailVerified) {
      await syncVerifiedUserProfile(refreshedUser);
      return true;
    }
    return false;
  };

  const sendResetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  };

  const refreshProfile = async () => {
    if (!auth.currentUser || !auth.currentUser.emailVerified) return;
    const data = await fetchUserProfileData(auth.currentUser.uid);
    setProfile(data.profile);
    setPrivateInfo(data.privateInfo);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isEmailVerified,
        authReady,
        profile,
        privateInfo,
        usersDirectory,
        profileLoading,
        pendingProfileDraft,
        registerWithEmail,
        loginWithEmail,
        loginWithGoogle,
        logout,
        resendVerificationEmail,
        refreshEmailVerification,
        sendResetPassword,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
