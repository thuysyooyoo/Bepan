import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { dbRepo, type PublicProfileSummary } from '../db';
import type { AuthSession, BookId } from '../types/models';

const SESSION_STORAGE_KEY = 'sobep_auth_session_v1';
const LAST_PROFILE_KEY = 'sobep_last_profile_id_v1';
const ADMIN_BOOK_KEY = 'sobep_admin_active_book_v1';

interface AuthContextValue {
  isReady: boolean;
  profiles: PublicProfileSummary[];
  session: AuthSession | null;
  activeBookId: BookId;
  lastProfileId: string | null;
  setAdminActiveBook: (bookId: BookId) => void;
  login: (profileId: string, pin: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStoredSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed.expires_at || parsed.expires_at <= Date.now()) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isReady, setIsReady] = useState(false);
  const [profiles, setProfiles] = useState<PublicProfileSummary[]>([]);
  const [session, setSession] = useState<AuthSession | null>(() => loadStoredSession());
  const [lastProfileId, setLastProfileId] = useState<string | null>(() =>
    localStorage.getItem(LAST_PROFILE_KEY)
  );
  const [adminBook, setAdminBook] = useState<BookId>(() => {
    const saved = localStorage.getItem(ADMIN_BOOK_KEY);
    return saved === 'tien_du' ? 'tien_du' : 'hiep_hoa';
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      await dbRepo.ensureInitialized();
      const list = await dbRepo.listLoginProfiles();
      if (mounted) {
        setProfiles(list);
        setIsReady(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const login = useCallback(async (profileId: string, pin: string) => {
    const newSession = await dbRepo.loginWithPin(profileId, pin);
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newSession));
    localStorage.setItem(LAST_PROFILE_KEY, profileId);
    setLastProfileId(profileId);
    setSession(newSession);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    setSession(null);
  }, []);

  const setAdminActiveBook = useCallback((bookId: BookId) => {
    localStorage.setItem(ADMIN_BOOK_KEY, bookId);
    setAdminBook(bookId);
  }, []);

  // Nếu là chủ sổ (Bố hoặc Mẹ) thì khóa cứng đúng sổ cơ sở đó; Admin được chuyển qua lại
  const activeBookId: BookId =
    session?.vai_tro === 'owner' && session.book_id ? session.book_id : adminBook;

  return (
    <AuthContext.Provider
      value={{
        isReady,
        profiles,
        session,
        activeBookId,
        lastProfileId,
        setAdminActiveBook,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
