import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useEffect, useState } from 'react';
import { apiRequest, getGoogleAuthUrl } from '../lib/api';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const refreshSession = async () => {
        const response = await apiRequest('/auth/me');
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
    const login = async (payload) => {
        const response = await apiRequest('/auth/login', {
            method: 'POST',
            body: payload
        });
        setUser(response.user);
    };
    const signup = async (payload) => {
        const response = await apiRequest('/auth/signup', {
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
    return (_jsx(AuthContext.Provider, { value: {
            user,
            isLoading,
            login,
            signup,
            logout,
            loginWithGoogle,
            refreshSession
        }, children: children }));
}
export function useAuth() {
    const value = useContext(AuthContext);
    if (!value) {
        throw new Error('useAuth must be used inside AuthProvider');
    }
    return value;
}
