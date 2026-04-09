import type { AuthSessionResponse, AuthUser, LoginRequest, SignupRequest } from '@studioflow/shared';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiRequest, getGoogleAuthUrl } from '../lib/api';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (payload: LoginRequest) => Promise<void>;
  signup: (payload: SignupRequest) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => void;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = async () => {
    const response = await apiRequest<AuthSessionResponse>('/auth/me');
    setUser(response.user);
  };

  useEffect(() => {
    refreshSession()
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const login = async (payload: LoginRequest) => {
    const response = await apiRequest<AuthSessionResponse>('/auth/login', {
      method: 'POST',
      body: payload
    });
    setUser(response.user);
  };

  const signup = async (payload: SignupRequest) => {
    const response = await apiRequest<AuthSessionResponse>('/auth/signup', {
      method: 'POST',
      body: payload
    });
    setUser(response.user);
  };

  const logout = async () => {
    await apiRequest('/auth/logout', { method: 'POST' });
    setUser(null);
  };

  const loginWithGoogle = () => {
    window.location.href = getGoogleAuthUrl();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        signup,
        logout,
        loginWithGoogle,
        refreshSession
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return value;
}
