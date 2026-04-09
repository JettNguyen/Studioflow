import { jsx as _jsx } from "react/jsx-runtime";
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';
export function ProtectedRoute() {
    const { user, isLoading } = useAuth();
    if (isLoading) {
        return _jsx("p", { children: "Loading session..." });
    }
    if (!user) {
        return _jsx(Navigate, { to: "/login", replace: true });
    }
    return _jsx(Outlet, {});
}
